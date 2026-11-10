"""SupabaseBudget: the money guard for workers whose only shared memory is the database.

Used as the runner's `ledger=`. Before every model call it checks (numbers from `settings.caps`, spend from `cost_events`):
    cap:daily_usd  spend_today(VBEAT_LEDGER_TZ)  >= caps.daily_usd
    cap:run_usd    project_spend(project)         >= caps.run_usd
    cap:max_usd    this beat's sessions.cost_usd  >= caps.beat_usd   (cumulative over the beat's life, all runs)
After every call `settle` inserts a cost_events row (a trigger rolls it into sessions.cost_usd), so the next check in ANY worker sees it.
Overshoot is bounded by the calls already in flight (this process adds its own in-flight estimates to what it reads).
The kill switch is checked by the runner itself before every call (it polls the provider); it is not duplicated here.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Any

log = logging.getLogger("vbeat_backend.budget")


class SupabaseBudget:
    def __init__(self, db: Any, cache: Any, *, project_id: str, session_id: str | None, tz: str = "UTC", sleep=time.sleep):
        self.db, self.cache, self.project_id, self.session_id, self.tz, self._sleep = db, cache, project_id, session_id, tz, sleep
        self.denial_reason = "cap:daily_usd"
        self._lock = threading.Lock()
        self._inflight: dict[int, float] = {}
        self._n = 0
        self.last_event_id: int | None = None
        self.unrecorded: list[dict[str, Any]] = []         # cost rows that could not be written (DB down); retried, reported at the end
        self.recorded_usd = 0.0

    # ---- the checks ------------------------------------------------------------------------------------------------
    def _limits(self) -> dict[str, float]:
        c = self.cache.caps()
        return {"cap:daily_usd": float(c["daily_usd"]), "cap:run_usd": float(c["run_usd"]), "cap:max_usd": float(c["beat_usd"])}

    def _headroom(self, extra: float = 0.0) -> tuple[float, str | None]:
        """(smallest remaining amount over the three caps, the reason of the first cap that is used up or None)."""
        snap = self.db.spend_snapshot(self.tz, self.project_id, self.session_id)
        spent = {"cap:daily_usd": snap["today"], "cap:run_usd": snap["project"], "cap:max_usd": snap["session"]}
        lim = self._limits()
        remaining = {k: lim[k] - spent[k] - extra for k in lim}
        for k in ("cap:daily_usd", "cap:run_usd", "cap:max_usd"):
            if remaining[k] <= 0:
                return min(remaining.values()), k
        return min(remaining.values()), None

    def today(self) -> dict[str, Any]:
        """The runner's start-of-run guard: remaining <= 0 means "do not start"."""
        remaining, why = self._headroom()
        if why:
            self.denial_reason = why
        return {"remaining": round(max(0.0, remaining), 4), "reason": why}

    # ---- the Budget protocol (through bind) ----------------------------------------------------------------------------
    def bind(self, beat: str, model: str) -> "BoundBudget":
        return BoundBudget(self, beat, model)

    def reserve(self, estimate: float, model: str = "") -> Any | None:
        self.flush_unrecorded()
        with self._lock:
            extra = sum(self._inflight.values())
        _, why = self._headroom(extra)
        if why:
            self.denial_reason = why
            return None
        with self._lock:
            self._n += 1
            self._inflight[self._n] = float(estimate)
            return self._n

    def settle(self, token: Any, actual: float, model: str = "") -> None:
        if token is None:
            return
        with self._lock:
            self._inflight.pop(token, None)
        if actual and actual > 0:
            self._record({"model": model, "usd": float(actual)})

    def _record(self, rec: dict[str, Any]) -> None:
        for attempt in range(3):
            try:
                self.last_event_id = self.db.insert_cost_event(self.project_id, self.session_id, rec["model"], rec["usd"])
                self.recorded_usd += rec["usd"]
                return
            except Exception as exc:  # noqa: BLE001
                log.error("could not record cost $%.4f (try %d): %s", rec["usd"], attempt + 1, exc)
                self._sleep(0.5 * (attempt + 1))
        self.last_event_id = None
        self.unrecorded.append(rec)

    def flush_unrecorded(self) -> None:
        pending, self.unrecorded = self.unrecorded, []
        for rec in pending:
            self._record(rec)

    def attach_usage(self, prompt_tokens: int | None, completion_tokens: int | None, cached: int | None = None) -> None:
        """Called from the `llm_call` event that follows `settle`: adds the token counts to the row just written."""
        eid = self.last_event_id
        if eid is None:
            return
        try:
            self.db.set_cost_tokens(eid, prompt_tokens, completion_tokens, cached)
        except Exception as exc:  # noqa: BLE001 - tokens are informational; the dollars are already recorded
            log.warning("could not attach token counts to cost event %s: %s", eid, exc)


class BoundBudget:
    """What the loop sees: reserve / settle / denial_reason, tagged with the beat and model."""

    def __init__(self, parent: SupabaseBudget, beat: str, model: str):
        self.parent, self.beat, self.model = parent, beat, model

    @property
    def denial_reason(self) -> str:
        return self.parent.denial_reason

    def reserve(self, estimate: float) -> Any | None:
        return self.parent.reserve(estimate, self.model)

    def settle(self, token: Any, actual: float) -> None:
        self.parent.settle(token, actual, self.model)
