"""The golden path: the whole seam with the REAL engine, audio and pipeline tools and a scripted model (a test double).

get_beat_info -> search/get_asset -> write_scene (deliberate C4) -> check_scene full reads the finding -> write_scene (fixed)
-> preview -> get_markers -> write_cue -> check_scene full -> finish.  Asserts a verified final.mp4 and the files and events.
"""
import json
import subprocess
from pathlib import Path

import pytest
from conftest import EXAMPLE_TRANSCRIPT, SCRIPTS, run
from fake_llm import FakeLLM

from vbeat_agent.beat import BeatRequest, continue_beat, run_beat
from vbeat_agent.config import Caps, Settings
from vbeat_agent.events import ListSink, events_to_messages
from vbeat_agent.state import BeatPaths, StateStore, VersionStore

pytestmark = pytest.mark.render


def make_req(tmp_path: Path, name: str = "beat", **kw) -> BeatRequest:
    d = dict(beat_dir=tmp_path / name, transcript=EXAMPLE_TRANSCRIPT, from_word=0, to_word=8, width=1280, height=720, idx=0,
             title="Big number", direction="Show the revenue growth number landing on 'percent'.", model="fake/model")
    d.update(kw)
    return BeatRequest(**d)


def settings_for(state_dir: Path, **kw) -> Settings:
    return Settings(state_dir=state_dir, api_key=None, **kw)


def ffprobe(p: Path) -> dict:
    out = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-show_streams", "-of", "json", str(p)], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_golden_path(tmp_path, _isolated_state):
    llm = FakeLLM.from_file(SCRIPTS / "golden.json")
    sink = ListSink()
    res = run(run_beat(make_req(tmp_path), sink=sink, llm=llm, settings=settings_for(_isolated_state)))
    d = tmp_path / "beat"
    assert res.status == "waiting_user" and res.status_reason == "finished", res.to_dict()
    assert res.summary.startswith("Big-stat count-up") and res.explanation is None
    assert res.scene_n == 2 and res.sfx_n == 1 and res.steps == 10
    # ---- the verified video ----
    assert res.final_video == d / "final.mp4" and res.final_video.exists()
    streams = {s["codec_type"]: s for s in ffprobe(res.final_video)["streams"]}
    assert streams["video"]["codec_name"] == "h264" and int(streams["video"]["nb_read_frames"]) == 121
    assert streams["audio"]["codec_name"] == "aac" and int(streams["audio"]["sample_rate"]) == 48000
    # ---- the files ----
    for f in ("transcript.json", "spec.json", "scene.js", "cue.py", "strip.jpg", "report.json", "markers.json", "video.mp4", "pipeline.json",
              "agent/request.json", "agent/state.json", "agent/conversation.jsonl", "agent/transcript.md", "agent/llm_calls.jsonl", "agent/events.jsonl"):
        assert (d / f).exists(), f
    paths = BeatPaths(d)
    vs = VersionStore(paths, StateStore(paths))
    assert vs.numbers("scene") == [1, 2] and vs.numbers("cue") == [1]
    assert paths.scene.read_text() == paths.scene_version(2).read_text()          # scene.js is a copy of the current version
    assert not paths.scene.is_symlink()
    v1, v2 = vs.scene_report(1), vs.scene_report(2)
    # v1's stored report is the later FULL check (the fast check cannot see C4): it holds the error the model then read and fixed
    assert v1["level"] == "full" and not v1["ok"] and any(f["id"] == "C4" and f["severity"] == "error" for f in v1["findings"])
    assert "C4" in (d / "agent" / "conversation.jsonl").read_text()
    assert v2["ok"] and (d / "versions" / "scene_002.strip.jpg").exists() and (d / "versions" / "cue_001.wav").exists()
    api_scene = vs.list_scene_versions()
    assert [v["n"] for v in api_scene] == [1, 2] and [v["is_current"] for v in api_scene] == [False, True]
    assert api_scene[1]["created_by"] == "agent" and api_scene[1]["checks"]["ok"] is True
    assert vs.list_sfx_versions()[0]["checks"]["ok"] is True
    # ---- the conversation the model saw ----
    conv = [json.loads(ln) for ln in (d / "agent" / "conversation.jsonl").read_text().splitlines()]
    assert conv[0]["role"] == "system" and "HARD RULES" in conv[0]["content"] and conv[1]["role"] == "user"
    tool_msgs = [m for m in conv if m["role"] == "tool"]
    assert len(tool_msgs) == len([c for m in conv if m["role"] == "assistant" for c in m.get("tool_calls", [])])     # every call answered
    assert any(isinstance(m["content"], list) and m["content"][1]["type"] == "image_file" for m in conv if m["role"] == "user")  # the preview image
    last_req = llm.calls[-1]["messages"]
    assert sum(1 for m in last_req if isinstance(m.get("content"), list) and any(p.get("type") == "image_url" for p in m["content"])) <= 1
    # ---- events and the Message adapter ----
    types = [e["type"] for e in sink.events]
    for t in ("run_started", "llm_call", "assistant_message", "tool_call", "tool_result", "scene_version", "sfx_version", "status", "cost", "run_finished"):
        assert t in types, t
    assert [json.loads(ln)["type"] for ln in (d / "agent" / "events.jsonl").read_text().splitlines()] == types
    msgs = events_to_messages(sink.events)
    assert msgs[-1]["role"] == "event" and msgs[-1]["text"].startswith("Run finished: waiting_user")
    assert any(s["name"] == "preview" and s["image_urls"] for m in msgs for s in m["steps"])
    llm_lines = [json.loads(ln) for ln in (d / "agent" / "llm_calls.jsonl").read_text().splitlines()]
    assert len(llm_lines) == 10 and abs(sum(c["cost_usd"] for c in llm_lines) - res.cost_usd) < 1e-9
    st = json.loads((d / "agent" / "state.json").read_text())
    assert st["status"] == "waiting_user" and st["steps"] == 10 and st["scene_n"] == 2 and st["sfx_n"] == 1 and "_run_base" not in st
    ledger = [json.loads(ln) for ln in (_isolated_state / "ledger.jsonl").read_text().splitlines()]
    assert len(ledger) == 10 and ledger[-1]["total_today"] > 0


def test_finish_fails_at_check_then_succeeds(tmp_path, _isolated_state):
    llm = FakeLLM.from_file(SCRIPTS / "fail_then_fix.json")
    res = run(run_beat(make_req(tmp_path), llm=llm, settings=settings_for(_isolated_state)))
    assert res.status == "waiting_user", res.to_dict()
    conv = (tmp_path / "beat" / "agent" / "conversation.jsonl").read_text()
    assert "finish failed at stage" in conv and "C4" in conv
    assert res.scene_n == 2 and res.final_video.exists()


def test_continue_with_reviewer_feedback_resumes_the_conversation(tmp_path, _isolated_state):
    st = settings_for(_isolated_state)
    run(run_beat(make_req(tmp_path), llm=FakeLLM.from_file(SCRIPTS / "golden.json"), settings=st))
    d = tmp_path / "beat"
    more = FakeLLM({"turns": [{"tool_calls": [{"name": "get_beat_info", "arguments": {}}], "usage": {"cost": 0.001}},
                              {"tool_calls": [{"name": "ask_user", "arguments": {"question": "Which colour should the number be?"}}]}]})
    res = run(continue_beat(d, "Make the number red.", llm=more, settings=st))
    assert res.status == "waiting_user" and res.status_reason == "ask_user" and res.question == "Which colour should the number be?"
    assert res.steps == 12 and res.run_steps == 2                                    # cumulative vs this call
    sent = more.calls[0]["messages"]
    assert sent[0]["role"] == "system" and any("MESSAGE FROM THE HUMAN REVIEWER" in str(m["content"]) for m in sent)
    assert any("Current versions: scene v2, cue v1" in str(m["content"]) for m in sent)
    res2 = run(continue_beat(d, "Blue, please.", llm=FakeLLM({"turns": [{"tool_calls": [{"name": "give_up", "arguments": {"reason": "demo"}}]}]}), settings=st))
    assert any("answering your question" in str(m["content"]) for m in json.loads("[" + ",".join((d / "agent" / "conversation.jsonl").read_text().splitlines()) + "]"))
    assert res2.status == "needs_attention" and res2.explanation["what"]
