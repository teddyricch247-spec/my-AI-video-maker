"""bootstrap.sh: idempotent, never prints/writes the key, says what/why/fix. (Runs the real checks, so it needs Chromium.)"""
import os
import subprocess
from pathlib import Path

import pytest
from conftest import AGENT, REPO
from fake_server import FakeOpenRouter, Reply

pytestmark = pytest.mark.render
SCRIPT = AGENT / "scripts" / "bootstrap.sh"
KEY = "sk-or-v1-" + "7e6d5c4b" * 6


@pytest.fixture
def srv():
    with FakeOpenRouter() as s:
        s.queue("/key", Reply(200, {"data": {"limit": 20, "usage": 1, "limit_remaining": 19}}))
        s.queue("/models", Reply(200, {"data": [{"id": "ok/model", "supported_parameters": ["tools"]}]}))
        yield s


def boot(tmp_path, srv, *args, key=KEY):
    env = {"PATH": os.environ["PATH"], "HOME": str(tmp_path / "home"), "VBEAT_STATE_DIR": str(tmp_path / "state"), "VBEAT_CACHE_DIR": str(tmp_path / "cache"),
           "OPENROUTER_BASE_URL": srv.base_url,        # HOME is faked (to prove nothing is written there), so point Playwright at the real browser cache
           "PLAYWRIGHT_BROWSERS_PATH": os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or str(Path.home() / ".cache" / "ms-playwright")}
    (tmp_path / "home").mkdir(exist_ok=True)
    if key:
        env["OPENROUTER_API_KEY"] = key
    return subprocess.run(["bash", str(SCRIPT), *args], capture_output=True, text=True, env=env, timeout=300, cwd=str(REPO))


def snapshot(root: Path) -> dict:
    return {str(p.relative_to(root)): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file() and p.name not in ("ledger.lock",)}


def test_ready_run_is_idempotent_and_never_touches_the_key(srv, tmp_path):
    a = boot(tmp_path, srv, "--skip-selftest", "--model", "ok/model")
    assert a.returncode == 0, a.stderr
    assert "READY" in a.stderr and "OPENROUTER_API_KEY is set in the environment (value not shown)" in a.stderr
    assert (tmp_path / "state").is_dir() and oct((tmp_path / "state").stat().st_mode & 0o777) == "0o700"
    before = snapshot(tmp_path / "state")
    b = boot(tmp_path, srv, "--skip-selftest", "--model", "ok/model")
    assert b.returncode == 0 and "Installing" not in b.stderr and "Installing" not in a.stderr      # nothing to install, second time or first here
    assert snapshot(tmp_path / "state") == before                                                   # re-running changes nothing
    assert KEY not in a.stdout + a.stderr + b.stdout + b.stderr
    for root in (tmp_path / "state", tmp_path / "cache", tmp_path / "home", REPO / "agent" / "scripts"):
        for p in root.rglob("*"):
            if p.is_file():
                assert KEY.encode() not in p.read_bytes(), p


def test_without_a_key_it_reports_instead_of_asking(srv, tmp_path):
    p = boot(tmp_path, srv, "--skip-selftest", key=None)
    assert p.returncode == 1 and "OPENROUTER_API_KEY is not set" in p.stderr and "never in a file" in p.stderr
    assert "NOT READY" in p.stderr and not srv.requests                                              # no key -> OpenRouter never contacted


def test_check_only_changes_nothing(srv, tmp_path):
    p = boot(tmp_path, srv, "--check-only", "--skip-selftest", "--model", "ok/model")
    assert p.returncode == 0, p.stderr
    assert "can be created" in p.stderr and "Installing" not in p.stderr


def test_bad_option(srv, tmp_path):
    assert boot(tmp_path, srv, "--nonsense").returncode == 2
