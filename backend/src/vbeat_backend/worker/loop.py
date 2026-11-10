"""The claim loop: while there is a free slot and the kill switch is off, claim one job and run it as its own asyncio task.

Per-worker concurrency (WORKER_SLOTS) is enforced HERE: claim_job is only called with a free slot. The global per-kind limits are enforced in
SQL (settings.beat_concurrency etc.). Heavy Chromium/ffmpeg work is bounded by the runner's process-wide HEAVY gate (VBEAT_MAX_HEAVY).
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from vbeat_agent.redact import redact

from .beat_job import run_beat_job
from .context import WorkerContext
from .export_job import run_export_job

log = logging.getLogger("vbeat_backend.loop")
KINDS = ["beat.run", "export.build"]
RUNNERS = {"beat.run": run_beat_job, "export.build": run_export_job}


class Loop:
    def __init__(self, ctx: WorkerContext):
        self.ctx = ctx
        self.wake = asyncio.Event()
        self.tasks: set[asyncio.Task] = set()
        self.claiming = True                      # False while preflight blocks the worker
        self.blocked_reason: str | None = None
        self.last_error: str | None = None

    def poke(self) -> None:
        """/wake: look for work right now instead of waiting for the next poll."""
        self.wake.set()

    async def run(self) -> None:
        ctx = self.ctx
        while not ctx.stopping.is_set():
            claimed = False
            try:
                if self.claiming and ctx.running < ctx.cfg.slots and not ctx.cache.kill_reason():
                    job = await asyncio.to_thread(ctx.db.claim_job, ctx.cfg.worker_id, KINDS, ctx.cfg.stale)
                    if job:
                        claimed = True
                        self._start(job)
                self.last_error = None
            except Exception as exc:  # noqa: BLE001 - a DB blip: report it and keep polling
                self.last_error = redact(f"{type(exc).__name__}: {exc}")[:300]
                log.warning("claim failed: %s", self.last_error)
            if claimed:
                continue                          # there may be more work: try again at once (until the slots are full)
            try:
                await asyncio.wait_for(self.wake.wait(), timeout=ctx.cfg.poll_s)
            except asyncio.TimeoutError:
                pass
            self.wake.clear()

    def _start(self, job: dict[str, Any]) -> None:
        ctx = self.ctx
        ctx.running += 1
        ctx.claimed_total += 1
        runner = RUNNERS.get(job["kind"])
        log.info("claimed job %s (%s)", job["id"], job["kind"])

        async def go() -> None:
            try:
                if runner is None:
                    await asyncio.to_thread(ctx.db.finish_job, int(job["id"]), ctx.cfg.worker_id, "failed", None, f"this worker does not run {job['kind']} jobs")
                else:
                    await runner(ctx, job)
            except Exception:  # noqa: BLE001 - the job runners handle their own failures; this is the last resort
                log.exception("job %s: unhandled error", job["id"])
            finally:
                ctx.running -= 1
                self.wake.set()

        t = asyncio.get_running_loop().create_task(go(), name=f"job-{job['id']}")
        self.tasks.add(t)
        t.add_done_callback(self.tasks.discard)

    async def drain(self, timeout: float = 30.0) -> None:
        """Shutdown: signal running beats to cancel (they save their state) and wait briefly. Nothing else is released; the stale sweep requeues."""
        self.ctx.stopping.set()
        for ev in list(self.ctx.active_cancels):
            ev.set()
        if self.tasks:
            await asyncio.wait(list(self.tasks), timeout=timeout)
