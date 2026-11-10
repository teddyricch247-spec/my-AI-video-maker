"""Mirror: lets a backend copy a run's conversation and state elsewhere (a database) while the disk stays the source of truth.

    class Mirror(Protocol):
        def message(self, m: dict) -> None      # after each message is appended to conversation.jsonl (redacted, `_meta` kept)
        def state(self, st: dict) -> None       # after StateStore writes, at most once a second, plus one final call per run

The runner writes the disk FIRST and then calls the mirror. A mirror that raises is logged and ignored: it can never stop a run.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Any, Callable, Protocol, runtime_checkable

log = logging.getLogger("vbeat_agent.mirror")


@runtime_checkable
class Mirror(Protocol):
    def message(self, m: dict[str, Any]) -> None: ...
    def state(self, st: dict[str, Any]) -> None: ...


def public_state(st: dict[str, Any]) -> dict[str, Any]:
    """The state dict without the runner's internal underscore keys (e.g. `_run_base`)."""
    return {k: v for k, v in st.items() if not k.startswith("_")}


class SafeMirror:
    """Wraps a Mirror: swallows and logs its exceptions, throttles `state` to one call per `min_interval` seconds, and adds `final`."""

    def __init__(self, mirror: Mirror, min_interval: float = 1.0, clock: Callable[[], float] = time.monotonic):
        self.mirror, self.min_interval, self.clock = mirror, min_interval, clock
        self._last = float("-inf")
        self._pending: dict[str, Any] | None = None
        self._lock = threading.Lock()

    def message(self, m: dict[str, Any]) -> None:
        try:
            self.mirror.message(m)
        except Exception:  # noqa: BLE001 - the disk already has it; a mirror failure must never stop a run
            log.exception("mirror.message failed (the run continues; the disk has the message)")

    def state(self, st: dict[str, Any]) -> None:
        with self._lock:
            now = self.clock()
            if now - self._last < self.min_interval:
                self._pending = st                      # newest wins; sent by the next call after the interval, or by final()
                return
            self._last, self._pending = now, None
        self._send(st)

    def final(self, st: dict[str, Any]) -> None:
        """Always sends: the last state of the run, whatever the throttle says."""
        with self._lock:
            self._last, self._pending = self.clock(), None
        self._send(st)

    def _send(self, st: dict[str, Any]) -> None:
        try:
            self.mirror.state(public_state(st))
        except Exception:  # noqa: BLE001
            log.exception("mirror.state failed (the run continues; the disk has the state)")
