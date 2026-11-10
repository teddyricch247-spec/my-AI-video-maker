"""The kill switch: one switch that halts every run on this machine.

Engaged means: no new LLM call starts, no new tool subprocess starts, running tool subprocesses are killed, and every run ends
`cancelled` with reason `kill_switch` (its files and conversation are kept, so it can be continued later). Three ways to engage:

- a file `<state_dir>/KILL` (works across processes and survives restarts: `engage()` / `python -m vbeat_agent kill`),
- the environment variable `VBEAT_KILL=1` (needs a restart of the process; useful in the hosting platform's settings),
- `engage()` from Python (the backend's "stop everything" button).

The check is one `os.stat` and runs before every LLM call, every tool call and every second while a tool runs.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Callable

from .state import now_iso, write_text_atomic

_override: Path | None = None
_provider: Callable[[], str | None] | None = None


def default_state_dir() -> Path:
    env = os.environ.get("VBEAT_STATE_DIR")
    if env:
        return Path(env)
    return Path.home() / ".vbeat-agent"


def configure(state_dir: Path | None) -> None:
    """Point the kill switch (and the ledger) at a state directory chosen in code instead of the environment."""
    global _override
    _override = Path(state_dir) if state_dir else None


def state_dir() -> Path:
    return _override or default_state_dir()


def kill_path() -> Path:
    return state_dir() / "KILL"


def register_provider(fn: Callable[[], str | None] | None) -> None:
    """Add a third source to `engaged()`: `fn() -> reason | None`. It is called in hot paths (every LLM call, every tool call, every second
    while a tool runs), so it must be synchronous and fast: a backend keeps a cached value fresh from a background task and returns that.
    `None` removes the provider. An exception in the provider is treated as "not engaged" (a broken provider must not stop every run)."""
    global _provider
    _provider = fn


def has_provider() -> bool:
    return _provider is not None


def engaged() -> str | None:
    """None when running is allowed, otherwise a short reason. Sources, in order: the environment, the KILL file, the provider."""
    if os.environ.get("VBEAT_KILL", "").lower() in ("1", "true", "yes", "on"):
        return "VBEAT_KILL is set in the environment"
    p = kill_path()
    try:
        if p.exists():
            try:
                return json.loads(p.read_text()).get("reason") or "kill file present"
            except (json.JSONDecodeError, OSError):
                return "kill file present"
    except OSError:
        pass
    if _provider is not None:
        try:
            return _provider() or None
        except Exception:  # noqa: BLE001 - a broken provider must not halt (or crash) every run
            return None
    return None


def engage(reason: str = "operator") -> Path:
    p = kill_path()
    write_text_atomic(p, json.dumps({"reason": reason, "at": now_iso(), "pid": os.getpid()}))
    return p


def release() -> bool:
    """Remove the kill file. (Cannot clear VBEAT_KILL: that lives in the process environment.)"""
    try:
        kill_path().unlink()
        return True
    except FileNotFoundError:
        return False
