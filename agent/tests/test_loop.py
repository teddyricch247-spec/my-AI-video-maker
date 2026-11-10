"""The ReAct loop's behaviour: caps, stuck detection, nudges, tool-argument errors, cancel, resume after a kill, context compaction.
All through run_beat with a scripted model and tools that need no browser (so these run in `make test-fast`)."""
import asyncio
import json
from pathlib import Path

from conftest import EXAMPLE_TRANSCRIPT, run
from fake_llm import FakeLLM

from vbeat_agent.beat import BeatRequest, continue_beat, run_beat
from vbeat_agent.config import Caps, Settings
from vbeat_agent.context import OMITTED_IMAGE_TEXT, estimate_tokens, prepare_messages
from vbeat_agent.events import ListSink


def req(tmp_path: Path, name="beat", **kw) -> BeatRequest:
    d = dict(beat_dir=tmp_path / name, transcript=EXAMPLE_TRANSCRIPT, from_word=0, to_word=8, width=1280, height=720, idx=0, model="fake/model")
    d.update(kw)
    return BeatRequest(**d)


def S(state_dir, **kw) -> Settings:
    return Settings(state_dir=state_dir, api_key=None, **kw)


def search(i, cost=0.001):
    return {"tool_calls": [{"name": "search_assets", "arguments": {"query": f"q{i}"}}], "usage": {"cost": cost}}


def conv(tmp_path, name="beat"):
    return [json.loads(ln) for ln in (tmp_path / name / "agent" / "conversation.jsonl").read_text().splitlines()]


def tool_texts(tmp_path, name="beat"):
    return [json.loads(m["content"]) if m["content"].startswith("{") else {"text": m["content"]} for m in conv(tmp_path, name) if m["role"] == "tool"]


# ---------------- caps ----------------

def test_step_cap(tmp_path, _isolated_state):
    r = run(run_beat(req(tmp_path, caps=Caps(max_steps=3)), llm=FakeLLM([search(i) for i in range(10)]), settings=S(_isolated_state)))
    assert r.status == "needs_attention" and r.status_reason == "cap:max_steps" and r.steps == 3
    assert "3 steps" in r.explanation["why"] or "step" in r.explanation["what"].lower()


def test_minutes_cap(tmp_path, _isolated_state):
    llm = FakeLLM([{**search(i), "delay_s": 1.0} for i in range(10)])
    r = run(run_beat(req(tmp_path, caps=Caps(max_minutes=0.03)), llm=llm, settings=S(_isolated_state)))      # 1.8 s
    assert r.status == "needs_attention" and r.status_reason == "cap:max_minutes" and 1 <= r.steps <= 3


def test_money_cap_is_a_promise_not_a_report(tmp_path, _isolated_state):
    llm = FakeLLM([search(i, cost=0.3) for i in range(10)])
    r = run(run_beat(req(tmp_path, caps=Caps(max_usd=0.5)), llm=llm, settings=S(_isolated_state)))
    assert r.status_reason == "cap:max_usd" and r.steps == 1 and r.run_cost_usd == 0.3 and len(llm.calls) == 1      # a second $0.30 call would cross $0.50


def test_unknown_cost_is_charged_an_estimate(tmp_path, _isolated_state):
    llm = FakeLLM([{"tool_calls": [{"name": "search_assets", "arguments": {"query": f"q{i}"}}], "usage": {"cost_unknown": True}} for i in range(20)])
    r = run(run_beat(req(tmp_path, caps=Caps(max_usd=0.5)), llm=llm, settings=S(_isolated_state, unknown_call_cost_usd=0.2)))
    assert r.status_reason == "cap:max_usd" and r.unknown_cost_calls >= 1 and r.run_cost_usd <= 0.5


def test_tool_errors_in_a_row_cap_and_the_model_is_told_what_exists(tmp_path, _isolated_state):
    llm = FakeLLM([{"tool_calls": [{"name": f"bogus{i}", "arguments": {}}]} for i in range(10)])
    r = run(run_beat(req(tmp_path), llm=llm, settings=S(_isolated_state)))
    assert r.status_reason == "cap:max_tool_errors_in_a_row" and r.steps == 6
    first = tool_texts(tmp_path)[0]
    assert first["ok"] is False and "unknown tool" in first["error"].lower() and "write_scene" in first["error"]


# ---------------- stuck / nudges / bad arguments ----------------

def test_identical_calls_warn_once_then_stop_as_stuck(tmp_path, _isolated_state):
    llm = FakeLLM([{"tool_calls": [{"name": "get_beat_info", "arguments": {}}]} for _ in range(20)])
    r = run(run_beat(req(tmp_path), llm=llm, settings=S(_isolated_state)))
    assert r.status == "needs_attention" and r.status_reason == "stuck" and r.steps == 6
    warns = [m for m in conv(tmp_path) if m["role"] == "user" and "You are repeating yourself" in str(m["content"])]
    assert len(warns) == 1                                                                  # one warning, then strikes
    assert "repeating" in r.explanation["what"].lower()


def test_text_only_answers_are_nudged_twice_then_stop(tmp_path, _isolated_state):
    llm = FakeLLM([{"text": "I think the scene looks great."}] * 5)
    r = run(run_beat(req(tmp_path), llm=llm, settings=S(_isolated_state)))
    assert r.status_reason == "no_tool_call" and r.steps == 3
    assert sum(1 for m in conv(tmp_path) if m["role"] == "user" and "Continue by calling a tool" in str(m["content"])) == 2


def test_a_tool_call_after_a_nudge_resets_the_nudge_count(tmp_path, _isolated_state):
    turns = [{"text": "hmm"}, {"text": "hmm"}, search(1), {"text": "hmm"}, {"text": "hmm"}, {"tool_calls": [{"name": "ask_user", "arguments": {"question": "q?"}}]}]
    r = run(run_beat(req(tmp_path), llm=FakeLLM(turns), settings=S(_isolated_state)))
    assert r.status == "waiting_user" and r.status_reason == "ask_user" and r.steps == 6


def test_malformed_and_invalid_arguments_come_back_as_errors_the_model_can_read(tmp_path, _isolated_state):
    turns = [{"raw_tool_calls": [{"name": "write_scene", "arguments": '{"source": "export function'}]},
             {"tool_calls": [{"name": "get_asset", "arguments": {}}]},
             {"tool_calls": [{"name": "search_assets", "arguments": {"query": "x", "limit": 999}}]},
             {"tool_calls": [{"name": "ask_user", "arguments": {"question": "done"}}]}]
    r = run(run_beat(req(tmp_path), llm=FakeLLM(turns), settings=S(_isolated_state)))
    t = tool_texts(tmp_path)
    assert "not valid JSON" in t[0]["error"] and t[0]["kind"] == "model_fault"
    assert "id" in t[1]["error"] and "required" in t[1]["error"].lower()
    assert "limit" in t[2]["error"]
    assert r.status == "waiting_user"


def test_asset_lookup_tools_suggest_instead_of_guessing(tmp_path, _isolated_state):
    turns = [{"tool_calls": [{"name": "get_asset", "arguments": {"id": "tech/big-stats"}}]},
             {"tool_calls": [{"name": "ask_user", "arguments": {"question": "q"}}]}]
    run(run_beat(req(tmp_path), llm=FakeLLM(turns), settings=S(_isolated_state)))
    t = tool_texts(tmp_path)[0]
    assert t["ok"] is False and "tech/big-stat" in t["error"]                                # the 5 closest ids are listed


def test_oversized_tool_results_are_truncated(tmp_path, _isolated_state):
    turns = [{"tool_calls": [{"name": "search_assets", "arguments": {"query": "", "limit": 30}}]}, {"tool_calls": [{"name": "ask_user", "arguments": {"question": "q"}}]}]
    run(run_beat(req(tmp_path), llm=FakeLLM(turns), settings=S(_isolated_state)))
    assert all(len(m["content"].encode()) <= 6000 for m in conv(tmp_path) if m["role"] == "tool")


# ---------------- cancel ----------------

def test_cancel_event_stops_a_slow_model_call_and_persists(tmp_path, _isolated_state):
    async def go():
        ev = asyncio.Event()
        t = asyncio.ensure_future(run_beat(req(tmp_path), cancel=ev, llm=FakeLLM([{**search(1), "delay_s": 30}]), settings=S(_isolated_state)))
        await asyncio.sleep(2.5)
        ev.set()
        return await asyncio.wait_for(t, 10)
    r = run(go())
    assert r.status == "cancelled" and json.loads((tmp_path / "beat" / "agent" / "state.json").read_text())["status"] == "cancelled"


def test_cancel_sentinel_file(tmp_path, _isolated_state):
    async def go():
        t = asyncio.ensure_future(run_beat(req(tmp_path), llm=FakeLLM([{**search(1), "delay_s": 30}]), settings=S(_isolated_state)))
        await asyncio.sleep(2.5)
        (tmp_path / "beat" / "agent" / "CANCEL").write_text("")
        return await asyncio.wait_for(t, 10)
    r = run(go())
    assert r.status == "cancelled" and r.status_reason == "cancel_file"


# ---------------- model errors ----------------

def test_model_errors_map_to_results_with_explanations(tmp_path, _isolated_state):
    cases = {"auth": ("failed", "llm_auth"), "bad_request": ("failed", "llm_bad_request"), "unavailable": ("failed", "llm_unavailable"),
             "rate_limited": ("failed", "llm_unavailable")}
    for i, (kind, (status, reason)) in enumerate(cases.items()):
        r = run(run_beat(req(tmp_path, f"e{i}"), llm=FakeLLM([{"raise": kind, "status": 402 if kind == "auth" else 400, "message": f"HTTP 402: x" if kind == "auth" else "boom"}]),
                         settings=S(_isolated_state)))
        assert (r.status, r.status_reason) == (status, reason), (kind, r.to_dict())
        assert r.explanation["what"] and r.explanation["why"] and r.explanation["fix"]
    r = run(run_beat(req(tmp_path, "e9"), llm=FakeLLM([{"raise": "auth", "status": 402, "message": "HTTP 402: insufficient"}]), settings=S(_isolated_state)))
    assert "credits" in r.explanation["what"].lower() and "openrouter.ai/credits" in r.explanation["fix"]


# ---------------- resume after a kill ----------------

def test_resume_repairs_an_interrupted_tool_call(tmp_path, _isolated_state):
    st = S(_isolated_state)
    run(run_beat(req(tmp_path), llm=FakeLLM([{"tool_calls": [{"name": "ask_user", "arguments": {"question": "q"}}]}]), settings=st))
    cp = tmp_path / "beat" / "agent" / "conversation.jsonl"
    killed = {"role": "assistant", "content": None, "tool_calls": [{"id": "call_x", "type": "function", "function": {"name": "write_scene", "arguments": "{}"}}]}
    cp.write_text(cp.read_text() + json.dumps(killed) + "\n" + '{"role": "tool", "tool_call_id": "cal')                     # killed mid-write too
    sp = tmp_path / "beat" / "agent" / "state.json"
    d = json.loads(sp.read_text())
    d.update(status="running", pid=99999999)
    sp.write_text(json.dumps(d))
    llm = FakeLLM([{"tool_calls": [{"name": "ask_user", "arguments": {"question": "resumed"}}]}])
    r = run(continue_beat(tmp_path / "beat", "", llm=llm, settings=st))
    assert r.status == "waiting_user" and r.question == "resumed"
    sent = json.dumps(llm.calls[0]["messages"])
    assert "interrupted" in sent and "call_x" in sent
    assert llm.calls[0]["messages"][-1]["role"] == "tool"                                   # valid: the repaired call is answered, nothing dangling
    ids = [m["tool_call_id"] for m in conv(tmp_path) if m["role"] == "tool"]
    assert "call_x" in ids                                                                  # every call has its answer again


def test_continue_gets_fresh_caps_but_totals_accumulate(tmp_path, _isolated_state):
    st = S(_isolated_state)
    r1 = run(run_beat(req(tmp_path, caps=Caps(max_steps=2)), llm=FakeLLM([search(i) for i in range(5)]), settings=st))
    assert r1.status_reason == "cap:max_steps" and r1.steps == 2
    r2 = run(continue_beat(tmp_path / "beat", "try again", llm=FakeLLM([search(9), {"tool_calls": [{"name": "ask_user", "arguments": {"question": "q"}}]}]), settings=st))
    assert r2.status == "waiting_user" and r2.steps == 4 and r2.run_steps == 2 and abs(r2.cost_usd - 0.003) < 1e-9


def test_a_second_run_on_a_running_beat_is_refused(tmp_path, _isolated_state):
    import pytest
    from vbeat_agent.state import BeatBusy

    async def go():
        t = asyncio.ensure_future(run_beat(req(tmp_path), llm=FakeLLM([{**search(1), "delay_s": 3}]), settings=S(_isolated_state)))
        await asyncio.sleep(1.5)
        with pytest.raises(BeatBusy):
            await run_beat(req(tmp_path), llm=FakeLLM([]), settings=S(_isolated_state))
        return await t
    run(go())


# ---------------- events ----------------

def test_events_are_complete_ordered_and_stamped(tmp_path, _isolated_state):
    sink = ListSink()
    run(run_beat(req(tmp_path, idx=7), sink=sink, llm=FakeLLM([search(1), {"tool_calls": [{"name": "ask_user", "arguments": {"question": "q"}}]}]), settings=S(_isolated_state)))
    ev = sink.events
    assert ev[0]["type"] == "run_started" and ev[-1]["type"] == "run_finished"
    assert [e["ts"] for e in ev] == sorted(e["ts"] for e in ev)                           # emitted in time order
    assert all(e["beat_idx"] == 7 and "ts" in e for e in ev)
    assert [e["type"] for e in ev if e["type"] in ("llm_call", "tool_call", "tool_result")] == ["llm_call", "tool_call", "tool_result", "llm_call", "tool_call", "tool_result"]
    assert ev[-1]["result"]["status"] == "waiting_user"


# ---------------- context compaction ----------------

def _long_conversation(n=40):
    msgs = [{"role": "user", "content": "first user message"}]
    for i in range(n):
        cid = f"c{i}"
        msgs.append({"role": "assistant", "content": "thinking " * 80, "tool_calls": [{"id": cid, "type": "function", "function": {"name": "write_scene", "arguments": json.dumps({"source": f"// v{i}\n" + "x" * 3000})}}]})
        msgs.append({"role": "tool", "tool_call_id": cid, "content": json.dumps({"ok": True, "text": "y" * 3000}), "_meta": {"name": "write_scene", "ok": True, "summary": f"[write_scene v{i}: ok]"}})
    return msgs


def test_compaction_is_deterministic_keeps_the_protected_parts_and_does_not_mutate():
    msgs = _long_conversation()
    snapshot = json.dumps(msgs)
    a = prepare_messages(msgs, budget=12_000, system="s" * 2000)
    b = prepare_messages(msgs, budget=12_000, system="s" * 2000)
    assert json.dumps(a.messages) == json.dumps(b.messages) and json.dumps(msgs) == snapshot
    assert a.tokens_after < a.tokens_before and a.elided > 0 and not a.over_budget
    assert a.messages[0]["content"] == "first user message"                              # the first user message always stays
    last_write = [m for m in a.messages if m["role"] == "assistant"][-1]["tool_calls"][0]["function"]["arguments"]
    assert "v39" in last_write and "elided" not in last_write                           # the latest write keeps its full source
    older = [m for m in a.messages if m["role"] == "assistant"][1]["tool_calls"][0]["function"]["arguments"]
    assert "elided" in older
    assert all("_meta" not in m for m in a.messages)


def test_nothing_is_elided_under_budget():
    msgs = _long_conversation(2)
    p = prepare_messages(msgs, budget=500_000)
    assert p.elided == 0 and p.tokens_after == p.tokens_before


def test_a_conversation_far_over_budget_is_hopeless():
    msgs = [{"role": "user", "content": "z" * 400_000}]
    assert prepare_messages(msgs, budget=10_000).hopeless


def test_only_the_latest_preview_keeps_its_images(tmp_path):
    for i in range(3):
        (tmp_path / f"p{i}.jpg").write_bytes(b"\xff\xd8\xff\xe0fakejpeg" + bytes([i]))
    msgs = [{"role": "user", "content": "go"}]
    for i in range(3):
        msgs.append({"role": "user", "_meta": {"kind": "images"}, "content": [{"type": "text", "text": "previews"}, {"type": "image_file", "path": f"p{i}.jpg"}]})
    out = prepare_messages(msgs, budget=100_000, media_root=tmp_path).messages
    urls = [p for m in out if isinstance(m["content"], list) for p in m["content"] if p.get("type") == "image_url"]
    assert len(urls) == 1 and urls[0]["image_url"]["url"].startswith("data:image/jpeg;base64,")
    assert sum(1 for m in out if isinstance(m["content"], list) for p in m["content"] if p.get("text") == OMITTED_IMAGE_TEXT) == 2
    assert estimate_tokens(out) > 0
