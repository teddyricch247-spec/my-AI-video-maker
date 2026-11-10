"""Environment, defaults and the dataclasses for caps and settings.

Precedence everywhere: CLI flag > environment variable > default. Model names are configuration, never hard-coded.
"""
from __future__ import annotations

import json
import os
import tempfile
from dataclasses import asdict, dataclass, field, fields, replace
from pathlib import Path
from typing import Any, Mapping

from .killswitch import default_state_dir
from .redact import register_secret

DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"


def repo_root() -> Path:
    """The vbeat checkout the tools live in. `VBEAT_REPO` overrides (a render worker may keep the checkout elsewhere)."""
    env = os.environ.get("VBEAT_REPO")
    if env:
        return Path(env).resolve()
    return Path(__file__).resolve().parents[3]          # agent/src/vbeat_agent/config.py -> repo


@dataclass(frozen=True)
class Caps:
    """Limits for one run of the loop (one `run_beat` or one `continue_beat`). All enforced by the loop, all recorded."""
    max_steps: int = 40                    # LLM turns
    max_minutes: float = 15.0              # wall clock
    max_usd: float = 0.50                  # cost of this run of one beat
    max_tool_errors_in_a_row: int = 6
    context_budget: int = 60_000           # approximate tokens (chars / 4); the loop compacts above this

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: Mapping[str, Any] | None) -> "Caps":
        names = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in (d or {}).items() if k in names})

    def with_overrides(self, **kw: Any) -> "Caps":
        return replace(self, **{k: v for k, v in kw.items() if v is not None})


# per-tool timeouts in seconds (a timeout is a tool_fault)
DEFAULT_TIMEOUTS: dict[str, float] = {
    "ingest": 30, "spec": 30, "strip": 60, "frames": 60, "markers": 60,
    "check_fast": 90, "check_full": 150,       # full > the engine's own 120 s watchdog, so the engine reports first
    "sfx_spec": 30, "sfx_render": 60,
    "pipeline_base": 180, "pipeline_per_s": 40,  # finish: base + per second of beat
}


@dataclass
class Settings:
    api_key: str | None = field(default=None, repr=False)   # memory only: never logged, never written to disk
    base_url: str = DEFAULT_BASE_URL
    referer: str = "vbeat"
    title: str = "vbeat"
    beat_model: str | None = None
    beat_concurrency: int = 4
    max_heavy: int = field(default_factory=lambda: max(1, (os.cpu_count() or 2) // 2))
    max_usd_per_beat: float = 0.50            # per beat, per run_beat / continue_beat
    max_usd_per_run: float = 5.00             # one run_beats() batch
    max_usd_per_day: float = 10.00            # everything on this machine, enforced by the ledger
    ledger_tz: str = "UTC"                    # where the day starts and ends for the daily cap
    state_dir: Path = field(default_factory=default_state_dir)
    log_level: str = "INFO"
    request_timeout: float = 180.0
    max_attempts: int = 4
    temperature: float = 0.3
    max_tokens: int | None = 12_000
    unknown_call_cost_usd: float = 0.05       # budget charge for a call whose cost the API did not report
    inflight_estimate_usd: float = 0.02       # shared budget: reserve per call before the real cost is known
    provider: dict | None = None              # OpenRouter provider preferences, passed through unchanged
    models_fallback: list[str] | None = None  # OpenRouter `models` fallback list, passed through unchanged
    send_usage_flag: bool = True              # send {"usage": {"include": true}} (harmless where usage is always returned)
    images: str = "auto"                      # auto | on | off: attach preview images for models that can see them
    write_check_level: str = "fast"           # the automatic check after write_scene
    sfx_peak_dbfs: float = -6.0
    child_mem_mb: int = 0                     # RLIMIT_AS for tool subprocesses; 0 = off (Chromium needs a huge address space)
    strip_each_version: bool = False          # also render the contact sheet after every passing write_scene
    cache_dir: Path = field(default_factory=lambda: Path(tempfile.gettempdir()) / "vbeat-agent-cache")
    assets_dir: Path = field(default_factory=lambda: repo_root() / "motion-assets" / "assets")
    timeouts: dict[str, float] = field(default_factory=lambda: dict(DEFAULT_TIMEOUTS))

    def default_caps(self) -> Caps:
        return Caps(max_usd=self.max_usd_per_beat)


def _env_json(env: Mapping[str, str], name: str) -> Any:
    raw = env.get(name)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{name} is not valid JSON: {exc}") from None


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    """Settings from the environment (documented in agent/README.md). Unset variables keep the defaults."""
    e = os.environ if env is None else env
    s = Settings()
    s.api_key = e.get("OPENROUTER_API_KEY") or None
    register_secret(s.api_key)
    s.base_url = e.get("OPENROUTER_BASE_URL") or s.base_url
    s.referer = e.get("VBEAT_REFERER") or s.referer
    s.title = e.get("VBEAT_TITLE") or s.title
    s.beat_model = e.get("VBEAT_BEAT_MODEL") or None
    if e.get("VBEAT_BEAT_CONCURRENCY"):
        s.beat_concurrency = max(1, int(e["VBEAT_BEAT_CONCURRENCY"]))
    if e.get("VBEAT_MAX_HEAVY"):
        s.max_heavy = max(1, int(e["VBEAT_MAX_HEAVY"]))
    if e.get("VBEAT_MAX_USD_PER_BEAT"):
        s.max_usd_per_beat = float(e["VBEAT_MAX_USD_PER_BEAT"])
    if e.get("VBEAT_MAX_USD_PER_RUN"):
        s.max_usd_per_run = float(e["VBEAT_MAX_USD_PER_RUN"])
    if e.get("VBEAT_MAX_USD_PER_DAY"):
        s.max_usd_per_day = float(e["VBEAT_MAX_USD_PER_DAY"])
    s.ledger_tz = e.get("VBEAT_LEDGER_TZ") or s.ledger_tz
    if e.get("VBEAT_STATE_DIR"):
        s.state_dir = Path(e["VBEAT_STATE_DIR"])
    s.log_level = (e.get("VBEAT_LOG_LEVEL") or s.log_level).upper()
    if e.get("VBEAT_REQUEST_TIMEOUT"):
        s.request_timeout = float(e["VBEAT_REQUEST_TIMEOUT"])
    if e.get("VBEAT_MAX_TOKENS"):
        s.max_tokens = int(e["VBEAT_MAX_TOKENS"]) or None
    if e.get("VBEAT_TEMPERATURE"):
        s.temperature = float(e["VBEAT_TEMPERATURE"])
    s.provider = _env_json(e, "VBEAT_PROVIDER")
    if e.get("VBEAT_MODELS_FALLBACK"):
        s.models_fallback = [m.strip() for m in e["VBEAT_MODELS_FALLBACK"].split(",") if m.strip()]
    if e.get("VBEAT_USAGE_FLAG") in ("0", "false", "no"):
        s.send_usage_flag = False
    if e.get("VBEAT_IMAGES"):
        s.images = e["VBEAT_IMAGES"].lower()
    if e.get("VBEAT_WRITE_CHECK_LEVEL"):
        s.write_check_level = e["VBEAT_WRITE_CHECK_LEVEL"].lower()
    if e.get("VBEAT_CHILD_MEM_MB"):
        s.child_mem_mb = int(e["VBEAT_CHILD_MEM_MB"])
    if e.get("VBEAT_STRIP_EACH_VERSION") in ("1", "true", "yes"):
        s.strip_each_version = True
    if e.get("VBEAT_CACHE_DIR"):
        s.cache_dir = Path(e["VBEAT_CACHE_DIR"])
    if e.get("VBEAT_ASSETS_DIR"):
        s.assets_dir = Path(e["VBEAT_ASSETS_DIR"])
    if s.images not in ("auto", "on", "off"):
        raise ValueError("VBEAT_IMAGES must be auto, on or off")
    if s.write_check_level not in ("fast", "full"):
        raise ValueError("VBEAT_WRITE_CHECK_LEVEL must be fast or full")
    return s
