import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
for p in (BACKEND / "src", BACKEND / "tests", REPO / "agent" / "tests", REPO / "shared" / "src", REPO / "agent" / "src", REPO / "engine" / "src", REPO / "audio" / "src", REPO / "pipeline" / "src"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))


@pytest.fixture(autouse=True)
def _isolated(tmp_path_factory, monkeypatch):
    """Own state dir per test; no kill-switch provider or heavy-gate statistics leak between tests."""
    from vbeat_agent import killswitch, toolrun
    d = tmp_path_factory.mktemp("vbeat-state")
    monkeypatch.setenv("VBEAT_STATE_DIR", str(d))
    monkeypatch.delenv("VBEAT_KILL", raising=False)
    killswitch.configure(None)
    killswitch.register_provider(None)
    toolrun._after_spawn.clear()
    toolrun.HEAVY.reset_stats()
    yield d
    killswitch.configure(None)
    killswitch.register_provider(None)
    toolrun._after_spawn.clear()
