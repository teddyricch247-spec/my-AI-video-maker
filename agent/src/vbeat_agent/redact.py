"""Secrets hygiene. The OpenRouter key lives in process memory only: it is read from the environment, sent in one HTTP header,
and never written anywhere. Three layers make that hold even when something goes wrong:

1. `redact()` runs on every line the runner persists (state.write_text_atomic / append_line: events, transcript, conversation,
   state) and on every log record (`RedactingFilter`), replacing the registered key and anything shaped like a key.
2. `scrub_env()` removes secret-looking variables from the environment of tool subprocesses: scene and cue code written by the
   model runs in those children and must never be able to read the key.
3. The key is never an argument (no `--api-key`: it would show in the process list and shell history) and never part of
   a dataclass repr or of `request.json` / `state.json`.
"""
from __future__ import annotations

import logging
import re
from typing import Mapping

REDACTED = "[REDACTED]"
_registered: set[str] = set()

_PATTERNS = [
    re.compile(r"sk-or-[A-Za-z0-9_\-]{10,}"),
    re.compile(r"(?i)bearer\s+[A-Za-z0-9._~+/=\-]{16,}"),
    re.compile(r"\bsk-[A-Za-z0-9]{20,}"),
]
_SENSITIVE_NAME = re.compile(r"(?i)(key|secret|token|passw|credential|auth|cookie|session)")
_KEEP_NAMES = {"PYTHONPATH", "PLAYWRIGHT_BROWSERS_PATH", "SSH_AUTH_SOCK_NOT_KEPT"}


def register_secret(value: str | None) -> None:
    """Remember a secret value so redact() can remove it wherever it shows up. Short values are ignored (too many false hits)."""
    if value and len(value) >= 8:
        _registered.add(value)


def redact(text: str) -> str:
    if not text:
        return text
    for s in _registered:
        if s in text:
            text = text.replace(s, REDACTED)
    for p in _PATTERNS:
        text = p.sub(REDACTED, text)
    return text


def scrub_env(env: Mapping[str, str]) -> dict[str, str]:
    """A copy of `env` without secret-looking variables (names containing key, secret, token, password, auth, ...)."""
    return {k: v for k, v in env.items() if k in _KEEP_NAMES or not _SENSITIVE_NAME.search(k)}


class RedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            record.msg = redact(record.getMessage())
            record.args = ()
            if record.exc_info:
                record.exc_text = redact(logging.Formatter().formatException(record.exc_info))
        except Exception:  # noqa: BLE001 - never let logging break the run
            pass
        return True


_installed = False


def install_log_redaction() -> None:
    """Attach the filter to every handler of the root logger and to the `vbeat_agent` logger (idempotent)."""
    global _installed
    f = RedactingFilter()
    logging.getLogger("vbeat_agent").addFilter(f)
    for h in logging.getLogger().handlers:
        if not any(isinstance(x, RedactingFilter) for x in h.filters):
            h.addFilter(f)
    _installed = True
