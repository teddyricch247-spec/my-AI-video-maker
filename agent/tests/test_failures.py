"""Failure paths with the REAL engine/audio tools and a scripted model: what the model is told, what survives, what the result says."""
import asyncio
import json
import os
import signal
from pathlib import Path

import pytest
from conftest import EXAMPLE_TRANSCRIPT, SCRIPTS, run
from fake_llm import FakeLLM

from vbeat_agent import toolrun
from vbeat_agent.beat import BeatRequest, continue_beat, revert_beat, run_beat
from vbeat_agent.config import Caps, Settings
from vbeat_agent.events import ListSink
from vbeat_agent.state import BeatBusy, BeatPaths, StateStore, VersionStore

pytestmark = pytest.mark.render

GOOD = (SCRIPTS / "golden_scene_v2.js").read_text()
CUE = (SCRIPTS / "golden_cue.py").read_text()
THROWS = GOOD.replace("export function draw(rt, t) {", "export function draw(rt, t) {\n  if (t > 1) throw new Error('boom at ' + t.toFixed(1));", 1)
THROWS2 = GOOD.replace("export function draw(rt, t) {", "export function draw(rt, t) {\n  if (t > 2) throw new Error('second boom');", 1)
GOOD_B = GOOD.replace("'LAST YEAR'", "'THIS YEAR'")


def req(tmp_path, name="beat", **kw):
    d = dict(beat_dir=tmp_path / name, transcript=EXAMPLE_TRANSCRIPT, from_word=0, to_word=8, width=1280, height=720, idx=0, model="fake/model")
    d.update(kw)
    return BeatRequest(**d)


def S(state_dir, **kw):
    return Settings(state_dir=state_dir, api_key=None, **kw)


def ws(src):
    return {"tool_calls": [{"name": "write_scene", "arguments": {"source": src}}], "usage": {"cost": 0.001}}


def wc(src):
    return {"tool_calls": [{"name": "write_cue", "arguments": {"source": src}}], "usage": {"cost": 0.001}}


def call(name, **args):
    return {"tool_calls": [{"name": name, "arguments": args}], "usage": {"cost": 0.001}}


def tool_results(tmp_path, name="beat"):
    out = []
    for ln in (tmp_path / name / "agent" / "conversation.jsonl").read_text().splitlines():
        m = json.loads(ln)
        if m["role"] == "tool":
            out.append(json.loads(m["content"]))
    return out


def test_a_throwing_scene_is_reported_and_the_best_version_survives_a_bad_stop(tmp_path, _isolated_state):
    llm = FakeLLM([ws(THROWS), ws(GOOD), ws(THROWS2), call("give_up", reason="out of ideas")])
    sink = ListSink()
    r = run(run_beat(req(tmp_path), sink=sink, llm=llm, settings=S(_isolated_state)))
    t = tool_results(tmp_path)
    assert t[0]["ok"] is False and "boom" in t[0]["error"] + t[0].get("text", "") and t[0]["kind"] == "model_fault"
    assert t[1]["ok"] is True
    assert r.status == "needs_attention" and r.status_reason == "give_up" and r.scene_n == 2           # restored to the version that passed
    d = tmp_path / "beat"
    assert (d / "scene.js").read_text() == (d / "versions" / "scene_002.js").read_text() == GOOD
    st = json.loads((d / "agent" / "state.json").read_text())
    assert st["restored_best"] and st["restored_best"]["scene"] == 2
    assert any(e["type"] == "note" and "best scene (v2)" in e["text"] for e in sink.events)


def test_cap_stop_leaves_usable_files(tmp_path, _isolated_state):
    r = run(run_beat(req(tmp_path, caps=Caps(max_steps=2)), llm=FakeLLM([ws(GOOD), call("get_beat_info"), call("get_beat_info")]), settings=S(_isolated_state)))
    d = tmp_path / "beat"
    assert r.status_reason == "cap:max_steps" and (d / "scene.js").read_text() == GOOD and (d / "versions" / "scene_001.js").exists()
    assert r.final_video is None and r.explanation["fix"]


def test_forbidden_cue_code_is_refused_with_a_finding_not_executed(tmp_path, _isolated_state):
    marker = tmp_path / "pwned"
    evil = f"import os\nos.system('touch {marker}')\n" + CUE
    llm = FakeLLM([ws(GOOD), wc(evil), wc(CUE), call("ask_user", question="ok?")])
    r = run(run_beat(req(tmp_path), llm=llm, settings=S(_isolated_state)))
    t = tool_results(tmp_path)
    assert t[1]["ok"] is False and "A0" in json.dumps(t[1]), t[1]
    assert not marker.exists()                                                                          # the model's code never ran
    assert t[2]["ok"] is True and r.status == "waiting_user" and r.sfx_n == 2


def test_oversized_and_fenced_sources(tmp_path, _isolated_state):
    huge = GOOD + "\n// " + "x" * 210_000
    fenced = "```javascript\n" + GOOD + "\n```"
    r = run(run_beat(req(tmp_path), llm=FakeLLM([ws(huge), ws(fenced), call("ask_user", question="q")]), settings=S(_isolated_state)))
    t = tool_results(tmp_path)
    assert t[0]["ok"] is False and "200" in t[0]["error"]
    assert t[1]["ok"] is True and r.scene_n == 1
    assert (tmp_path / "beat" / "versions" / "scene_001.js").read_text().strip() == GOOD.strip()        # the fence was stripped, only one version exists


def test_unknown_word_ids_are_caught_before_rendering(tmp_path, _isolated_state):
    bad = GOOD.replace("rt.at('w0007')", "rt.at('w9999')")
    llm = FakeLLM([ws(bad), call("ask_user", question="q")])
    run(run_beat(req(tmp_path), llm=llm, settings=S(_isolated_state)))
    t = tool_results(tmp_path)[0]
    assert t["ok"] is False and "w9999" in t["error"] and "w0007" in t["error"]                         # says what exists


def test_chromium_killed_mid_check_is_retried_once_and_the_run_goes_on(tmp_path, _isolated_state):
    seen = []

    def killer(proc, module, argv):
        if module.endswith("vbeat_sprite") or "sprite" in module:
            if "check" in [str(a) for a in argv]:
                seen.append(1)
                if len(seen) == 1:
                    os.killpg(proc.pid, signal.SIGKILL) if hasattr(proc, "pid") else proc.kill()
    toolrun._after_spawn.append(killer)
    r = run(run_beat(req(tmp_path), llm=FakeLLM([ws(GOOD), call("ask_user", question="q")]), settings=S(_isolated_state)))
    assert r.status == "waiting_user" and len(seen) >= 2, (r.to_dict(), seen)                          # killed once, retried, passed
    assert toolrun.HEAVY.stats()["current"] == 0


def test_a_tool_that_keeps_dying_fails_the_run_as_the_machines_fault(tmp_path, _isolated_state):
    def killer(proc, module, argv):
        if "check" in [str(a) for a in argv]:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                proc.kill()
    toolrun._after_spawn.append(killer)
    r = run(run_beat(req(tmp_path), llm=FakeLLM([ws(GOOD), call("ask_user", question="q")]), settings=S(_isolated_state)))
    assert r.status == "failed" and r.status_reason.startswith("tool_fault:"), r.to_dict()
    assert "selftest" in r.explanation["fix"] and toolrun.HEAVY.stats()["current"] == 0
    assert (tmp_path / "beat" / "versions" / "scene_001.js").exists()                                  # the model's work was saved before the check


def test_revert_beat_points_files_back_and_marks_the_final_stale(tmp_path, _isolated_state):
    st = S(_isolated_state)
    llm = FakeLLM([ws(GOOD), wc(CUE), ws(GOOD_B), call("ask_user", question="q")])
    run(run_beat(req(tmp_path), llm=llm, settings=st))
    d = tmp_path / "beat"
    assert (d / "scene.js").read_text() == GOOD_B
    (d / "final.mp4").write_bytes(b"x")
    StateStore(BeatPaths(d)).update(final_video=str(d / "final.mp4"))
    revert_beat(d, scene_n=1)
    s = json.loads((d / "agent" / "state.json").read_text())
    assert (d / "scene.js").read_text() == GOOD and s["scene_n"] == 1 and s["final_stale"] is True and not (d / "scene.js").is_symlink()
    assert [v["is_current"] for v in VersionStore(BeatPaths(d), StateStore(BeatPaths(d))).list_scene_versions()] == [True, False]
    more = FakeLLM([call("ask_user", question="again?")])
    r = run(continue_beat(d, "Go back to the first idea but fix the label.", llm=more, settings=st))
    assert r.final_video is None and any("Current versions: scene v1" in str(m["content"]) for m in more.calls[0]["messages"])
    with pytest.raises(KeyError, match=r"existing: \[1, 2\]"):                                          # names the versions that do exist
        revert_beat(d, scene_n=42)


def test_revert_is_refused_while_the_beat_runs(tmp_path, _isolated_state):
    async def go():
        t = asyncio.ensure_future(run_beat(req(tmp_path), llm=FakeLLM([{**call("get_beat_info"), "delay_s": 4}]), settings=S(_isolated_state)))
        await asyncio.sleep(2.0)
        with pytest.raises(BeatBusy):
            revert_beat(tmp_path / "beat", scene_n=1)
        await t
    run(go())


def test_kill_switch_during_a_real_tool_stops_it_quickly(tmp_path, _isolated_state):
    from vbeat_agent import killswitch

    async def go():
        killswitch.configure(_isolated_state)
        t0 = asyncio.get_event_loop().time()
        t = asyncio.ensure_future(run_beat(req(tmp_path), llm=FakeLLM([ws(GOOD), call("check_scene", level="full"), call("ask_user", question="q")]), settings=S(_isolated_state)))
        await asyncio.sleep(0.5)
        killswitch.engage("test")
        r = await asyncio.wait_for(t, 30)
        return r, asyncio.get_event_loop().time() - t0
    r, dt = run(go())
    assert r.status == "cancelled" and r.status_reason == "kill_switch" and dt < 15
    assert toolrun.HEAVY.stats()["current"] == 0
