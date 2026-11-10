"""Settings cache + kill-switch provider. A background thread re-reads `settings` every 2 s; everything on the hot path (the runner's
CancelSignal calls the provider constantly) reads the cached value, never the database."""
from __future__ import annotations

import logging
import threading
import time
from typing import Any

from vbeat_agent.redact import redact

log = logging.getLogger("vbeat_backend.settings")
KILL_REASON = "stopped by kill switch"
DEFAULT_CAPS = {"run_usd": 1.5, "daily_usd": 20.0, "max_steps": 30, "max_minutes": 15, "beat_usd": 0.5}


def truthy(v: Any) -> bool:
    if isinstance(v, str):
        return v.strip().lower() in ("true", "1", "yes", "on")
    return bool(v)


class SettingsCache:
    def __init__(self, db: Any, interval: float = 2.0):
        self.db, self.interval = db, interval
        self._data: dict[str, Any] = {}
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.last_ok: float | None = None
        self.last_error: str | None = None

    def refresh(self) -> bool:
        try:
            data = self.db.settings_all()
        except Exception as exc:  # noqa: BLE001 - keep the previous values; a DB blip must not change behaviour
            self.last_error = redact(f"{type(exc).__name__}: {exc}")[:300]
            log.warning("settings refresh failed: %s", self.last_error)
            return False
        with self._lock:
            self._data = data
        self.last_ok, self.last_error = time.monotonic(), None
        return True

    def start(self) -> "SettingsCache":
        self.refresh()
        self._thread = threading.Thread(target=self._loop, name="settings-refresh", daemon=True)
        self._thread.start()
        return self

    def _loop(self) -> None:
        while not self._stop.wait(self.interval):
            self.refresh()

    def stop(self) -> None:
        self._stop.set()

    def get(self, key: str, default: Any = None) -> Any:
        with self._lock:
            v = self._data.get(key, default)
        return default if v is None else v

    def kill_reason(self) -> str | None:
        """The kill-switch provider the runner polls: synchronous, no I/O."""
        with self._lock:
            return KILL_REASON if truthy(self._data.get("kill_switch")) else None

    def caps(self) -> dict[str, float]:
        c = dict(DEFAULT_CAPS)
        raw = self.get("caps", {})
        if isinstance(raw, dict):
            c.update({k: v for k, v in raw.items() if v is not None})
        return c

    def beat_model(self) -> str | None:
        m = self.get("models", {})
        v = m.get("beat") if isinstance(m, dict) else None
        return v or None
