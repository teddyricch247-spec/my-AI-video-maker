"""run_beats: ordering, bounded concurrency, shared budget, failure isolation, batch-wide auth stop, kill switch."""
import asyncio
import re
from pathlib import Path

import pytest
from conftest import EXAMPLE_TRANSCRIPT, SCRIPTS, run
from fake_llm import FakeLLM

from vbeat_agent import killswitch
from vbeat_agent.beat import BeatRequest
from vbeat_agent.config import Settings
from vbeat_agent.runner import BATCH_AUTH_REASON, run_beats
from vbeat_agent.toolrun import HEAVY


def reqs(tmp_path: Path, n: int, **kw) -> list[BeatRequest]:
    return [BeatRequest(beat_dir=tmp_path / f"b{i}", transcript=EXAMPLE_TRANSCRIPT, from_word=0, to_word=8, width=1280, height=720, idx=i,
                        title=f"beat {i}", model="fake/model", **kw) for i in range(n)]


class Router:
    """One scripted fake per beat, chosen by the 'Beat <idx>:' line of the first user message. Counts model calls in flight."""

    def __init__(self, per_beat: dict[int, FakeLLM], default: FakeLLM | None = None):
        self.per_beat, self.default = per_beat, default
        self.inflight = self.max_inflight = 0

    async def model_info(self, model):
        return await (self.default or next(iter(self.per_beat.values()))).model_info(model)

    async def chat(self, *, model, messages, **kw):
        first = next(m for m in messages if m["role"] == "user")
        idx = int(re.search(r"Beat (\d+):", str(first["content"])).group(1))
        llm = self.per_beat.get(idx) or self.default.clone()
        self.per_beat.setdefault(idx, llm)
        self.inflight += 1
        self.max_inflight = max(self.max_inflight, self.inflight)
        try:
            return await llm.chat(model=model, messages=messages, **kw)
        finally:
            self.inflight -= 1


def S(state_dir, **kw) -> Settings:
    return Settings(state_dir=state_dir, api_key=None, **kw)


def ask_script(delay=0.0, cost=0.001):
    return FakeLLM({"turns": [{"tool_calls": [{"name": "get_beat_info", "arguments": {}}], "usage": {"cost": cost}, "delay_s": delay},
                              {"tool_calls": [{"name": "ask_user", "arguments": {"question": "ok?"}}], "usage": {"cost": cost}, "delay_s": delay}]})


def test_results_in_request_order_and_concurrency_is_bounded(tmp_path, _isolated_state):
    router = Router({}, default=ask_script(delay=0.3))
    rs = reqs(tmp_path, 6)
    out = run(run_beats(rs, llm=router, concurrency=2, settings=S(_isolated_state)))
    assert [r.status for r in out] == ["waiting_user"] * 6 and all(r.status_reason == "ask_user" for r in out)
    assert router.max_inflight <= 2 and router.max_inflight >= 1
    for i, r in enumerate(out):
        assert r.steps == 2 and (tmp_path / f"b{i}" / "agent" / "events.jsonl").exists()


def test_duplicate_beat_dirs_are_rejected(tmp_path, _isolated_state):
    rs = reqs(tmp_path, 2)
    rs[1].beat_dir = rs[0].beat_dir
    with pytest.raises(ValueError, match="share one beat_dir"):
        run(run_beats(rs, llm=Router({}, ask_script()), settings=S(_isolated_state)))


def test_one_failing_beat_does_not_stop_the_others(tmp_path, _isolated_state):
    rs = reqs(tmp_path, 3)
    rs[1].transcript = tmp_path / "missing.json"                   # beat 1 cannot even be prepared
    out = run(run_beats(rs, llm=Router({}, ask_script()), settings=S(_isolated_state)))
    assert out[0].status == "waiting_user" and out[2].status == "waiting_user"
    assert out[1].status == "failed" and out[1].explanation and out[1].explanation["fix"]


def test_a_crashing_beat_becomes_a_failed_result(tmp_path, _isolated_state):
    class Boom(Router):
        async def chat(self, *, model, messages, **kw):
            first = next(m for m in messages if m["role"] == "user")
            if "Beat 1:" in str(first["content"]):
                raise RuntimeError("kaboom")
            return await super().chat(model=model, messages=messages, **kw)
    out = run(run_beats(reqs(tmp_path, 3), llm=Boom({}, ask_script()), settings=S(_isolated_state)))
    assert [r.status for r in out][0] == "waiting_user" and [r.status for r in out][2] == "waiting_user"
    assert out[1].status in ("failed", "needs_attention") and out[1].explanation


def test_shared_budget_caps_the_whole_batch(tmp_path, _isolated_state):
    turns = [{"tool_calls": [{"name": "search_assets", "arguments": {"query": f"q{i}"}}], "usage": {"cost": 0.03}} for i in range(30)]
    router = Router({}, default=FakeLLM({"turns": turns}))
    out = run(run_beats(reqs(tmp_path, 3), llm=router, concurrency=3, total_max_usd=0.10, settings=S(_isolated_state)))
    assert all(r.status == "needs_attention" and r.status_reason == "cap:total_max_usd" for r in out), [r.to_dict() for r in out]
    spent = sum(r.cost_usd for r in out)
    assert 0.09 <= spent <= 0.10 + 3 * 0.03                         # may overshoot by calls already in flight, never run away
    assert out[0].explanation["what"]


def test_a_rejected_key_stops_the_whole_batch(tmp_path, _isolated_state):
    rejected = FakeLLM({"turns": [{"raise": "auth", "status": 401, "message": "HTTP 401: bad key"}]})
    router = Router({0: rejected}, default=ask_script(delay=2.0))
    out = run(run_beats(reqs(tmp_path, 4), llm=router, concurrency=2, settings=S(_isolated_state)))
    assert out[0].status == "failed" and out[0].status_reason == "llm_auth"
    assert [r.status for r in out[1:]] == ["cancelled"] * 3
    assert out[1].status_reason == BATCH_AUTH_REASON and out[1].explanation["what"].startswith("Stopped: another beat")
    assert not (tmp_path / "b2" / "agent").exists() or not (tmp_path / "b3" / "agent" / "conversation.jsonl").exists()   # queued beats never started


def test_kill_switch_before_start_cancels_everything(tmp_path, _isolated_state):
    killswitch.configure(_isolated_state)
    killswitch.engage("test")
    out = run(run_beats(reqs(tmp_path, 3), llm=Router({}, ask_script()), settings=S(_isolated_state)))
    assert [r.status for r in out] == ["cancelled"] * 3 and all(r.status_reason == "kill_switch" for r in out)


def test_kill_switch_during_the_run_stops_in_flight_model_calls(tmp_path, _isolated_state):
    killswitch.configure(_isolated_state)

    async def go():
        task = asyncio.ensure_future(run_beats(reqs(tmp_path, 2), llm=Router({}, ask_script(delay=5.0)), concurrency=2, settings=S(_isolated_state)))
        await asyncio.sleep(2.0)
        killswitch.engage("test")
        return await asyncio.wait_for(task, 10)
    out = run(go())
    assert [r.status for r in out] == ["cancelled"] * 2 and all(r.status_reason == "kill_switch" for r in out)
    assert all(r.explanation and "kill switch" in r.explanation["what"] for r in out)


def test_external_cancel_event_cancels_the_batch(tmp_path, _isolated_state):
    async def go():
        ev = asyncio.Event()
        task = asyncio.ensure_future(run_beats(reqs(tmp_path, 3), llm=Router({}, ask_script(delay=5.0)), concurrency=1, cancel=ev, settings=S(_isolated_state)))
        await asyncio.sleep(1.5)
        ev.set()
        return await asyncio.wait_for(task, 10)
    out = run(go())
    assert all(r.status == "cancelled" for r in out)


@pytest.mark.render
def test_heavy_subprocesses_never_exceed_the_gate(tmp_path, _isolated_state):
    """4 beats in parallel, each writing a scene (fast check = Chromium) and running a full check; at most 2 heavy tools at a time."""
    script = FakeLLM.from_file(SCRIPTS / "golden.json")
    turns = [{"tool_calls": [{"name": "write_scene", "arguments": {"source": {"$file": "golden_scene_v2.js"}}}], "usage": {"cost": 0.001}},
             {"tool_calls": [{"name": "check_scene", "arguments": {"level": "full"}}], "usage": {"cost": 0.001}},
             {"tool_calls": [{"name": "ask_user", "arguments": {"question": "ok?"}}], "usage": {"cost": 0.001}}]
    default = FakeLLM({"turns": turns}, base_dir=SCRIPTS)
    HEAVY.reset_stats()
    out = run(run_beats(reqs(tmp_path, 4), llm=Router({}, default), concurrency=4, settings=S(_isolated_state, max_heavy=2)))
    assert [r.status for r in out] == ["waiting_user"] * 4, [r.to_dict() for r in out]
    st = HEAVY.stats()
    assert st["limit"] == 2 and st["max_seen"] == 2 and st["total"] >= 8 and st["current"] == 0
    del script
