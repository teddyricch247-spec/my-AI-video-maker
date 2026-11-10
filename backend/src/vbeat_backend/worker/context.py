"""What every job needs, bundled once per worker process."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, Callable

from ..config import WorkerConfig


@dataclass
class WorkerContext:
    cfg: WorkerConfig
    db: Any                                   # PgDb (or a test double with the same methods)
    storage: Any                              # Storage (or a test double)
    cache: Any                                # SettingsCache
    runner_settings: Any                      # vbeat_agent.config.Settings (api key, max_heavy, state dir ...)
    llm_factory: Callable[[dict], Any] | None = None     # tests: job -> a scripted LLM. None = the real OpenRouter client
    stopping: asyncio.Event = field(default_factory=asyncio.Event)       # SIGTERM / shutdown
    active_cancels: set = field(default_factory=set)                     # one asyncio.Event per running beat
    running: int = 0
    claimed_total: int = 0
