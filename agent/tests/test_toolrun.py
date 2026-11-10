"""toolrun: envelope handling, faults, timeouts, cancellation, the heavy gate, and the real engine from Python."""
import asyncio
import json
import os
import signal
import sys
import time
from pathlib import Path

import pytest
from conftest import EXAMPLE_CUE, EXAMPLE_SCENE, EXAMPLE_TRANSCRIPT, REPO, run

from vbeat_agent import toolrun
from vbeat_agent.config import Settings
from vbeat_agent.state import BeatPaths
from vbeat_agent.toolrun import (Cancelled, CancelSignal, HeavyGate, ToolFault, ToolTimeout, Toolbox, parse_envelope, run_tool)
from vbeat_shared.envelope import Outcome, make_envelope

OK_ENV = json.dumps(make_envelope("x", report={"ok": True}))


def test_parse_envelope_accepts_one_line():
    env = parse_envelope(OK_ENV + "\n", module="m", command="c", returncode=0, stderr="")
    assert env["command"] == "x"


@pytest.mark.parametrize("stdout", ["", "\n\n", OK_ENV + "\n" + OK_ENV, "not json", json.dumps({"ok": True}), json.dumps([1])])
def test_parse_envelope_rejects_everything_else_as_a_tool_fault(stdout):
    with pytest.raises(ToolFault):
        parse_envelope(stdout, module="m", command="c", returncode=0, stderr="boom")


def test_tool_fault_carries_stderr_tail():
    with pytest.raises(ToolFault) as e:
        parse_envelope("", module="m", command="c", returncode=-9, stderr="Chromium exploded")
    assert "Chromium exploded" in e.value.detail and "exit -9" in str(e.value)


def _fake_tool(tmp_path: Path, name: str, body: str) -> str:
    """A throwaway module on the child's PYTHONPATH so run_tool can be tested without Chromium."""
    pkg = tmp_path / "fakes"
    pkg.mkdir(exist_ok=True)
    (pkg / f"{name}.py").write_text(body)
    os.environ["PYTHONPATH"] = str(pkg) + os.pathsep + os.environ.get("PYTHONPATH", "")
    return name


@pytest.fixture
def fakes(tmp_path, monkeypatch):
    monkeypatch.setenv("PYTHONPATH", os.environ.get("PYTHONPATH", ""))
    return lambda name, body: _fake_tool(tmp_path, name, body)


def test_run_tool_classifies_through_the_shared_envelope_rules(fakes):
    mod = fakes("fake_ok", "import json\nfrom vbeat_shared.envelope import make_envelope\nprint(json.dumps(make_envelope('ok', report={'ok': False, 'counts': {'error': 1, 'warn': 0}})))\n")
    res = run(run_tool(mod, ["ok"], timeout=20, heavy=False))
    assert res.outcome is Outcome.REPORT_FAILED and res.env["command"] == "ok"
    mod = fakes("fake_content", "import json\nfrom vbeat_shared.envelope import make_envelope, error_obj\nprint(json.dumps(make_envelope('x', ok=False, error=error_obj('SceneError', 'boom'))))\n")
    assert run(run_tool(mod, ["x"], timeout=20, heavy=False)).outcome is Outcome.CONTENT_FAULT
    mod = fakes("fake_tool_failed", "import json\nfrom vbeat_shared.envelope import make_envelope, error_obj\nprint(json.dumps(make_envelope('x', ok=False, error=error_obj('ValueError', 'bad'))))\n")
    assert run(run_tool(mod, ["x"], timeout=20, heavy=False)).outcome is Outcome.TOOL_FAILED


def test_a_crashing_child_is_a_tool_fault_with_its_stderr(fakes):
    mod = fakes("fake_crash", "import os, sys\nsys.stderr.write('segfault-ish')\nos.kill(os.getpid(), 9)\n")
    with pytest.raises(ToolFault) as e:
        run(run_tool(mod, ["x"], timeout=20, heavy=False))
    assert "segfault-ish" in e.value.detail


def _alive(pid: int) -> bool:
    """Running, not just present: a killed orphan stays a zombie ('Z') until PID 1 reaps it, which a container may not do."""
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    try:
        state = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[0]
    except OSError:
        return False
    return state != "Z"


def test_timeout_kills_the_whole_process_group(fakes, tmp_path):
    pidfile = tmp_path / "grandchild.pid"
    mod = fakes("fake_hang", f"import subprocess, sys, time\n"
                             f"p = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])\n"
                             f"open({str(pidfile)!r}, 'w').write(str(p.pid))\ntime.sleep(60)\n")
    t0 = time.time()
    with pytest.raises(ToolTimeout):
        run(run_tool(mod, ["x"], timeout=1.5, heavy=False))
    assert time.time() - t0 < 15
    gpid = int(pidfile.read_text())
    time.sleep(0.3)
    assert not _alive(gpid)                    # the grandchild (stand-in for Chromium) died with its parent


def test_cancel_kills_a_running_tool(fakes):
    mod = fakes("fake_sleep", "import time\ntime.sleep(60)\n")

    async def go():
        sig = CancelSignal()
        task = asyncio.ensure_future(run_tool(mod, ["x"], timeout=60, heavy=False, cancel=sig))
        await asyncio.sleep(0.8)
        sig.trip("operator")
        with pytest.raises(Cancelled) as e:
            await task
        assert e.value.reason == "operator"

    t0 = time.time()
    run(go())
    assert time.time() - t0 < 15


def test_already_cancelled_never_spawns(fakes):
    mod = fakes("fake_never", "raise SystemExit('should not run')\n")

    async def go():
        sig = CancelSignal()
        sig.trip("early")
        with pytest.raises(Cancelled):
            await run_tool(mod, ["x"], timeout=20, heavy=False, cancel=sig)

    run(go())


def test_sentinel_file_counts_as_cancelled(tmp_path):
    s = tmp_path / "CANCEL"
    sig = CancelSignal(sentinel=s)
    assert not sig.is_set()
    s.write_text("")
    assert sig.is_set() and sig.why() == "cancel_file"


def test_heavy_gate_never_exceeds_its_limit(fakes):
    mod = fakes("fake_short", "import json, time\nfrom vbeat_shared.envelope import make_envelope\ntime.sleep(0.4)\nprint(json.dumps(make_envelope('x')))\n")
    gate = HeavyGate(2)
    old = toolrun.HEAVY
    toolrun.HEAVY = gate
    try:
        async def go():
            await asyncio.gather(*[run_tool(mod, ["x"], timeout=30) for _ in range(6)])
        run(go())
    finally:
        toolrun.HEAVY = old
    st = gate.stats()
    assert st["max_seen"] == 2 and st["total"] == 6 and st["current"] == 0


def test_a_slot_is_released_even_when_the_tool_faults(fakes):
    mod = fakes("fake_boom", "import os\nos.kill(os.getpid(), 9)\n")
    gate = HeavyGate(1)
    old = toolrun.HEAVY
    toolrun.HEAVY = gate
    try:
        async def go():
            for _ in range(3):
                with pytest.raises(ToolFault):
                    await run_tool(mod, ["x"], timeout=30)
        run(go())
    finally:
        toolrun.HEAVY = old
    assert gate.stats()["current"] == 0 and gate.stats()["total"] == 3


# ---- the real engine, from Python (slow) -------------------------------------------------------------------------------

class _Req:
    transcript = EXAMPLE_TRANSCRIPT
    fps, from_word, to_word, width, height, idx, title, direction, mode = 30, 0, 8, 1280, 720, 0, "Big number", "dir", "technical"
    params: dict = {}
    media: dict = {}
    sfx_enabled = True


@pytest.mark.render
def test_ingest_spec_check_markers_on_the_example_scene(tmp_path):
    import shutil
    paths = BeatPaths(tmp_path / "beat").ensure()
    shutil.copyfile(EXAMPLE_SCENE, paths.scene)
    box = Toolbox(paths, _Req, Settings())

    async def go():
        r = await box.ingest()
        assert r.outcome is Outcome.PASS and paths.transcript.exists()
        r = await box.spec()
        assert r.outcome is Outcome.PASS
        spec = json.loads(paths.spec.read_text())
        assert spec["beat"]["direction"] == "dir" and len(spec["words"]) == 9
        r = await box.check("fast")
        assert r.outcome is Outcome.PASS and r.report["text"] == "OK: no findings"
        r = await box.markers()
        assert r.outcome is Outcome.PASS
        ids = [m["id"] for m in json.loads(paths.markers.read_text())]
        assert "done" in ids
        shutil.copyfile(EXAMPLE_CUE, paths.cue)
        assert (await box.sfx_spec()).outcome is Outcome.PASS
        r = await box.sfx_render()
        assert r.outcome is Outcome.PASS and (paths.sfx / "sfx.wav").exists()

    run(go())
    assert toolrun.HEAVY.stats()["current"] == 0 and toolrun.HEAVY.stats()["total"] == 6


@pytest.mark.render
def test_scene_faults_are_model_side_outcomes_and_tool_errors_are_not(tmp_path):
    paths = BeatPaths(tmp_path / "beat").ensure()
    paths.scene.write_text("export function draw(rt, t) { rt.lib.draw('tech/big-stat', t, {}; }\n")
    box = Toolbox(paths, _Req, Settings())

    async def go():
        await box.ingest()
        await box.spec()
        r = await box.check("fast")
        assert r.outcome is Outcome.REPORT_FAILED and "C1 error" in r.report["text"]
        r = await box.markers()
        assert r.outcome is Outcome.CONTENT_FAULT and r.error["type"] == "LoadError"
        r = await box.frames([99.0], tmp_path / "f")
        assert r.outcome is Outcome.TOOL_FAILED and "outside this beat" in r.error["message"]

    run(go())
