"""The command line, as a subprocess, against a scripted local OpenRouter: the real client, runner, ledger and kill switch, end to end.

This is also the 'secrets never touch disk or output' test: a recognisable key is set, a whole run happens, and every byte under the
beat, state and cache directories plus stdout/stderr and the request bodies the server saw is searched for it."""
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest
from conftest import AGENT, EXAMPLE_TRANSCRIPT, REPO
from fake_server import FakeOpenRouter, Reply, chat_ok, tool_call

KEY = "sk-or-v1-" + "5a4b3c2d" * 6
SRC = os.pathsep.join(str(REPO / d / "src") for d in ("agent", "shared", "engine", "audio", "pipeline"))
MODELS = {"data": [{"id": "test/model", "name": "T", "supported_parameters": ["tools"], "architecture": {"input_modalities": ["text"]},
                    "pricing": {"prompt": "0.000001", "completion": "0.000002"}}]}


@pytest.fixture
def srv():
    with FakeOpenRouter() as s:
        s.queue("/models", Reply(200, MODELS))
        s.queue("/key", Reply(200, {"data": {"limit": 20, "usage": 1, "limit_remaining": 19}}))
        yield s


@pytest.fixture
def env(srv, tmp_path, _isolated_state):
    e = {"PATH": os.environ["PATH"], "HOME": str(tmp_path / "home"), "PYTHONPATH": SRC, "PYTHONDONTWRITEBYTECODE": "1",
         "OPENROUTER_API_KEY": KEY, "OPENROUTER_BASE_URL": srv.base_url, "VBEAT_STATE_DIR": str(_isolated_state), "VBEAT_CACHE_DIR": str(tmp_path / "cache")}
    (tmp_path / "home").mkdir()
    return e


def cli(env, *args, timeout=240):
    p = subprocess.run([sys.executable, "-m", "vbeat_agent", *args], capture_output=True, text=True, env=env, timeout=timeout, cwd=str(tmp_cwd()))
    return p


def tmp_cwd():
    return AGENT


def envelope(p):
    lines = [ln for ln in p.stdout.splitlines() if ln.strip()]
    assert len(lines) == 1, f"stdout must be exactly one JSON line, got: {p.stdout!r}"
    return json.loads(lines[0])


def run_args(tmp_path, name="beat", *more):
    return ["run-beat", "--beat-dir", str(tmp_path / name), "--transcript", str(EXAMPLE_TRANSCRIPT), "--from-word", "0", "--to-word", "8", "--model", "test/model", "--title", "t", *more]


def tree_bytes(*roots):
    for root in roots:
        for p in Path(root).rglob("*"):
            if p.is_file():
                yield p, p.read_bytes()


def ask(q="ok?", cost=0.01):
    return Reply(200, chat_ok(None, tool_calls=[tool_call("ask_user", {"question": q})], cost=cost))


def info(cost=0.01):
    return Reply(200, chat_ok(None, tool_calls=[tool_call("get_beat_info", {})], cost=cost))


def test_end_to_end_with_the_real_client_and_nothing_secret_on_disk(srv, env, tmp_path, _isolated_state):
    srv.queue("/chat/completions", info(), ask("Which colour?"))
    p = cli(env, *run_args(tmp_path))
    e = envelope(p)
    assert p.returncode == 0 and e["ok"] and e["command"] == "run-beat" and e["error"] is None, p.stderr
    rep = e["report"]
    assert rep["status"] == "waiting_user" and rep["status_reason"] == "ask_user" and rep["question"] == "Which colour?"
    assert rep["run_cost_usd"] == pytest.approx(0.02) and rep["steps"] == 2
    assert "Which colour?" in p.stderr and "step 1: get_beat_info" in p.stderr
    # the money side
    led = [json.loads(ln) for ln in (_isolated_state / "ledger.jsonl").read_text().splitlines()]
    assert len(led) == 2 and led[-1]["total_today"] == pytest.approx(0.02) and led[0]["model"] == "test/model"
    # what the server saw
    chats = [r for r in srv.requests if r["path"].endswith("/chat/completions")]
    assert all(r["headers"]["authorization"] == f"Bearer {KEY}" for r in chats)
    assert not any(r["headers"].get("authorization") for r in srv.requests if r["path"].endswith("/models"))
    assert all(KEY not in json.dumps(r["json"]) for r in chats)                  # not even in the prompt
    # the secrecy sweep
    leaks = [str(path) for path, data in tree_bytes(tmp_path, _isolated_state) if KEY.encode() in data or b"sk-or-v1-" in data]
    assert not leaks, leaks
    assert KEY not in p.stdout + p.stderr
    # the other commands on the same beat
    d = str(tmp_path / "beat")
    q = cli(env, "ledger")
    assert envelope(q)["report"]["spent"] == pytest.approx(0.02) and "spent $0.0200 of $10.00" in q.stderr
    q = cli(env, "replay", "--beat-dir", d)
    assert envelope(q)["report"]["messages"][-1]["role"] == "event"
    q = cli(env, "diagnose", "--beat-dir", d)
    assert q.returncode == 0 and envelope(q)["report"]["checks"][0]["what"] == "The beat is waiting for your answer."
    # continue: the reviewer answers, the model gives up -> needs_attention, exit 1, plain-language explanation on stderr
    srv.queue("/chat/completions", Reply(200, chat_ok(None, tool_calls=[tool_call("give_up", {"reason": "not possible"})], cost=0.01)))
    q = cli(env, "continue", "--beat-dir", d, "--message", "Blue.")
    e2 = envelope(q)
    assert q.returncode == 1 and not e2["ok"] and e2["error"]["type"] == "give_up" and "What to do:" in q.stderr
    assert e2["report"]["steps"] == 3 and e2["report"]["run_steps"] == 1
    assert not [1 for path, data in tree_bytes(tmp_path, _isolated_state) if KEY.encode() in data]


def test_rejected_key_gives_a_plain_explanation_and_exit_2(srv, env, tmp_path):
    srv.queue("/chat/completions", Reply(401, {"error": {"message": f"Invalid key {KEY}"}}))
    p = cli(env, *run_args(tmp_path))
    e = envelope(p)
    assert p.returncode == 2 and not e["ok"] and e["error"]["type"] == "llm_auth"
    assert "openrouter.ai/keys" in p.stderr and "What happened:" in p.stderr and "Why:" in p.stderr
    assert KEY not in p.stdout + p.stderr
    assert srv.count("/chat/completions") == 1                                      # auth errors are not retried


def test_no_key_set(srv, env, tmp_path):
    env.pop("OPENROUTER_API_KEY")
    p = cli(env, *run_args(tmp_path))
    e = envelope(p)
    assert p.returncode == 2 and e["error"]["type"] == "no_api_key" and "OPENROUTER_API_KEY" in e["error"]["message"] and not srv.requests


def test_daily_cap_stops_before_any_model_call(srv, env, tmp_path):
    srv.queue("/chat/completions", info())
    p = cli(env, *run_args(tmp_path), "--max-usd-per-day", "0.001")
    e = envelope(p)
    assert p.returncode == 1 and e["error"]["type"] == "cap:daily_usd" and "daily" in e["error"]["message"].lower()
    assert srv.count("/chat/completions") == 0


def test_per_beat_cap_defaults_to_fifty_cents_and_stops_the_run(srv, env, tmp_path):
    turns = [Reply(200, chat_ok(None, tool_calls=[tool_call("search_assets", {"query": f"q{i}"})], cost=0.2)) for i in range(10)]
    srv.queue("/chat/completions", *turns)
    p = cli(env, *run_args(tmp_path))
    e = envelope(p)
    assert p.returncode == 1 and e["error"]["type"] == "cap:max_usd", p.stderr
    assert 0.4 <= e["report"]["run_cost_usd"] <= 0.5 and e["report"]["steps"] == 2     # a third call (projected $0.60) is refused up front
    assert srv.count("/chat/completions") == 2
    assert json.loads((tmp_path / "beat" / "agent" / "request.json").read_text())["caps"]["max_usd"] == 0.5


def test_kill_switch_blocks_runs_and_can_be_released(srv, env, tmp_path):
    srv.queue("/chat/completions", info(), ask())
    k = cli(env, "kill", "--reason", "test")
    assert k.returncode == 0 and envelope(k)["report"]["engaged"] and "ENGAGED" in k.stderr
    p = cli(env, *run_args(tmp_path))
    e = envelope(p)
    assert p.returncode == 0 and not e["ok"] and e["report"]["status"] == "cancelled" and e["report"]["status_reason"] == "kill_switch"
    assert "kill switch" in e["error"]["message"].lower() and srv.count("/chat/completions") == 0
    assert cli(env, "preflight", "--no-network", "--no-browser").returncode == 1
    assert envelope(cli(env, "kill", "--off"))["report"]["released_file"] is True
    p = cli(env, *run_args(tmp_path, "beat2"))
    assert p.returncode == 0 and envelope(p)["report"]["status_reason"] == "ask_user"


def test_kill_env_var(srv, env, tmp_path):
    env["VBEAT_KILL"] = "1"
    e = envelope(cli(env, *run_args(tmp_path)))
    assert e["report"]["status_reason"] == "kill_switch" and not srv.requests


def test_sigterm_persists_and_exits_zero(srv, env, tmp_path):
    srv.queue("/chat/completions", Reply(200, chat_ok(None, tool_calls=[tool_call("get_beat_info", {})]), delay=30))
    proc = subprocess.Popen([sys.executable, "-m", "vbeat_agent", *run_args(tmp_path)], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=str(AGENT))
    try:
        t0 = time.time()
        while srv.count("/chat/completions") == 0 and time.time() - t0 < 120:
            time.sleep(0.2)
        assert srv.count("/chat/completions") == 1, "the model call never started"
        proc.send_signal(signal.SIGTERM)
        out, err = proc.communicate(timeout=30)
    finally:
        if proc.poll() is None:
            proc.kill()
    e = json.loads(out.strip().splitlines()[-1])
    assert proc.returncode == 0 and e["report"]["status"] == "cancelled" and e["report"]["status_reason"] == "sigterm"
    st = json.loads((tmp_path / "beat" / "agent" / "state.json").read_text())
    assert st["status"] == "cancelled" and st["pid"] is None
    # and the beat resumes cleanly afterwards
    srv.queue("/chat/completions", ask("resumed?"))
    p = cli(env, "continue", "--beat-dir", str(tmp_path / "beat"))
    assert envelope(p)["report"]["question"] == "resumed?"


def test_no_fake_or_key_flags_exist(env):
    for args in (["run-beat", "--fake"], ["run-beat", "--api-key", "x"], ["selftest", "--fake"]):
        p = cli(env, *args)
        e = envelope(p)
        assert p.returncode == 2 and e["error"]["type"] == "usage"
    h = cli(env, "run-beat", "--help").stdout.lower()
    assert "--fake" not in h and "api-key" not in h and "api_key" not in h
    p = cli(env, "run-beat", "--beat-dir", "x", "--transcript", "t", "--from-word", "0", "--to-word", "1", "--model", "fake")
    assert p.returncode == 2 and "not a model" in envelope(p)["error"]["message"]


def test_models_prompt_and_preflight_commands(srv, env, tmp_path):
    p = cli(env, "models", "--tools-only")
    assert envelope(p)["report"]["models"][0]["id"] == "test/model"
    out = tmp_path / "prompt.md"
    p = cli(env, "prompt", "--out", str(out))
    e = envelope(p)
    assert e["artifacts"]["prompt"] == str(out) and "text" not in e["report"] and "HARD RULES" in out.read_text()
    p = cli(env, "preflight", "--no-browser", "--model", "test/model")
    e = envelope(p)
    assert p.returncode == 0 and e["ok"] and "OpenRouter accepts the key" in p.stderr and KEY not in p.stdout + p.stderr


def test_run_beats_from_a_plan_file(srv, env, tmp_path):
    plan = [{"beat_dir": str(tmp_path / f"p{i}"), "transcript": str(EXAMPLE_TRANSCRIPT), "from_word": 0, "to_word": 8, "width": 1280, "height": 720,
             "title": f"p{i}", "model": "test/model"} for i in range(3)]
    pf = tmp_path / "plan.json"
    pf.write_text(json.dumps({"beats": plan}))
    srv.queue("/chat/completions", Reply(200, chat_ok(None, tool_calls=[tool_call("ask_user", {"question": "ok?"})], cost=0.01)))
    p = cli(env, "run-beats", "--plan", str(pf), "--concurrency", "2")
    e = envelope(p)
    assert p.returncode == 0 and e["ok"] and len(e["report"]["results"]) == 3 and e["report"]["spent_usd"] == pytest.approx(0.03)
    assert [r["status"] for r in e["report"]["results"]] == ["waiting_user"] * 3
