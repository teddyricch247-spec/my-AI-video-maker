"""The money and safety guards in isolation: daily ledger (cross-process, day rollover, stale reservations), composite budget,
kill switch, secret redaction, plain-language error catalogue, path sandbox."""
import json
import multiprocessing as mp
import os
import time
from datetime import datetime, timezone

import pytest

from vbeat_agent import killswitch
from vbeat_agent.budget import CompositeBudget, SharedBudget, SpendLedger
from vbeat_agent.errors import explain
from vbeat_agent.redact import REDACTED, redact, register_secret, scrub_env
from vbeat_agent.state import SandboxError, safe_path

KEY = "sk-or-v1-" + "0a1b2c3d" * 6


# ---------------- ledger ----------------

def _spender(state_dir, n, usd):
    led = SpendLedger(state_dir, 1000.0)
    for _ in range(n):
        tok = led.reserve(usd)
        led.settle(tok, usd)


def test_ledger_reserve_settle_and_cap(tmp_path):
    led = SpendLedger(tmp_path, 1.0)
    a = led.reserve(0.6)
    assert a is not None and led.today()["in_flight"] == 0.6 and led.today()["remaining"] == 0.4
    assert led.reserve(0.5) is None                                              # 0.6 held + 0.5 > 1.0: refused up front
    led.settle(a, 0.3)
    t = led.today()
    assert t["spent"] == 0.3 and t["in_flight"] == 0 and t["remaining"] == 0.7
    assert led.reserve(0.7) is not None


def test_ledger_is_shared_between_processes_without_losing_updates(tmp_path):
    ps = [mp.get_context("fork").Process(target=_spender, args=(tmp_path, 25, 0.01)) for _ in range(4)]
    [p.start() for p in ps]
    [p.join(60) for p in ps]
    assert all(p.exitcode == 0 for p in ps)
    assert SpendLedger(tmp_path, 1000.0).today()["spent"] == pytest.approx(1.0, abs=1e-6)         # 4 x 25 x $0.01, none lost
    assert len((tmp_path / "ledger.jsonl").read_text().splitlines()) == 100


def test_ledger_rolls_over_at_midnight_in_its_timezone(tmp_path):
    now = [datetime(2026, 11, 7, 23, 30, tzinfo=timezone.utc).timestamp()]
    led = SpendLedger(tmp_path, 1.0, "UTC", clock=lambda: now[0])
    led.settle(led.reserve(0.9), 0.9)
    assert led.reserve(0.5) is None and led.today()["date"] == "2026-11-07"
    now[0] += 3600                                                                # 00:30 next day
    assert led.today()["date"] == "2026-11-08" and led.today()["spent"] == 0
    assert led.reserve(0.5) is not None
    sast = SpendLedger(tmp_path / "z", 1.0, "Africa/Johannesburg", clock=lambda: now[0])
    assert sast.today()["date"] == "2026-11-08"                                    # same instant, SAST is already on the 8th (at 00:30 UTC = 02:30)


def test_a_dead_processs_reservation_expires(tmp_path):
    now = [time.time()]
    led = SpendLedger(tmp_path, 1.0, clock=lambda: now[0])
    led.reserve(0.9)                                                               # never settled: a crashed run
    assert led.today()["in_flight"] == 0.9 and led.reserve(0.5) is None
    now[0] += 21 * 60                                                              # older than the 20 minute expiry
    assert led.today()["in_flight"] == 0 and led.reserve(0.5) is not None
    st = json.loads((tmp_path / "ledger-state.json").read_text())
    st["reservations"] = {"dead": {"usd": 0.9, "pid": 2 ** 22 + 12345, "ts": now[0]}}   # a pid that is not running
    (tmp_path / "ledger-state.json").write_text(json.dumps(st))
    assert led.today()["in_flight"] == 0


def test_a_corrupt_ledger_file_does_not_stop_work_but_is_not_silently_zeroed_past_the_cap(tmp_path):
    (tmp_path / "ledger-state.json").write_text("{not json")
    led = SpendLedger(tmp_path, 1.0)
    assert led.reserve(0.1) is not None                                           # recovers instead of crashing every run
    assert led.today()["cap"] == 1.0


def test_composite_budget_names_the_budget_that_refused_and_gives_back(tmp_path):
    shared, led = SharedBudget(1.0), SpendLedger(tmp_path, 0.05).bind("b", "m")
    c = CompositeBudget(shared, led)
    assert c.reserve(0.1) is None and c.denial_reason == "cap:daily_usd"
    assert shared.reserve(0.99) is not None                                       # the first reservation was handed back
    c2 = CompositeBudget(SharedBudget(0.05), SpendLedger(tmp_path / "x", 10).bind("b", "m"))
    assert c2.reserve(0.1) is None and c2.denial_reason == "cap:total_max_usd"
    ok = CompositeBudget(SharedBudget(1.0), SpendLedger(tmp_path / "y", 10).bind("b", "m"))
    tok = ok.reserve(0.1)
    ok.settle(tok, 0.04)
    assert ok.budgets[0].spent == pytest.approx(0.04)


# ---------------- kill switch ----------------

def test_kill_switch_file_env_and_release(tmp_path, monkeypatch):
    killswitch.configure(tmp_path)
    assert not killswitch.engaged()
    p = killswitch.engage("maintenance")
    assert p.exists() and "maintenance" in killswitch.engaged()
    assert killswitch.release() is True and not killswitch.engaged() and killswitch.release() is False
    monkeypatch.setenv("VBEAT_KILL", "1")
    assert killswitch.engaged()
    monkeypatch.setenv("VBEAT_KILL", "0")
    assert not killswitch.engaged()


# ---------------- secrets ----------------

def test_redact_registered_and_key_shaped_strings():
    register_secret(KEY)
    assert redact(f"error for {KEY} here") == f"error for {REDACTED} here"
    assert KEY not in redact("Authorization: Bearer " + "abcdefgh" * 4)
    assert "sk-or-v1-zzzzzzzzzzzzzzzzzzzz" not in redact("leaked sk-or-v1-zzzzzzzzzzzzzzzzzzzz in text")       # never registered, still caught by shape
    assert redact("nothing secret: Bearer is a word") == "nothing secret: Bearer is a word"
    assert redact("") == ""


def test_child_processes_get_no_secret_looking_variables():
    env = scrub_env({"PATH": "/bin", "OPENROUTER_API_KEY": KEY, "AWS_SECRET_ACCESS_KEY": "x", "GITHUB_TOKEN": "t", "MY_PASSWORD": "p", "HOME": "/h",
                     "PYTHONPATH": "/src", "PLAYWRIGHT_BROWSERS_PATH": "/pw", "SESSION_COOKIE": "c", "LANG": "C"})
    assert set(env) == {"PATH", "HOME", "PYTHONPATH", "PLAYWRIGHT_BROWSERS_PATH", "LANG"}


def test_persisted_text_is_redacted(tmp_path):
    from vbeat_agent.state import append_line, write_text_atomic
    register_secret(KEY)
    write_text_atomic(tmp_path / "a.json", json.dumps({"x": f"oops {KEY}"}))
    append_line(tmp_path / "b.jsonl", f'{{"y": "{KEY}"}}')
    assert KEY not in (tmp_path / "a.json").read_text() + (tmp_path / "b.jsonl").read_text()


def test_settings_repr_hides_the_key():
    from vbeat_agent.config import Settings
    assert KEY not in repr(Settings(api_key=KEY)) and KEY not in str(Settings(api_key=KEY))


# ---------------- plain-language errors ----------------

CODES = ["ask_user", "give_up", "checks_failed:C4,A0", "cap:max_steps", "cap:max_minutes", "cap:max_usd", "cap:total_max_usd", "cap:daily_usd",
         "cap:max_tool_errors_in_a_row", "cap:context", "no_tool_call", "stuck", "llm_auth", "llm_bad_request", "llm_unavailable", "llm_error",
         "model_not_supported", "tool_fault:write_scene", "tool_fault:ingest", "kill_switch", "cancel", "cancel:batch_auth_error", "sigterm", "sigint",
         "cancelled", "busy", "no_api_key", "internal_error", "bootstrap", "some_future_reason"]


@pytest.mark.parametrize("code", CODES)
def test_every_reason_has_what_why_and_fix(code):
    e = explain(code, "detail text")
    assert e is not None and e.what.strip() and e.why.strip() and e.fix.strip(), code
    assert not any(w in (e.what + e.why + e.fix) for w in ("Traceback", "Exception", "None"))
    assert e.to_dict().keys() >= {"code", "what", "why", "fix"}


def test_auth_errors_are_told_apart():
    assert "credits" in explain("llm_auth", "HTTP 402: x", http_status=402).what
    assert "not allowed" in explain("llm_auth", "HTTP 403", http_status=403).what
    e = explain("llm_auth", "HTTP 401: No auth credentials found", http_status=401)
    assert "rejected the API key" in e.what and "openrouter.ai/keys" in e.fix
    assert explain("finished") is None and explain(None) is None


def test_the_what_for_an_unknown_reason_still_says_something_useful():
    e = explain("brand_new_reason", "weird")
    assert "brand_new_reason" in e.what + e.why and e.fix


# ---------------- sandbox ----------------

def test_safe_path_blocks_escapes(tmp_path):
    root = tmp_path / "beat"
    root.mkdir()
    (tmp_path / "secret.txt").write_text("s")
    assert safe_path(root, "versions/scene_001.js") == root.resolve() / "versions" / "scene_001.js"
    for bad in ("../secret.txt", "a/../../secret.txt", str(tmp_path / "secret.txt"), "/etc/passwd"):
        with pytest.raises(SandboxError):
            safe_path(root, bad)
    os.symlink(tmp_path / "secret.txt", root / "link.txt")
    with pytest.raises(SandboxError):
        safe_path(root, "link.txt")
    os.symlink(tmp_path, root / "dirlink")
    with pytest.raises(SandboxError):
        safe_path(root, "dirlink/secret.txt")
