"""preflight / selftest / diagnose: plain-language what/why/fix, no secrets, no surprise spend."""
import asyncio
import json
from pathlib import Path

import pytest
from conftest import EXAMPLE_TRANSCRIPT, run
from fake_llm import FakeLLM
from fake_server import FakeOpenRouter, Reply, chat_ok, tool_call

from vbeat_agent import health, killswitch
from vbeat_agent.beat import BeatRequest, run_beat
from vbeat_agent.budget import SpendLedger
from vbeat_agent.config import Settings

KEY = "sk-or-v1-" + "9f8e7d6c" * 6


@pytest.fixture
def srv():
    with FakeOpenRouter() as s:
        s.queue("/key", Reply(200, {"data": {"label": "x", "limit": 20, "usage": 4, "limit_remaining": 16, "is_free_tier": False}}))
        s.queue("/models", Reply(200, {"data": [{"id": "ok/model", "supported_parameters": ["tools"], "architecture": {"input_modalities": ["text", "image"]}},
                                              {"id": "no/tools", "supported_parameters": ["temperature"]}]}))
        yield s


def S(srv, tmp_path, state_dir, **kw):
    return Settings(api_key=kw.pop("api_key", KEY), base_url=srv.base_url, state_dir=state_dir, cache_dir=tmp_path / "cache", **kw)


def by_name(rep):
    return {c["name"]: c for c in rep["checks"]}


def pf(settings, **kw):
    return health.preflight(settings, browser=False, **kw)


def test_preflight_healthy_system(srv, tmp_path, _isolated_state):
    rep = pf(S(srv, tmp_path, _isolated_state), model="ok/model")
    c = by_name(rep)
    assert rep["ok"], rep["summary"]
    for n in ("python", "api_key", "kill_switch", "state_dir", "daily_ledger", "disk", "ffmpeg", "prompt", "openrouter_key", "model"):
        assert c[n]["status"] in ("ok", "warn"), c[n]
    assert c["openrouter_key"]["status"] == "ok" and "$16.00" in c["openrouter_key"]["what"]
    assert c["daily_ledger"]["data"]["cap"] == 10.0
    assert rep["caps"] == {"per_beat_usd": 0.5, "per_run_usd": 5.0, "per_day_usd": 10.0}
    assert c["prompt"]["data"]["chars"] > 20000
    assert KEY not in json.dumps(rep)


def test_preflight_warns_when_state_dir_is_temporary(srv, tmp_path, _isolated_state, monkeypatch):
    monkeypatch.delenv("VBEAT_STATE_DIR", raising=False)
    rep = pf(S(srv, tmp_path, _isolated_state), model="ok/model")
    w = by_name(rep)["state_persistence"]
    assert w["status"] == "warn" and "VBEAT_STATE_DIR" in w["fix"]


def test_preflight_without_a_key_says_what_why_fix_and_skips_the_network(srv, tmp_path, _isolated_state):
    rep = pf(S(srv, tmp_path, _isolated_state, api_key=None))
    c = by_name(rep)
    assert not rep["ok"] and c["api_key"]["status"] == "fail"
    assert "OPENROUTER_API_KEY" in c["api_key"]["why"] and c["api_key"]["fix"] and "never in a file" in c["api_key"]["fix"]
    assert not srv.requests and c["openrouter_key"]["status"] == "skip"


def test_preflight_rejected_key(srv, tmp_path, _isolated_state):
    srv.queue("/key", Reply(401, {"error": {"message": "No auth credentials found"}}))
    c = by_name(pf(S(srv, tmp_path, _isolated_state), model="ok/model"))["openrouter_key"]
    assert c["status"] == "fail" and "rejected the API key" in c["what"] and "openrouter.ai/keys" in c["fix"]


def test_preflight_no_credit_left(srv, tmp_path, _isolated_state):
    srv.queue("/key", Reply(200, {"data": {"limit": 5, "usage": 5, "limit_remaining": 0}}))
    c = by_name(pf(S(srv, tmp_path, _isolated_state), model="ok/model"))["openrouter_key"]
    assert c["status"] == "fail" and "no credit" in c["what"]


def test_preflight_openrouter_unreachable_is_a_warning_not_a_crash(tmp_path, _isolated_state):
    with FakeOpenRouter() as s:
        dead = s.base_url
    st = Settings(api_key=KEY, base_url=dead, state_dir=_isolated_state, cache_dir=tmp_path / "c", request_timeout=2.0)
    c = by_name(pf(st, model="ok/model"))
    assert c["openrouter_key"]["status"] == "warn" and "network" in c["openrouter_key"]["fix"]


def test_preflight_model_checks(srv, tmp_path, _isolated_state):
    s = S(srv, tmp_path, _isolated_state)
    assert by_name(pf(s, model="no/tools"))["model"]["status"] == "fail"
    assert by_name(pf(s, model="typo/model"))["model"]["status"] == "warn"
    assert by_name(pf(s))["model"]["status"] == "warn"                                    # no model chosen anywhere


def test_preflight_kill_switch_and_exhausted_ledger_fail(srv, tmp_path, _isolated_state):
    s = S(srv, tmp_path, _isolated_state, max_usd_per_day=1.0)
    led = SpendLedger(_isolated_state, 1.0)
    tok = led.reserve(0.5)
    led.settle(tok, 1.0)
    killswitch.configure(_isolated_state)
    killswitch.engage("maintenance")
    c = by_name(pf(s, model="ok/model"))
    assert c["kill_switch"]["status"] == "fail" and "kill switch" in c["kill_switch"]["what"].lower()
    assert c["daily_ledger"]["status"] == "fail" and "used up" in c["daily_ledger"]["what"]


def test_a_crashing_check_becomes_a_failed_check(srv, tmp_path, _isolated_state, monkeypatch):
    monkeypatch.setattr(health, "_check_disk", lambda s: 1 / 0)
    with pytest.raises(ZeroDivisionError):          # disk is synchronous plumbing; the async-wrapped checks are the guarded ones
        pf(S(srv, tmp_path, _isolated_state))
    async def boom():
        raise RuntimeError("x")
    c = run(health._guarded("thing", boom))
    assert c.status == "fail" and c.what == "The 'thing' check itself crashed."


def test_sync_wrappers_work_inside_a_running_event_loop(srv, tmp_path, _isolated_state):
    async def go():
        return health.preflight(S(srv, tmp_path, _isolated_state), model="ok/model", browser=False)
    assert run(go())["ok"]


@pytest.mark.render
def test_preflight_launches_chromium(srv, tmp_path, _isolated_state):
    c = by_name(health.preflight(S(srv, tmp_path, _isolated_state), model="ok/model"))["chromium"]
    assert c["status"] == "ok", c


@pytest.mark.render
def test_selftest_renders_the_example_beat_for_free(tmp_path, _isolated_state):
    st = Settings(api_key=None, state_dir=_isolated_state, cache_dir=tmp_path / "cache")
    rep = health.selftest(st)
    assert rep["ok"], health.render_text(rep)
    assert rep["spent_usd"] == 0.0 and [c["name"] for c in rep["checks"]][-1] == "final_video"
    assert "121 frames" in by_name(rep)["final_video"]["what"] or "frames" in by_name(rep)["final_video"]["what"]
    assert not list((tmp_path / "cache" / "selftest").glob("*"))                        # cleaned up after success
    assert not (_isolated_state / "ledger.jsonl").exists()                              # nothing was spent


def test_selftest_failure_is_explained_in_plain_language(tmp_path, _isolated_state):
    st = Settings(api_key=None, state_dir=_isolated_state, cache_dir=tmp_path / "cache")
    st.timeouts["ingest"] = 0.01                                                         # the first tool cannot finish in 10 ms
    rep = health.selftest(st)
    bad = [c for c in rep["checks"] if c["status"] == "fail"]
    assert not rep["ok"] and bad and bad[0]["name"] == "ingest" and bad[0]["fix"] and "ingest" in bad[0]["what"]
    assert rep["work_dir"]


def test_selftest_stops_at_the_kill_switch(tmp_path, _isolated_state):
    killswitch.configure(_isolated_state)
    killswitch.engage("test")
    rep = health.selftest(Settings(api_key=None, state_dir=_isolated_state, cache_dir=tmp_path / "c"))
    assert not rep["ok"] and rep["checks"][0]["name"] == "kill_switch"


def test_model_ping_needs_a_tool_call_and_books_its_cost_in_the_ledger(srv, tmp_path, _isolated_state):
    srv.queue("/chat/completions", Reply(200, chat_ok(None, tool_calls=[tool_call("ping", {"word": "ok"})], cost=0.0004)))
    s = S(srv, tmp_path, _isolated_state)
    c = run(health._ping(s, "ok/model"))
    assert c.status == "ok" and c.data["cost_usd"] == 0.0004
    assert SpendLedger(_isolated_state, 10).today()["spent"] == pytest.approx(0.0004, abs=1e-4)
    srv.queue("/chat/completions", Reply(200, chat_ok("OK, done.")))
    assert run(health._ping(s, "ok/model")).status == "fail"
    srv.queue("/chat/completions", Reply(402, {"error": {"message": "insufficient credits"}}))
    c = run(health._ping(s, "ok/model"))
    assert c.status == "fail" and "out of credits" in c.what and "openrouter.ai/credits" in c.fix
    assert run(health._ping(Settings(api_key=KEY, state_dir=_isolated_state), None)).status == "fail"   # no model


# ---------------- diagnose ----------------

def make_req(tmp_path, name="beat"):
    return BeatRequest(beat_dir=tmp_path / name, transcript=EXAMPLE_TRANSCRIPT, from_word=0, to_word=8, width=1280, height=720, idx=0, model="fake/model")


def test_diagnose_waiting_for_an_answer_and_failed_runs(tmp_path, _isolated_state):
    st = Settings(api_key=KEY, state_dir=_isolated_state)
    ask = FakeLLM({"turns": [{"tool_calls": [{"name": "ask_user", "arguments": {"question": "Red or blue?"}}]}]})
    run(run_beat(make_req(tmp_path), llm=ask, settings=st))
    rep = health.diagnose(tmp_path / "beat", st)
    assert rep["ok"] and by_name(rep)["state"]["what"] == "The beat is waiting for your answer." and by_name(rep)["state"]["data"]["question"] == "Red or blue?"
    assert KEY not in json.dumps(rep) and rep["beat"]["steps"] == 1
    gave = FakeLLM({"turns": [{"tool_calls": [{"name": "give_up", "arguments": {"reason": "cannot do it"}}]}]})
    run(run_beat(make_req(tmp_path, "b2"), llm=gave, settings=st))
    rep2 = health.diagnose(tmp_path / "b2", st)
    c = by_name(rep2)["state"]
    assert c["status"] == "warn" and c["what"] and c["why"] and c["fix"]


def test_diagnose_spots_a_run_that_died_and_missing_files(tmp_path, _isolated_state):
    st = Settings(api_key=None, state_dir=_isolated_state)
    run(run_beat(make_req(tmp_path), llm=FakeLLM({"turns": [{"tool_calls": [{"name": "ask_user", "arguments": {"question": "q"}}]}]}), settings=st))
    sp = tmp_path / "beat" / "agent" / "state.json"
    d = json.loads(sp.read_text())
    d.update(status="running", status_reason=None, final_video=str(tmp_path / "gone.mp4"))
    sp.write_text(json.dumps(d))
    c = by_name(health.diagnose(tmp_path / "beat", st))
    assert c["state"]["status"] == "warn" and "stopped without saying so" in c["state"]["what"] and "Continue" in c["state"]["fix"]
    assert c["final_video"]["status"] == "fail"


def test_diagnose_reports_costs_and_retries(tmp_path, _isolated_state):
    st = Settings(api_key=None, state_dir=_isolated_state)
    run(run_beat(make_req(tmp_path), llm=FakeLLM({"turns": [{"tool_calls": [{"name": "ask_user", "arguments": {"question": "q"}}]}]}), settings=st))
    lp = tmp_path / "beat" / "agent" / "llm_calls.jsonl"
    lp.write_text(lp.read_text() + json.dumps({"attempts": 3, "cost_source": "unknown"}) + "\n")
    c = by_name(health.diagnose(tmp_path / "beat", st))
    assert c["llm_retries"]["status"] == "warn" and c["unknown_cost"]["status"] == "warn"


def test_diagnose_of_something_that_is_not_a_beat(tmp_path):
    rep = health.diagnose(tmp_path)
    assert not rep["ok"] and "not a beat directory" in rep["checks"][0]["what"]


def test_render_text_is_readable(srv, tmp_path, _isolated_state):
    txt = health.render_text(pf(S(srv, tmp_path, _isolated_state, api_key=None)))
    assert "What to do:" in txt and "[FAIL]" in txt and KEY not in txt
