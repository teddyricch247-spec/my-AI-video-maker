"""The event sink of one beat job: turns the runner's events into the UI rows (messages with visible=true), keeps versions and their
preview files in step with Supabase, and tells the budget the token counts. Everything that touches the database or Storage is handed to the
job's writer thread, so `emit` (called on the event loop) never blocks.

UI rows use `vbeat_agent.events.events_to_messages` for the text/steps mapping. A row is inserted when its group of events starts (so the UI shows
"the model is calling check_scene" while the check runs) and updated as the group's tool results arrive. `user_message` events are skipped: the
planner already inserted that row (visible, queued) when the human sent it.
"""
from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
from typing import Any

from vbeat_agent.events import events_to_messages
from vbeat_agent.hydrate import read_version_bundle
from vbeat_agent.state import BeatPaths, StateStore, VersionStore

log = logging.getLogger("vbeat_backend.sink")
IGNORED = {"llm_call", "cost", "user_message"}
SYNC_AFTER_TOOLS = {"preview", "finish", "check_scene", "write_cue", "write_scene", "revert_scene", "revert_cue"}


def storage_uri(bucket: str, path: str) -> str:
    """How rows refer to a Storage object: `<bucket>:<object path>`. The API turns it into a signed URL."""
    return f"{bucket}:{path}"


class _Row:
    __slots__ = ("id", "text", "steps", "role")

    def __init__(self) -> None:
        self.id: int | None = None
        self.text = self.role = None
        self.steps: list | None = None


class VersionSync:
    """Mirrors versions/ to scene_versions + sfx_versions rows and the `previews` bucket. Idempotent: it only writes what changed."""

    def __init__(self, db: Any, storage: Any, beat_dir: Path, *, project_id: str, beat_id: str, known: dict[tuple[str, int], str] | None = None):
        self.db, self.storage, self.beat_dir, self.project_id, self.beat_id = db, storage, Path(beat_dir), project_id, beat_id
        self.prefix = f"{project_id}/{beat_id}"
        self._seen: dict[tuple[str, int], str] = dict(known or {})
        self._uploaded: dict[str, tuple[int, int]] = {}

    @staticmethod
    def fingerprint(source: str | None, report: Any) -> str:
        return hashlib.sha1(((source or "") + "\0" + json.dumps(report, sort_keys=True, default=str)).encode()).hexdigest()

    def _upload(self, local: Path | None, name: str, ctype: str) -> str | None:
        if local is None:
            return None
        st = local.stat()
        sig = (st.st_size, int(st.st_mtime_ns))
        path = f"{self.prefix}/{name}"
        if self._uploaded.get(path) != sig:
            self.storage.upload("previews", path, local, ctype)
            self._uploaded[path] = sig
        return path

    def sync(self) -> int:
        from .mirror import clean_json
        paths = BeatPaths(self.beat_dir)
        vs = VersionStore(paths, StateStore(paths))
        n_written = 0
        for kind in ("scene", "cue"):
            for n in vs.numbers(kind):
                b = read_version_bundle(self.beat_dir, kind, n)
                if b["source"] is None:
                    continue
                strip = self._upload(b["strip_path"], f"scene_{n:03d}.strip.jpg", "image/jpeg")
                wav = self._upload(b["wav_path"], f"cue_{n:03d}.wav", "audio/wav")
                spec = self._upload(b["spectrogram_path"], f"cue_{n:03d}.preview.jpg", "image/jpeg")
                fp = self.fingerprint(b["source"], b["report"]) + f"|{strip}|{wav}|{spec}"
                if self._seen.get((kind, n)) == fp:
                    continue
                report = clean_json(b["report"]) if b["report"] is not None else None
                if kind == "scene":
                    self.db.upsert_scene_version(self.beat_id, n, b["source"], report, strip, (b["meta"] or {}).get("created_by") or "agent")
                else:
                    self.db.upsert_sfx_version(self.beat_id, n, b["source"], report, wav, spec)
                self._seen[(kind, n)] = fp
                n_written += 1
        return n_written


class JobSink:
    def __init__(self, writer: Any, db: Any, storage: Any, versions: VersionSync, budget: Any, *, session_id: str, beat_dir: Path):
        self.writer, self.db, self.storage, self.versions, self.budget = writer, db, storage, versions, budget
        self.session_id, self.beat_dir = session_id, Path(beat_dir)
        self.group: list[dict[str, Any]] = []
        self.row: _Row | None = None
        self.by_call: dict[str, tuple[list[dict[str, Any]], _Row]] = {}     # call_id -> the group (and row) its tool_call belongs to
        self.events_seen = 0

    # ---- EventSink protocol ----------------------------------------------------------------------------------------------
    def emit(self, event: dict[str, Any]) -> None:
        try:
            self._emit(event)
        except Exception:  # noqa: BLE001 - UI mirroring must never stop a run
            log.exception("sink failed on an event (the run continues)")

    def _emit(self, ev: dict[str, Any]) -> None:
        self.events_seen += 1
        t = ev.get("type")
        if t == "llm_call":
            self.budget.attach_usage(ev.get("prompt_tokens"), ev.get("completion_tokens"))
        if t in IGNORED:
            return
        cid = ev.get("call_id")
        if t == "tool_result" and cid in self.by_call:
            # A scene_version / sfx_version event can fall between a tool_call and its tool_result and close the group; the result still
            # belongs to the row of its call (events_to_messages on its own would open a second, empty row for it).
            grp, row = self.by_call[cid]
            grp.append(ev)
        else:
            if self._continues_group(ev):
                self.group.append(ev)
            else:
                self.group, self.row = [ev], _Row()
            grp, row = self.group, self.row
            if t == "tool_call" and cid:
                self.by_call[cid] = (grp, row)
        group = list(grp)
        self.writer.submit(lambda: self._write_row(group, row))          # not keyed: row inserts and updates keep their order
        if t in ("scene_version", "sfx_version", "run_finished") or (t == "tool_result" and ev.get("name") in SYNC_AFTER_TOOLS):
            self.writer.submit(self.versions.sync, key="versions")

    def _continues_group(self, ev: dict[str, Any]) -> bool:
        if not self.group or ev.get("type") not in ("tool_call", "tool_result"):
            return False
        first = self.group[0]
        return first.get("type") in ("assistant_message", "tool_call", "tool_result") and first.get("step") == ev.get("step")

    # ---- writer-thread side --------------------------------------------------------------------------------------------------
    def _url_for(self, rel: str) -> str:
        p = Path(rel)
        local = p if p.is_absolute() else self.beat_dir / p
        name = "media/" + str(p.relative_to(self.beat_dir) if p.is_absolute() and self.beat_dir in p.parents else p).replace("\\", "/").lstrip("/")
        path = f"{self.versions.prefix}/{name}"
        if local.exists():
            self.storage.upload("previews", path, local)
        return storage_uri("previews", path)

    def _write_row(self, group: list[dict[str, Any]], row: _Row) -> None:
        msgs = events_to_messages(group, url_for=self._url_for)
        if not msgs:
            return
        m = msgs[0]
        text, steps, role = m.get("text") or "", m.get("steps") or [], m.get("role") or "event"
        if row.id is None:
            row.id = self.db.append_message(self.session_id, role, {"text": text, "steps": steps}, ui_text=text, ui_steps=steps, visible=True)
        elif (row.text, row.steps) != (text, steps):
            self.db.update_message_ui(row.id, text, steps)
        row.text, row.steps, row.role = text, steps, role
