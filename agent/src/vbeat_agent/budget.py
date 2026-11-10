"""Money guards. Three nested limits, each enforced before an LLM call starts:

    per beat   Caps.max_usd (default $0.50)          the loop, per run_beat / continue_beat
    per run    SharedBudget (default $5.00)          one run_beats() batch, in process
    per day    SpendLedger  (default $10.00)         every process on this machine, persisted in the state directory

A call is *reserved* before it starts (so a burst of parallel beats cannot all slip under the cap) and *settled* with the real
cost afterwards. A call whose cost the API did not report is charged a conservative estimate. The daily ledger cannot be
raised by a request: only the operator's environment (VBEAT_MAX_USD_PER_DAY) changes it.
"""
from __future__ import annotations

import fcntl
import json
import os
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from .state import append_line, read_json, write_json_atomic

STALE_RESERVATION_S = 20 * 60


class SharedBudget:
    """In-process total across the beats of one run_beats() call. Thread-safe. In-flight calls are counted at their estimate."""
    denial_reason = "cap:total_max_usd"

    def __init__(self, total_max_usd: float | None):
        self.total = total_max_usd
        self._lock = threading.Lock()
        self.spent = 0.0
        self._inflight: dict[int, float] = {}
        self._n = 0

    def reserve(self, estimate: float) -> Any | None:
        with self._lock:
            if self.total is not None and self.spent + sum(self._inflight.values()) + estimate > self.total:
                return None
            self._n += 1
            self._inflight[self._n] = estimate
            return self._n

    def settle(self, token: Any, actual: float) -> None:
        if token is None:
            return
        with self._lock:
            self._inflight.pop(token, None)
            self.spent += actual

    @property
    def remaining(self) -> float | None:
        return None if self.total is None else max(0.0, self.total - self.spent)


class SpendLedger:
    """Daily spend shared by every process on the machine (state_dir/ledger-state.json under an flock, plus an append-only
    audit trail ledger.jsonl). Day boundaries follow `tz` (default UTC)."""
    denial_reason = "cap:daily_usd"

    def __init__(self, state_dir: Path, daily_cap: float, tz: str = "UTC", clock=time.time):
        self.dir = Path(state_dir)
        self.cap = float(daily_cap)
        self.tz = tz
        self.clock = clock
        self.state_path = self.dir / "ledger-state.json"
        self.audit_path = self.dir / "ledger.jsonl"
        self.lock_path = self.dir / "ledger.lock"
        self._meta: dict[str, tuple[str, str]] = {}          # token -> (beat label, model) for the audit line

    def _today(self) -> str:
        try:
            from zoneinfo import ZoneInfo
            tz = ZoneInfo(self.tz)
        except Exception:  # noqa: BLE001 - unknown tz name: fall back to UTC rather than fail a run
            tz = timezone.utc
        return datetime.fromtimestamp(self.clock(), tz).date().isoformat()

    @contextmanager
    def _locked(self) -> Iterator[dict[str, Any]]:
        self.dir.mkdir(parents=True, exist_ok=True)
        fd = os.open(self.lock_path, os.O_RDWR | os.O_CREAT, 0o644)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            st = read_json(self.state_path, {}) or {}
            today = self._today()
            if st.get("date") != today:
                st = {"date": today, "spent": 0.0, "reservations": {}}
            st.setdefault("reservations", {})
            now = self.clock()
            st["reservations"] = {t: r for t, r in st["reservations"].items()
                                  if now - r.get("ts", 0) < STALE_RESERVATION_S and _pid_alive(r.get("pid", 0))}
            yield st
            write_json_atomic(self.state_path, st)
        finally:
            try:
                fcntl.flock(fd, fcntl.LOCK_UN)
            finally:
                os.close(fd)

    def reserve(self, estimate: float, *, beat: str = "", model: str = "") -> Any | None:
        with self._locked() as st:
            held = sum(r["usd"] for r in st["reservations"].values())
            if st["spent"] + held + estimate > self.cap:
                return None
            tok = uuid.uuid4().hex
            st["reservations"][tok] = {"usd": float(estimate), "pid": os.getpid(), "ts": self.clock()}
        self._meta[tok] = (beat, model)
        return tok

    def settle(self, token: Any, actual: float, *, estimated: bool = False) -> None:
        if token is None:
            return
        with self._locked() as st:
            st["reservations"].pop(token, None)
            st["spent"] = round(st["spent"] + float(actual), 6)
            total, date = st["spent"], st["date"]
        beat, model = self._meta.pop(token, ("", ""))
        append_line(self.audit_path, json.dumps({"ts": datetime.fromtimestamp(self.clock(), timezone.utc).isoformat(timespec="seconds"),
                                                 "date": date, "beat": beat, "model": model, "usd": round(float(actual), 6),
                                                 "estimated": estimated, "total_today": total}))

    def today(self) -> dict[str, Any]:
        with self._locked() as st:
            held = sum(r["usd"] for r in st["reservations"].values())
            return {"date": st["date"], "spent": round(st["spent"], 4), "in_flight": round(held, 4), "cap": self.cap,
                    "remaining": round(max(0.0, self.cap - st["spent"] - held), 4), "tz": self.tz}

    def bind(self, beat: str, model: str) -> "BoundLedger":
        """A Budget (the loop's protocol) that tags the audit trail with the beat and model."""
        return BoundLedger(self, beat, model)


class BoundLedger:
    denial_reason = SpendLedger.denial_reason

    def __init__(self, ledger: SpendLedger, beat: str, model: str):
        self.ledger, self.beat, self.model = ledger, beat, model

    def reserve(self, estimate: float) -> Any | None:
        return self.ledger.reserve(estimate, beat=self.beat, model=self.model)

    def settle(self, token: Any, actual: float) -> None:
        self.ledger.settle(token, actual)


class CompositeBudget:
    """Reserve from several budgets at once; deny (and give back what was reserved) if any refuses. `denial_reason` names the
    budget that refused, so the run stops with `cap:total_max_usd` or `cap:daily_usd` as appropriate."""

    def __init__(self, *budgets: Any):
        self.budgets = [b for b in budgets if b is not None]
        self.denial_reason = "cap:total_max_usd"

    def reserve(self, estimate: float) -> Any | None:
        tokens: list[Any] = []
        for b in self.budgets:
            t = b.reserve(estimate)
            if t is None:
                for done, tok in zip(self.budgets, tokens):
                    done.settle(tok, 0.0)
                self.denial_reason = b.denial_reason
                return None
            tokens.append(t)
        return tokens

    def settle(self, token: Any, actual: float) -> None:
        if token is None:
            return
        for b, t in zip(self.budgets, token):
            b.settle(t, actual)


def _pid_alive(pid: int) -> bool:
    if not pid:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True
