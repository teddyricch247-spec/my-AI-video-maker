"""Getting a run's data into Supabase without ever blocking the event loop that runs the beats.

JobWriter: one thread per job, executing write operations IN ORDER, retrying transient failures. `submit(fn, key=...)` returns at once; an operation
with a `key` that is still waiting is replaced by the newer one (state snapshots coalesce). Before each operation the writer checks the heartbeat is
fresh; if the lock was lost it drops everything (another worker owns the session now).

DbMirror: the runner's `Mirror`. Raw conversation messages go to `messages` as visible=false rows through append_message, idempotently: the writer
knows how many raw rows the session should have, and skips a message whose index is already in the database (a retried write never duplicates).
"""
from __future__ import annotations

import json
import logging
import threading
import time
from collections import OrderedDict
from typing import Any, Callable

from vbeat_agent.redact import redact

log = logging.getLogger("vbeat_backend.writer")


def clean_json(obj: Any) -> Any:
    """JSON-safe copy for a jsonb column: round-trips through json (default=str) and drops NUL characters, which Postgres jsonb rejects."""
    text = json.dumps(obj, ensure_ascii=False, default=str).replace("\\u0000", "")
    return json.loads(text)


class JobWriter:
    def __init__(self, name: str, *, guard: Callable[[], bool] | None = None, retries: int = 3, sleep=time.sleep):
        self.name, self.guard, self.retries, self._sleep = name, guard, retries, sleep
        self._cv = threading.Condition()
        self._items: "OrderedDict[Any, Callable[[], Any]]" = OrderedDict()
        self._seq = 0
        self._busy = False
        self._closed = False
        self._dropped = False
        self.errors: list[str] = []
        self.done_ops = 0
        self._thread = threading.Thread(target=self._loop, name=f"writer-{name}", daemon=True)
        self._thread.start()

    def submit(self, fn: Callable[[], Any], *, key: str | None = None) -> None:
        with self._cv:
            if self._closed or self._dropped:
                return
            if key is not None and key in self._items:
                self._items[key] = fn                      # newest wins; keeps its place in line
            else:
                self._seq += 1
                self._items[key if key is not None else ("#", self._seq)] = fn
            self._cv.notify_all()

    def flush(self, timeout: float = 120.0) -> bool:
        end = time.monotonic() + timeout
        with self._cv:
            while self._items or self._busy:
                left = end - time.monotonic()
                if left <= 0:
                    return False
                self._cv.wait(min(left, 0.5))
        return True

    def drop(self) -> None:
        """Discard everything not yet written and refuse new work (the lock was lost)."""
        with self._cv:
            self._dropped = True
            self._items.clear()
            self._cv.notify_all()

    def close(self, timeout: float = 120.0) -> bool:
        ok = self.flush(timeout)
        with self._cv:
            self._closed = True
            self._cv.notify_all()
        self._thread.join(5)
        return ok

    def _loop(self) -> None:
        while True:
            with self._cv:
                while not self._items and not self._closed:
                    self._cv.wait(0.5)
                if not self._items and self._closed:
                    return
                _, fn = self._items.popitem(last=False)
                self._busy = True
            try:
                self._run(fn)
            finally:
                with self._cv:
                    self._busy = False
                    self._cv.notify_all()

    def _run(self, fn: Callable[[], Any]) -> None:
        if self.guard is not None and not self.guard():
            self.drop()
            return
        for attempt in range(self.retries + 1):
            try:
                fn()
                self.done_ops += 1
                return
            except Exception as exc:  # noqa: BLE001
                msg = redact(f"{type(exc).__name__}: {exc}")[:300]
                if attempt >= self.retries or isinstance(exc, (ValueError, TypeError)):
                    log.error("[%s] write failed for good: %s", self.name, msg)
                    self.errors.append(msg)
                    return
                log.warning("[%s] write failed (try %d), retrying: %s", self.name, attempt + 1, msg)
                self._sleep(min(8.0, 1.0 * (2 ** attempt)))


class DbMirror:
    """vbeat_agent.mirror.Mirror backed by Supabase."""

    def __init__(self, db: Any, writer: JobWriter, *, session_id: str, beat_id: str, base_raw_count: int, request_public: dict[str, Any],
                 pending_queue_ids: list[int] | None = None):
        self.db, self.writer, self.session_id, self.beat_id = db, writer, session_id, beat_id
        self.request_public = request_public
        self._next_index = base_raw_count
        self._db_count: int | None = None              # asked of the database on the first write, so a replayed index is never written twice
        self._queue_ids = list(pending_queue_ids or [])      # queued feedback rows: cleared once the reviewer message is safely stored
        self.last_state: dict[str, Any] | None = None
        self.messages_seen = 0

    # ---- Mirror protocol -------------------------------------------------------------------------------------------------
    def message(self, m: dict[str, Any]) -> None:
        idx = self._next_index
        self._next_index += 1
        self.messages_seen += 1
        clear = self._queue_ids if (m.get("_meta") or {}).get("kind") == "reviewer" else []
        if clear:
            self._queue_ids = []
        self.writer.submit(lambda: self._write_raw(idx, m, clear))

    def state(self, st: dict[str, Any]) -> None:
        self.last_state = st
        self.writer.submit(lambda: self._write_state(st), key="state")

    # ---- writes (run on the writer thread) ---------------------------------------------------------------------------------
    def _write_raw(self, idx: int, m: dict[str, Any], clear_queue: list[int]) -> None:
        try:
            if self._db_count is None:
                self._db_count = self.db.count_raw_messages(self.session_id)
            if self._db_count <= idx:
                content = clean_json(m)
                usage = (m.get("_meta") or {}).get("usage")
                self.db.append_message(self.session_id, m["role"], content, tool_call_id=m.get("tool_call_id"), usage=clean_json(usage) if usage else None, visible=False)
                self._db_count = max(self._db_count, idx) + 1
            if clear_queue:
                self.db.clear_queued(clear_queue)
        except Exception:
            self._db_count = None            # unknown now: the retry asks the database how many rows the session has
            raise

    def _write_state(self, st: dict[str, Any]) -> None:
        patch = {"runner": clean_json(st), "request": clean_json(self.request_public)}
        self.db.merge_session_state(self.session_id, patch, steps=int(st.get("steps") or 0), model=st.get("model"))
        self.db.update_beat(self.beat_id, scene_n=st.get("scene_n"), sfx_n=st.get("sfx_n"))
