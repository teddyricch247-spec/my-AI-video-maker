"""Worker configuration: environment variables only (names in backend/deploy/env.example). Secrets are registered with the runner's
redactor by value, so they never reach a log line, a database row or a conversation file."""
from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping

from vbeat_agent.redact import register_secret

from . import __version__

SECRET_NAMES = ("DATABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OPENROUTER_API_KEY", "TICK_SECRET")


class ConfigError(RuntimeError):
    """A required environment variable is missing or malformed. The message names it and says what to do."""


@dataclass
class WorkerConfig:
    worker_id: str = "worker-1"
    slots: int = 3
    max_heavy: int = 2
    ledger_tz: str = "UTC"
    database_url: str = field(default="", repr=False)
    supabase_url: str = ""
    service_key: str = field(default="", repr=False)
    openrouter_key: str = field(default="", repr=False)
    tick_secret: str = field(default="", repr=False)
    work_dir: Path = field(default_factory=lambda: Path(tempfile.gettempdir()) / "vbeat-work")
    port: int = 8080
    public_url: str | None = None
    stale: str = "90 seconds"          # what claim_job treats as a dead worker (heartbeat older than this)
    poll_s: float = 2.0
    heartbeat_s: float = 15.0
    register_s: float = 10.0
    settings_refresh_s: float = 2.0
    version: str = __version__

    def sanitized(self) -> dict:
        return {"worker_id": self.worker_id, "slots": self.slots, "max_heavy": self.max_heavy, "ledger_tz": self.ledger_tz, "port": self.port,
                "public_url": self.public_url, "work_dir": str(self.work_dir), "version": self.version,
                "has": {n: bool(v) for n, v in (("DATABASE_URL", self.database_url), ("SUPABASE_URL", self.supabase_url),
                                                ("SUPABASE_SERVICE_ROLE_KEY", self.service_key), ("OPENROUTER_API_KEY", self.openrouter_key),
                                                ("TICK_SECRET", self.tick_secret))}}


def _int(e: Mapping[str, str], name: str, default: int, minimum: int = 1) -> int:
    raw = e.get(name)
    if raw in (None, ""):
        return default
    try:
        v = int(raw)
    except ValueError:
        raise ConfigError(f"{name} must be a whole number, got {raw!r}. Fix the value of {name} in the worker's environment.") from None
    if v < minimum:
        raise ConfigError(f"{name} must be at least {minimum}, got {v}.")
    return v


def load_config(env: Mapping[str, str] | None = None, *, require: tuple[str, ...] = ("DATABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")) -> WorkerConfig:
    e = os.environ if env is None else env
    missing = [n for n in require if not e.get(n)]
    if missing:
        raise ConfigError("Missing environment variable(s): " + ", ".join(missing) + ". Set them in the worker's environment (names only in backend/deploy/env.example); "
                          "DATABASE_URL is the Supabase *session pooler* connection string (it works over IPv4).")
    for n in SECRET_NAMES:
        register_secret(e.get(n) or None)
    cfg = WorkerConfig(worker_id=e.get("WORKER_ID") or "worker-1", slots=_int(e, "WORKER_SLOTS", 3), max_heavy=_int(e, "VBEAT_MAX_HEAVY", 2),
                       ledger_tz=e.get("VBEAT_LEDGER_TZ") or "UTC", database_url=e.get("DATABASE_URL", ""), supabase_url=(e.get("SUPABASE_URL") or "").rstrip("/"),
                       service_key=e.get("SUPABASE_SERVICE_ROLE_KEY", ""), openrouter_key=e.get("OPENROUTER_API_KEY", ""), tick_secret=e.get("TICK_SECRET", ""),
                       port=_int(e, "PORT", 8080), public_url=e.get("WORKER_PUBLIC_URL") or None)
    if e.get("VBEAT_WORK_DIR"):
        cfg.work_dir = Path(e["VBEAT_WORK_DIR"])
    return cfg
