import asyncio
import json
import time
from pathlib import Path

from fake_db import FakeDb, FakeStorage
from fake_llm import FakeLLM

from vbeat_agent import killswitch
from vbeat_agent.config import Settings
from vbeat_backend.config import WorkerConfig
from vbeat_backend.worker.context import WorkerContext
from vbeat_backend.worker.killswitch import SettingsCache

REPO = Path(__file__).resolve().parents[2]
SCRIPTS = REPO / "agent" / "tests" / "scripts"
EXAMPLE_TRANSCRIPT = REPO / "examples" / "transcript.json"


def run(coro):
    return asyncio.run(coro)


def make_cfg(tmp_path: Path, worker_id="worker-1", slots=3, **kw) -> WorkerConfig:
    cfg = WorkerConfig(worker_id=worker_id, slots=slots, work_dir=tmp_path / f"work-{worker_id}", poll_s=0.05, heartbeat_s=0.2, register_s=0.2, settings_refresh_s=0.05, **kw)
    cfg.work_dir.mkdir(parents=True, exist_ok=True)
    return cfg


def make_ctx(tmp_path: Path, db: FakeDb, storage: FakeStorage | None = None, *, worker_id="worker-1", slots=3, llm_factory=None, max_heavy=2) -> WorkerContext:
    cfg = make_cfg(tmp_path, worker_id, slots, max_heavy=max_heavy)
    cache = SettingsCache(db, 0.05).start()                       # what run_worker does: a refresher thread + the provider
    killswitch.register_provider(cache.kill_reason)
    rs = Settings(state_dir=cfg.work_dir / "state", api_key=None, max_heavy=max_heavy)
    rs.state_dir.mkdir(parents=True, exist_ok=True)
    return WorkerContext(cfg=cfg, db=db, storage=storage or FakeStorage(), cache=cache, runner_settings=rs, llm_factory=llm_factory)


def example_words():
    d = json.loads(EXAMPLE_TRANSCRIPT.read_text())
    return d


def script_llm(name="golden.json"):
    return FakeLLM.from_file(SCRIPTS / name)


def wait_until(cond, timeout=60.0, step=0.05):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(step)
    return False


async def await_until(cond, timeout=60.0, step=0.05):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return True
        await asyncio.sleep(step)
    return False
