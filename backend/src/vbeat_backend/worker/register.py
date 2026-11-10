"""The `workers` row: id, url, slots, running, heavy, version, last_seen, upserted every 10 s (the Ops page reads it)."""
from __future__ import annotations

import asyncio
import logging
import platform
import socket
import time
from typing import Any

from vbeat_agent.toolrun import HEAVY

from .context import WorkerContext

log = logging.getLogger("vbeat_backend.register")


def worker_row(ctx: WorkerContext, loop: Any, started: float, preflight: dict | None) -> dict[str, Any]:
    return {"id": ctx.cfg.worker_id, "role": "worker", "url": ctx.cfg.public_url, "slots": ctx.cfg.slots, "running": ctx.running,
            "heavy": HEAVY.current, "version": ctx.cfg.version,
            "info": {"host": socket.gethostname(), "python": platform.python_version(), "uptime_s": int(time.monotonic() - started), "claimed_total": ctx.claimed_total,
                     "claiming": loop.claiming, "blocked_reason": loop.blocked_reason, "max_heavy": ctx.cfg.max_heavy, "heavy_max_seen": HEAVY.max_seen,
                     "preflight": (preflight or {}).get("status"), "last_claim_error": loop.last_error, "settings_error": ctx.cache.last_error}}


async def register_loop(ctx: WorkerContext, loop: Any, started: float, get_preflight: Any) -> None:
    while not ctx.stopping.is_set():
        try:
            await asyncio.to_thread(ctx.db.upsert_worker, worker_row(ctx, loop, started, get_preflight()))
        except Exception as exc:  # noqa: BLE001
            log.warning("could not update the workers row: %s", exc)
        try:
            await asyncio.wait_for(ctx.stopping.wait(), timeout=ctx.cfg.register_s)
        except asyncio.TimeoutError:
            pass
