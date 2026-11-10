"""One worker process: startup checks, background tasks, the claim loop, graceful shutdown."""
from __future__ import annotations

import asyncio
import logging
import os
import signal
import time
from pathlib import Path
from typing import Any

from vbeat_agent import killswitch
from vbeat_agent.config import load_settings
from vbeat_agent.health import preflight_async, render_text
from vbeat_agent.toolrun import HEAVY

from ..config import WorkerConfig, load_config
from ..db import PgDb
from ..storage import Storage
from .context import WorkerContext
from .http import start_http
from .killswitch import SettingsCache
from .loop import Loop
from .register import register_loop

log = logging.getLogger("vbeat_backend.worker")


def runner_settings(cfg: WorkerConfig) -> Any:
    s = load_settings(dict(os.environ))
    s.api_key = cfg.openrouter_key or s.api_key
    s.max_heavy = cfg.max_heavy
    s.ledger_tz = cfg.ledger_tz
    s.state_dir = cfg.work_dir / "state"
    s.beat_concurrency = cfg.slots
    s.state_dir.mkdir(parents=True, exist_ok=True)
    HEAVY.configure(cfg.max_heavy)
    return s


async def run_preflight(ctx: WorkerContext, network: bool = True) -> dict:
    return await preflight_async(ctx.runner_settings, network=network)


async def run_worker(cfg: WorkerConfig, *, ctx: WorkerContext | None = None, install_signals: bool = True, with_http: bool = True) -> Loop:
    """Runs until stopped. Returns the Loop (tests inspect it)."""
    started = time.monotonic()
    cfg.work_dir.mkdir(parents=True, exist_ok=True)
    if ctx is None:
        db = PgDb(cfg.database_url).open()
        cache = SettingsCache(db, cfg.settings_refresh_s).start()
        ctx = WorkerContext(cfg=cfg, db=db, storage=Storage(cfg.supabase_url, cfg.service_key), cache=cache, runner_settings=runner_settings(cfg))
    killswitch.register_provider(ctx.cache.kill_reason)
    loop = Loop(ctx)
    state: dict[str, Any] = {"preflight": None}

    # 1. our own orphans (running jobs from a previous life of THIS worker id). Never requeue_orphans: it would steal other workers' live jobs.
    n = await asyncio.to_thread(ctx.db.requeue_own_orphans, cfg.worker_id)
    if n:
        log.warning("%s: requeued %d job(s) left running by a previous life of this worker", cfg.worker_id, n)

    # 2. preflight: refuse to claim jobs when a blocking check fails, and say why
    async def check() -> dict:
        rep = await run_preflight(ctx)
        state["preflight"] = rep
        if rep.get("ok"):
            loop.claiming, loop.blocked_reason = True, None
        else:
            loop.claiming = False
            loop.blocked_reason = rep.get("summary")
            log.error("preflight FAILED, not claiming jobs:\n%s", render_text(rep))
        return rep
    await check()

    def info() -> dict:
        return {"ok": True, "worker": cfg.worker_id, "running": ctx.running, "slots": cfg.slots, "heavy": HEAVY.current, "claiming": loop.claiming,
                "blocked_reason": loop.blocked_reason, "kill_switch": ctx.cache.kill_reason(), "version": cfg.version}

    def preflight_sync() -> dict:
        fut = asyncio.run_coroutine_threadsafe(check(), main_loop)
        return fut.result(120)

    main_loop = asyncio.get_running_loop()
    server = start_http(cfg.port, info, lambda: main_loop.call_soon_threadsafe(loop.poke), preflight_sync, cfg.tick_secret) if with_http else None
    if install_signals:
        for sig in (signal.SIGTERM, signal.SIGINT):
            main_loop.add_signal_handler(sig, lambda: ctx.stopping.set())
    reg = asyncio.create_task(register_loop(ctx, loop, started, lambda: state["preflight"]))
    runner = asyncio.create_task(loop.run())
    await ctx.stopping.wait()
    log.info("%s: shutting down (no new claims; running beats are told to save their state)", cfg.worker_id)
    await loop.drain(30.0)
    runner.cancel()
    reg.cancel()
    for t in (runner, reg):
        try:
            await t
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
    if server:
        server.shutdown()
    ctx.cache.stop()
    try:
        await asyncio.to_thread(ctx.db.upsert_worker, {"id": cfg.worker_id, "slots": cfg.slots, "running": 0, "heavy": 0, "version": cfg.version, "info": {"stopped": True}})
    except Exception:  # noqa: BLE001
        pass
    killswitch.register_provider(None)
    return loop


class RedactFilter(logging.Filter):
    """Every log line passes through the runner's redactor: registered secrets (by value) and key-shaped strings never reach a log."""

    def filter(self, record: logging.LogRecord) -> bool:
        from vbeat_agent.redact import redact
        try:
            record.msg, record.args = redact(record.getMessage()), None
            if record.exc_info:                       # tracebacks too: format now, redact, and drop the raw exception
                import traceback
                record.msg += "\n" + redact("".join(traceback.format_exception(*record.exc_info)))
                record.exc_info = None
        except Exception:  # noqa: BLE001
            pass
        return True


def main_worker() -> None:
    logging.basicConfig(level=os.environ.get("VBEAT_LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    for h in logging.getLogger().handlers:
        h.addFilter(RedactFilter())
    cfg = load_config()
    asyncio.run(run_worker(cfg))
