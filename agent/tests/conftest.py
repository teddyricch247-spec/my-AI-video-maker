import asyncio
import sys
from pathlib import Path

import pytest

AGENT = Path(__file__).resolve().parents[1]
REPO = AGENT.parent
for p in (AGENT / "src", AGENT / "tests", REPO / "shared" / "src", REPO / "engine" / "src", REPO / "audio" / "src", REPO / "pipeline" / "src"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

EXAMPLE_TRANSCRIPT = REPO / "examples" / "transcript.json"
EXAMPLE_SCENE = REPO / "examples" / "beats" / "big_number" / "scene.js"
EXAMPLE_CUE = REPO / "examples" / "beats" / "big_number" / "cue.py"
SCRIPTS = AGENT / "tests" / "scripts"


def run(coro):
    """No pytest-asyncio in this repo: tests drive coroutines with asyncio.run."""
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def _isolated_state(tmp_path_factory, monkeypatch):
    """Every test gets its own state directory (ledger, kill switch): tests must never touch the operator's real ones."""
    from vbeat_agent import killswitch
    d = tmp_path_factory.mktemp("vbeat-state")
    monkeypatch.setenv("VBEAT_STATE_DIR", str(d))
    monkeypatch.delenv("VBEAT_KILL", raising=False)
    killswitch.configure(None)
    killswitch.register_provider(None)
    yield d
    killswitch.configure(None)
    killswitch.register_provider(None)


@pytest.fixture(autouse=True)
def _reset_heavy_gate():
    from vbeat_agent import toolrun
    toolrun._after_spawn.clear()
    toolrun.HEAVY.reset_stats()
    yield
    toolrun._after_spawn.clear()
