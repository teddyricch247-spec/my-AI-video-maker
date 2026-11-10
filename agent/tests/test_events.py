"""events_to_messages (the web API's Message shape), the sinks, and the version numbering the web API shows."""
import json

from vbeat_agent.events import CallbackSink, FileEventSink, ListSink, MultiSink, events_to_messages
from vbeat_agent.state import BeatPaths, StateStore, VersionStore

EV = [
    {"type": "run_started", "ts": "t0", "model": "m/x", "step": 0},
    {"type": "user_message", "ts": "t1", "text": "Make it red"},
    {"type": "llm_call", "ts": "t2", "step": 1, "cost_usd": 0.01},
    {"type": "assistant_message", "ts": "t3", "step": 1, "text": "Looking."},
    {"type": "tool_call", "ts": "t4", "step": 1, "call_id": "a", "name": "get_beat_info", "args_summary": ""},
    {"type": "tool_call", "ts": "t4", "step": 1, "call_id": "b", "name": "preview", "args_summary": "frames [1.0]"},
    {"type": "tool_result", "ts": "t5", "step": 1, "call_id": "a", "name": "get_beat_info", "ok": True, "summary": "9 words"},
    {"type": "tool_result", "ts": "t5", "step": 1, "call_id": "b", "name": "preview", "ok": False, "summary": "boom", "image_paths": ["versions/preview/p.jpg"]},
    {"type": "scene_version", "ts": "t6", "n": 2, "checks": {"error": 1, "warn": 3}},
    {"type": "cost", "ts": "t7", "usd": 0.01},
    {"type": "tool_call", "ts": "t8", "step": 2, "call_id": "c", "name": "finish", "args_summary": "summary"},
    {"type": "tool_result", "ts": "t9", "step": 2, "call_id": "c", "name": "finish", "ok": True, "summary": "done"},
    {"type": "status", "ts": "t10", "status": "waiting_user", "reason": "finished"},
    {"type": "run_finished", "ts": "t11", "result": {"status": "waiting_user", "status_reason": "finished", "summary": "Count-up."}},
]


def test_messages_have_the_web_api_shape():
    msgs = events_to_messages(EV, url_for=lambda p: "/media/" + p)
    assert [m["role"] for m in msgs] == ["event", "user", "assistant", "event", "assistant", "event", "event"]
    assert [m["seq"] for m in msgs] == list(range(1, 8))
    for m in msgs:
        assert set(m) == {"seq", "role", "text", "steps", "created_at", "queued"} and m["queued"] is False
    a = msgs[2]
    assert a["text"] == "Looking." and [s["name"] for s in a["steps"]] == ["get_beat_info", "preview"]
    assert a["steps"][0]["summary"] == "9 words" and a["steps"][1]["ok"] is False and a["steps"][1]["image_urls"] == ["/media/versions/preview/p.jpg"]
    assert msgs[3]["text"] == "Scene v2 saved: 1 errors, 3 warnings"
    assert msgs[4]["text"] == "" and msgs[4]["steps"][0]["name"] == "finish"                      # a step with no prose
    assert msgs[-1]["text"] == "Run finished: waiting_user (finished). Count-up."
    assert events_to_messages(EV, start_seq=50)[0]["seq"] == 50


def test_unknown_event_types_and_orphan_results_do_not_crash():
    msgs = events_to_messages([{"type": "something_new", "ts": "x"}, {"type": "tool_result", "ts": "y", "step": 9, "call_id": "zz", "name": "preview", "ok": True}])
    assert len(msgs) == 1 and msgs[0]["steps"][0]["name"] == "preview"


def test_file_sink_writes_one_json_line_per_event_and_multisink_fans_out(tmp_path):
    seen = []
    ls = ListSink()
    fs = FileEventSink(tmp_path / "events.jsonl")
    m = MultiSink(fs, CallbackSink(seen.append), ls)
    m.emit({"type": "note", "text": "a"})
    m.emit({"type": "note", "text": "b"})
    lines = (tmp_path / "events.jsonl").read_text().splitlines()
    assert [json.loads(x)["text"] for x in lines] == ["a", "b"] and len(seen) == len(ls.events) == 2


def test_a_failing_callback_never_breaks_the_run(tmp_path):
    def bad(ev):
        raise RuntimeError("ui crashed")
    ListSink_ = ListSink()
    MultiSink(CallbackSink(bad), ListSink_).emit({"type": "note", "text": "x"})
    assert len(ListSink_.events) == 1


def test_version_numbers_come_from_the_files_and_never_repeat(tmp_path):
    paths = BeatPaths(tmp_path / "b").ensure()
    vs = VersionStore(paths, StateStore(paths))
    n1, _ = vs.save("scene", "// one\n")
    n2, _ = vs.save("scene", "// two\n")
    assert (n1, n2) == (1, 2) and vs.numbers("scene") == [1, 2] and vs.current_n("scene") == 2
    (paths.versions / "scene_005.js").write_text("// gap\n")                                       # a file the model's world cannot explain
    assert vs.save("scene", "// three\n")[0] == 6                                                       # numbering follows what is on disk
    vs2 = VersionStore(paths, StateStore(paths))                                                      # a fresh process sees the same truth
    assert vs2.numbers("scene") == [1, 2, 5, 6]
