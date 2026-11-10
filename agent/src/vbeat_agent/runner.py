"""run_beats: many beats at once, bounded.

- `concurrency` beats run at the same time (default settings.beat_concurrency); the number of heavy subprocesses (Chromium, ffmpeg)
  across ALL of them is bounded separately by toolrun.HEAVY, so 8 beats on a 2-CPU machine queue for rendering instead of thrashing.
- One SharedBudget caps the whole batch (default settings.max_usd_per_run); every beat also has its own cap and the daily ledger applies.
- One beat failing never takes the others down: an exception becomes a `failed` BeatResult for that beat.
  The exception is a rejected API key / no credits (the same for every beat): the rest of the batch is cancelled at once instead of
  every beat finding out separately.
- Results come back in request order, one per request, always.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable

from .beat import BeatRequest, BeatResult, run_beat
from .budget import SharedBudget
from .config import Settings, load_settings
from .errors import explain
from .events import EventSink
from .killswitch import engaged
from .llm_types import LLM
from .redact import redact
from .state import BeatBusy
from .toolrun import CancelSignal

log = logging.getLogger("vbeat_agent.runner")
BATCH_AUTH_REASON = "cancel:batch_auth_error"


def _failed(req: BeatRequest, reason: str, detail: str = "", status: str = "failed") -> BeatResult:
    ex = explain(reason, detail)
    return BeatResult(status=status, status_reason=reason, explanation=ex.to_dict() if ex else None)  # type: ignore[arg-type]


async def run_beats(requests: list[BeatRequest], sink: "EventSink | Callable[[BeatRequest], EventSink | None] | None" = None,
                    cancel: "asyncio.Event | CancelSignal | None" = None, *, concurrency: int | None = None, total_max_usd: float | None = None,
                    llm: LLM | None = None, settings: Settings | None = None, ledger: Any = None) -> list[BeatResult]:
    settings = settings or load_settings()
    dirs = [str(r.beat_dir.resolve()) for r in requests]
    if len(set(dirs)) != len(dirs):
        raise ValueError("two requests share one beat_dir: every beat needs its own directory")
    n = max(1, int(concurrency or settings.beat_concurrency))
    budget = SharedBudget(settings.max_usd_per_run if total_max_usd is None else total_max_usd)
    signal = CancelSignal.wrap(cancel)
    sem = asyncio.Semaphore(n)
    results: list[BeatResult | None] = [None] * len(requests)

    def sink_for(req: BeatRequest) -> EventSink | None:
        if sink is None or hasattr(sink, "emit"):
            return sink  # type: ignore[return-value]
        return sink(req)  # type: ignore[operator]

    async def one(i: int, req: BeatRequest) -> None:
        async with sem:
            if signal.is_set():                                   # cancelled while waiting for a slot: never started
                reason = signal.why()
                results[i] = _failed(req, reason, status="cancelled")
                return
            try:
                res = await run_beat(req, sink_for(req), signal, llm=llm, settings=settings, budget=budget, ledger=ledger)
            except BeatBusy as exc:
                res = _failed(req, "busy", str(exc))
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - isolation: one beat's crash must not end the batch
                log.exception("beat %s crashed", req.idx)
                res = _failed(req, "internal_error", redact(f"{type(exc).__name__}: {exc}")[:300])
            results[i] = res
            if res.status_reason == "llm_auth" and not signal.is_set():
                signal.trip(BATCH_AUTH_REASON)

    await asyncio.gather(*(one(i, r) for i, r in enumerate(requests)))
    out: list[BeatResult] = []
    for r in results:
        assert r is not None
        if r.status == "cancelled" and (r.status_reason or "") == BATCH_AUTH_REASON:
            ex = explain("llm_auth", "")
            if ex:
                r.explanation = {**ex.to_dict(), "what": "Stopped: another beat in this batch was rejected by OpenRouter. " + ex.what}
        out.append(r)
    if engaged():
        log.info("run_beats finished with the kill switch engaged")
    return out
