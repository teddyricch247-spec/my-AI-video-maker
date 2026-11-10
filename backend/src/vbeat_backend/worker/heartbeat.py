"""The job heartbeat: a background task, independent of whatever tool the run is in (a render takes minutes).

Every `interval` seconds it calls job_heartbeat(job, worker). When that returns false, either an operator asked for cancellation (we still own
the job) or the lock is gone (the job was requeued and someone else may run it). It tells the two apart, sets the runner's cancel event
and stops. Writer threads call `wait_fresh()` before each write so a worker that lost the database for ~a minute does not write into a
session another worker may have taken over.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

log = logging.getLogger("vbeat_backend.heartbeat")
FRESH_S = 75.0                    # claim_job calls a worker dead after 90 s without a heartbeat


class Heartbeat:
    def __init__(self, db: Any, job_id: int, worker_id: str, cancel: asyncio.Event, interval: float = 15.0):
        self.db, self.job_id, self.worker_id, self.cancel, self.interval = db, job_id, worker_id, cancel, interval
        self.reason: str | None = None          # None | "cancel_requested" | "lock_lost"
        self.last_ok = time.monotonic()
        self.beats = 0
        self._task: asyncio.Task | None = None

    def start(self) -> "Heartbeat":
        self._task = asyncio.get_running_loop().create_task(self._run(), name=f"heartbeat-{self.job_id}")
        return self

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass

    @property
    def lock_lost(self) -> bool:
        return self.reason == "lock_lost"

    def fresh(self) -> bool:
        return time.monotonic() - self.last_ok < FRESH_S

    def wait_fresh(self, timeout: float = 300.0) -> bool:
        """For writer threads: block until a heartbeat succeeded recently. False when the lock was lost or the wait timed out."""
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if self.lock_lost:
                return False
            if self.fresh():
                return True
            time.sleep(1.0)
        return False

    async def beat_once(self) -> bool:
        """One heartbeat. Returns False when the job must stop (and records why)."""
        ok = await asyncio.to_thread(self.db.job_heartbeat, self.job_id, self.worker_id)
        if ok:
            self.last_ok = time.monotonic()
            self.beats += 1
            return True
        row = await asyncio.to_thread(self.db.job_row, self.job_id)
        mine = bool(row) and row.get("locked_by") == self.worker_id and row.get("status") == "running"
        self.reason = "cancel_requested" if (mine and row.get("cancel_requested")) else "lock_lost"
        self.cancel.set()
        return False

    async def _run(self) -> None:
        while True:
            await asyncio.sleep(self.interval)
            try:
                if not await self.beat_once():
                    log.warning("job %s: heartbeat says stop (%s)", self.job_id, self.reason)
                    return
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - a network blip: keep trying; writers wait while we are not fresh
                log.warning("job %s: heartbeat failed (%s: %s); retrying", self.job_id, type(exc).__name__, exc)
