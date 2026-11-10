"""Fast tests: config, budget, writer + mirror, heartbeat, claim loop, HTTP app, storage retries, version sync. No Chromium."""
import asyncio
import json
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from fake_db import FakeDb, FakeStorage
from helpers import make_cfg, make_ctx, run

from vbeat_agent import killswitch
from vbeat_backend.config import ConfigError, load_config
from vbeat_backend.storage import Storage, StorageError
from vbeat_backend.worker.budget import SupabaseBudget
from vbeat_backend.worker.heartbeat import Heartbeat
from vbeat_backend.worker.http import start_http
from vbeat_backend.worker.killswitch import KILL_REASON, SettingsCache
from vbeat_backend.worker.loop import Loop
from vbeat_backend.worker.mirror import DbMirror, JobWriter, clean_json


# ---- config ------------------------------------------------------------------------------------------------------------------
def test_config_names_what_is_missing_and_parses_numbers():
    with pytest.raises(ConfigError, match="DATABASE_URL"):
        load_config({})
    with pytest.raises(ConfigError, match="WORKER_SLOTS"):
        load_config({"DATABASE_URL": "x", "SUPABASE_URL": "y", "SUPABASE_SERVICE_ROLE_KEY": "z", "WORKER_SLOTS": "three"})
    c = load_config({"DATABASE_URL": "postgresql://u:p@h/db", "SUPABASE_URL": "https://a.supabase.co/", "SUPABASE_SERVICE_ROLE_KEY": "service-role-key-0123456789",
                     "WORKER_ID": "worker-7", "VBEAT_MAX_HEAVY": "2", "TICK_SECRET": "tick-secret-0123456789"})
    assert c.worker_id == "worker-7" and c.slots == 3 and c.max_heavy == 2 and c.supabase_url == "https://a.supabase.co"
    assert "service-role-key" not in repr(c) and "service-role-key" not in json.dumps(c.sanitized())


def test_secrets_are_registered_with_the_redactor():
    from vbeat_agent.redact import redact
    load_config({"DATABASE_URL": "postgresql://u:pw-very-secret-123@h/db", "SUPABASE_URL": "https://a", "SUPABASE_SERVICE_ROLE_KEY": "eyJ-service-role-key-abcdef"})
    assert "pw-very-secret-123" not in redact("connecting to postgresql://u:pw-very-secret-123@h/db failed")
    assert "eyJ-service-role-key-abcdef" not in redact("key eyJ-service-role-key-abcdef")


# ---- settings cache + kill switch -----------------------------------------------------------------------------------------
def test_kill_switch_provider_follows_the_database_and_survives_blips():
    db = FakeDb()
    cache = SettingsCache(db, 0.02).start()
    killswitch.register_provider(cache.kill_reason)
    assert killswitch.engaged() is None
    db.settings["kill_switch"] = True
    time.sleep(0.2)
    assert killswitch.engaged() == KILL_REASON
    db.fail_next["settings_all"] = 10_000                                    # the database goes away: the last value stays
    time.sleep(0.2)
    assert killswitch.engaged() == KILL_REASON and cache.last_error
    db.settings["kill_switch"] = False
    db.fail_next["settings_all"] = 0
    time.sleep(0.4)
    assert killswitch.engaged() is None
    cache.stop()


def test_caps_and_model_defaults():
    db = FakeDb({"caps": {"daily_usd": 3}, "models": {"beat": None}})
    c = SettingsCache(db)
    c.refresh()
    assert c.caps()["daily_usd"] == 3 and c.caps()["beat_usd"] == 0.5 and c.caps()["run_usd"] == 1.5 and c.beat_model() is None


# ---- budget ------------------------------------------------------------------------------------------------------------------
def _budget(db, **caps):
    pid = db.add_project()
    b = db.add_beat(pid, 0, 0, 8, model_job=False)
    db.settings["caps"].update(caps)
    cache = SettingsCache(db)
    cache.refresh()
    return SupabaseBudget(db, cache, project_id=pid, session_id=b["session_id"], sleep=lambda s: None), pid, b["session_id"]


def test_budget_checks_each_cap_in_order_and_names_the_reason():
    db = FakeDb()
    bud, pid, sid = _budget(db)
    bound = bud.bind("beat0", "m")
    tok = bound.reserve(0.01)
    assert tok is not None
    bound.settle(tok, 0.2)
    assert db.costs[0]["usd"] == 0.2 and db.sessions[sid]["cost_usd"] == pytest.approx(0.2)          # settle inserts the cost row; the trigger rolls it up
    bud.attach_usage(1200, 300)
    assert db.costs[0]["tokens_in"] == 1200 and db.costs[0]["tokens_out"] == 300
    assert bud.today()["remaining"] == pytest.approx(0.3)
    bound.settle(bound.reserve(0.01), 0.3)                                    # beat total 0.5 == caps.beat_usd
    assert bound.reserve(0.01) is None and bound.denial_reason == "cap:max_usd" and bud.today()["remaining"] == 0

    db2 = FakeDb()
    bud2, pid2, sid2 = _budget(db2, run_usd=0.1)
    db2.insert_cost_event(pid2, None, "m", 0.1)                                # another beat of the same project already spent the run cap
    assert bud2.bind("b", "m").reserve(0.0) is None and bud2.denial_reason == "cap:run_usd"

    db3 = FakeDb()
    bud3, pid3, sid3 = _budget(db3, daily_usd=1.0)
    other = db3.add_project("__test__other")
    db3.insert_cost_event(other, None, "m", 1.0)                               # other projects count toward the day
    assert bud3.today() == {"remaining": 0.0, "reason": "cap:daily_usd"} and bud3.denial_reason == "cap:daily_usd"


def test_budget_counts_in_flight_estimates_and_retries_lost_cost_rows():
    db = FakeDb()
    bud, pid, sid = _budget(db, beat_usd=0.5)
    t1, t2 = bud.reserve(0.3), bud.reserve(0.3)            # 0.3 in flight leaves 0.2: allowed
    assert t1 and t2 and bud.reserve(0.3) is None          # 0.6 in flight exceeds the 0.5 cap: the overshoot is bounded by calls in flight
    bud.settle(t1, 0.0)
    bud.settle(t2, 0.0)                                    # failed calls cost nothing and free their reservation
    assert db.costs == [] and bud.reserve(0.3) is not None
    db.fail_next["insert_cost_event"] = 3                  # the database is down while the call settles: the cost is kept and retried, never dropped
    bud.settle(bud.reserve(0.0), 0.05)
    assert db.costs == [] and len(bud.unrecorded) == 1
    bud.flush_unrecorded()
    assert [c["usd"] for c in db.costs] == [0.05] and bud.unrecorded == []


# ---- writer + mirror ---------------------------------------------------------------------------------------------------------
def _mirror(db, base=0, queue=None):
    pid = db.add_project()
    b = db.add_beat(pid, 0, 0, 8, model_job=False)
    w = JobWriter("t", sleep=lambda s: None)
    return DbMirror(db, w, session_id=b["session_id"], beat_id=b["beat_id"], base_raw_count=base, request_public={"idx": 0}, pending_queue_ids=queue), w, b


def test_writer_keeps_order_coalesces_keyed_work_and_retries():
    out, gate = [], threading.Event()
    w = JobWriter("t", sleep=lambda s: None)
    w.submit(lambda: gate.wait(2))                          # holds the thread so the next ones queue up
    for i in range(3):
        w.submit(lambda i=i: out.append(("m", i)))
    for i in range(5):
        w.submit(lambda i=i: out.append(("state", i)), key="state")
    gate.set()
    assert w.flush(5) and out == [("m", 0), ("m", 1), ("m", 2), ("state", 4)]
    n = {"c": 0}

    def flaky():
        n["c"] += 1
        if n["c"] < 3:
            raise ConnectionError("blip")
        out.append("ok")
    w.submit(flaky)
    assert w.flush(5) and out[-1] == "ok" and n["c"] == 3 and w.errors == []
    w.submit(lambda: (_ for _ in ()).throw(ValueError("bad data")))      # programming errors are not retried
    w.flush(5)
    assert len(w.errors) == 1 and "bad data" in w.errors[0]
    w.close()


def test_raw_messages_are_idempotent_ordered_and_survive_a_database_blip():
    db = FakeDb()
    m, w, b = _mirror(db)
    msgs = [{"role": "system", "content": "s"}, {"role": "user", "content": "go\x00", "_meta": {"kind": "first"}}, {"role": "assistant", "content": "ok"}, {"role": "tool", "tool_call_id": "c1", "content": "r"}]
    db.fail_next["append_message"] = 1                                     # the 2nd write attempt of the first message fails once, then retries
    for x in msgs:
        m.message(x)
    assert w.flush(10)
    raw = db.raw(b["session_id"])
    assert [r["content"]["role"] for r in raw] == ["system", "user", "assistant", "tool"] and [r["seq"] for r in raw] == [1, 2, 3, 4]
    assert "\x00" not in raw[1]["content"]["content"] and raw[3]["tool_call_id"] == "c1" and all(r["visible"] is False for r in raw)
    # a second mirror for the same session that replays message 2 (e.g. a retried job) writes nothing twice
    m2 = DbMirror(db, w, session_id=b["session_id"], beat_id=b["beat_id"], base_raw_count=0, request_public={})
    for x in msgs:
        m2.message(x)
    m2.message({"role": "user", "content": "new"})
    assert w.flush(10) and len(db.raw(b["session_id"])) == 5
    w.close()


def test_queued_feedback_is_cleared_only_after_the_reviewer_message_is_stored():
    db = FakeDb()
    pid = db.add_project()
    b = db.add_beat(pid, 0, 0, 8, model_job=False)
    qid = db.append_message(b["session_id"], "user", {"text": "make it bigger"}, ui_text="make it bigger", queued=True, visible=True)
    w = JobWriter("t", sleep=lambda s: None)
    m = DbMirror(db, w, session_id=b["session_id"], beat_id=b["beat_id"], base_raw_count=0, request_public={}, pending_queue_ids=[qid])
    m.message({"role": "system", "content": "s"})
    w.flush(5)
    assert db.queued_user_messages(b["session_id"]) != []                  # not yet: only the system message is stored
    m.message({"role": "user", "content": "MESSAGE FROM THE HUMAN REVIEWER ...", "_meta": {"kind": "reviewer"}})
    w.flush(5)
    assert db.queued_user_messages(b["session_id"]) == []
    w.close()


def test_state_mirror_updates_session_and_beat_and_keeps_debug():
    db = FakeDb()
    m, w, b = _mirror(db)
    db.merge_session_state(b["session_id"], {"debug": "kept"})
    m.state({"steps": 4, "scene_n": 2, "sfx_n": 1, "status": "running", "model": "x/y"})
    w.flush(5)
    s = db.sessions[b["session_id"]]
    assert s["steps"] == 4 and s["state"]["runner"]["scene_n"] == 2 and s["state"]["debug"] == "kept" and s["state"]["request"] == {"idx": 0}
    assert db.beats[b["beat_id"]]["scene_n"] == 2 and db.beats[b["beat_id"]]["sfx_n"] == 1
    w.close()


def test_a_writer_whose_lock_is_lost_drops_everything():
    ok = {"v": True}
    w = JobWriter("t", guard=lambda: ok["v"], sleep=lambda s: None)
    out = []
    w.submit(lambda: out.append(1))
    w.flush(5)
    ok["v"] = False
    w.submit(lambda: out.append(2))
    w.flush(5)
    w.submit(lambda: out.append(3))
    w.flush(5)
    assert out == [1]
    w.close()


# ---- heartbeat ------------------------------------------------------------------------------------------------------------------
def test_heartbeat_tells_cancel_requested_from_lock_lost():
    db = FakeDb()
    pid = db.add_project()
    jid = db.add_job("beat.run", pid, {"session_id": "s"})
    job = db.claim_job("w1", ["beat.run"])

    async def go():
        cancel = asyncio.Event()
        hb = Heartbeat(db, jid, "w1", cancel, 0.05)
        assert await hb.beat_once() and not cancel.is_set() and hb.fresh()
        db.jobs[jid]["cancel_requested"] = True
        assert not await hb.beat_once() and hb.reason == "cancel_requested" and cancel.is_set() and not hb.lock_lost
        db.jobs[jid].update(cancel_requested=False, locked_by="w2")                 # taken over by someone else
        cancel2 = asyncio.Event()
        hb2 = Heartbeat(db, jid, "w1", cancel2, 0.05)
        assert not await hb2.beat_once() and hb2.reason == "lock_lost" and hb2.lock_lost and cancel2.is_set()
    run(go())


def test_heartbeat_runs_in_the_background_while_the_loop_is_busy():
    db = FakeDb()
    pid = db.add_project()
    jid = db.add_job("beat.run", pid, {"session_id": "s"})
    db.claim_job("w1", ["beat.run"])

    async def go():
        hb = Heartbeat(db, jid, "w1", asyncio.Event(), 0.05).start()
        first = db.jobs[jid]["heartbeat_at"]
        await asyncio.sleep(0.4)
        await hb.stop()
        assert hb.beats >= 3 and db.jobs[jid]["heartbeat_at"] > first
    run(go())


# ---- claim loop ------------------------------------------------------------------------------------------------------------------
def test_loop_runs_at_most_slots_jobs_at_once_and_drains_the_queue(tmp_path, monkeypatch):
    import vbeat_backend.worker.loop as loopmod
    db = FakeDb()
    pid = db.add_project()
    for i in range(10):
        db.add_job("beat.run", pid, {"session_id": f"s{i}", "beat_id": f"b{i}"})
    ctx = make_ctx(tmp_path, db, slots=3)
    seen = {"now": 0, "max": 0, "done": 0}

    async def fake_runner(ctx_, job):
        seen["now"] += 1
        seen["max"] = max(seen["max"], seen["now"])
        await asyncio.sleep(0.15)
        db.finish_job(job["id"], ctx_.cfg.worker_id, "done", {}, None)
        seen["now"] -= 1
        seen["done"] += 1
    monkeypatch.setitem(loopmod.RUNNERS, "beat.run", fake_runner)

    async def go():
        lp = Loop(ctx)
        t = asyncio.create_task(lp.run())
        ok = False
        for _ in range(200):
            if seen["done"] == 10:
                ok = True
                break
            await asyncio.sleep(0.05)
        await lp.drain(2)
        t.cancel()
        return ok
    assert run(go()) and seen["max"] == 3
    assert all(j["status"] == "done" for j in db.jobs.values())


def test_loop_does_not_claim_while_the_kill_switch_is_on_or_when_blocked(tmp_path, monkeypatch):
    import vbeat_backend.worker.loop as loopmod
    db = FakeDb({"kill_switch": True})
    pid = db.add_project()
    db.add_job("beat.run", pid, {"session_id": "s", "beat_id": "b"})
    ctx = make_ctx(tmp_path, db)
    claimed = []
    monkeypatch.setitem(loopmod.RUNNERS, "beat.run", lambda c, j: asyncio.sleep(0))

    async def go():
        lp = Loop(ctx)
        t = asyncio.create_task(lp.run())
        await asyncio.sleep(0.3)
        killed_claims = db.calls.get("claim_job", 0)
        db.settings["kill_switch"] = False
        ctx.cache.refresh()
        await asyncio.sleep(0.3)
        assert db.jobs[1]["status"] != "queued"
        db.add_job("beat.run", pid, {"session_id": "s2", "beat_id": "b2"})
        lp.claiming = False                                  # preflight blocked: no claims even though a job waits
        n = db.calls.get("claim_job", 0)
        await asyncio.sleep(0.3)
        assert db.calls.get("claim_job", 0) == n and db.jobs[2]["status"] == "queued"
        await lp.drain(1)
        t.cancel()
        return killed_claims
    assert run(go()) == 0


# ---- HTTP app --------------------------------------------------------------------------------------------------------------------
def _get(url, method="GET", headers=None):
    req = urllib.request.Request(url, method=method, headers=headers or {}, data=b"" if method == "POST" else None)
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def test_http_app_auth_and_wake():
    woke = []
    srv = start_http(0, lambda: {"ok": True, "worker": "worker-1", "running": 2}, lambda: woke.append(1), lambda: {"ok": True, "checks": []}, "s3cret-value", host="127.0.0.1")
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    try:
        assert _get(base + "/healthz")[1]["worker"] == "worker-1"
        assert _get(base + "/preflight")[0] == 401 and _get(base + "/preflight", headers={"X-Tick-Secret": "wrong"})[0] == 401
        assert _get(base + "/preflight", headers={"X-Tick-Secret": "s3cret-value"}) == (200, {"ok": True, "checks": []})
        assert _get(base + "/wake", "POST")[0] == 401 and woke == []
        assert _get(base + "/wake", "POST", {"X-Tick-Secret": "s3cret-value"})[0] == 200 and woke == [1]
        assert _get(base + "/nope")[0] == 404
    finally:
        srv.shutdown()


def test_http_app_refuses_everything_when_no_secret_is_configured():
    srv = start_http(0, lambda: {"ok": True}, lambda: None, lambda: {}, "", host="127.0.0.1")
    try:
        assert _get(f"http://127.0.0.1:{srv.server_address[1]}/wake", "POST", {"X-Tick-Secret": ""})[0] == 401
    finally:
        srv.shutdown()


# ---- storage -----------------------------------------------------------------------------------------------------------------------
class _Handler(BaseHTTPRequestHandler):
    log: list = []
    fail_first: int = 0

    def log_message(self, *a):
        pass

    def _do(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else b""
        _Handler.log.append((self.command, self.path, dict(self.headers), body))
        if _Handler.fail_first > 0:
            _Handler.fail_first -= 1
            self.send_response(503)
            self.end_headers()
            self.wfile.write(b"busy")
            return
        if self.path.endswith("/missing.bin"):
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'{"message":"Object not found"}')
            return
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"payload" if self.command == "GET" else b"{}")
    do_GET = do_POST = do_DELETE = _do


def test_storage_retries_server_errors_sends_upsert_and_does_not_retry_404(tmp_path):
    srv = HTTPServer(("127.0.0.1", 0), _Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        st = Storage(f"http://127.0.0.1:{srv.server_address[1]}", "service-key-0123456789", sleep=lambda s: None)
        _Handler.fail_first, _Handler.log = 2, []
        assert st.upload("previews", "p1/b 1/scene_001.strip.jpg", b"jpgbytes", "image/jpeg") == 8
        posts = [e for e in _Handler.log if e[0] == "POST"]
        assert len(posts) == 3 and posts[-1][1] == "/storage/v1/object/previews/p1/b%201/scene_001.strip.jpg"
        hdr = {k.lower(): v for k, v in posts[-1][2].items()}
        assert hdr["x-upsert"] == "true" and hdr["authorization"] == "Bearer service-key-0123456789"
        assert st.download("renders", "a/final.mp4", tmp_path / "d" / "f.mp4") == 7 and (tmp_path / "d" / "f.mp4").read_bytes() == b"payload"
        _Handler.log = []
        with pytest.raises(StorageError) as ei:
            st.download("renders", "a/missing.bin", tmp_path / "x")
        assert ei.value.status == 404 and len(_Handler.log) == 1
        _Handler.fail_first = 10
        with pytest.raises(StorageError):
            st.upload("previews", "x", b"1")
    finally:
        srv.shutdown()


# ---- version sync ------------------------------------------------------------------------------------------------------------------
def test_version_sync_uploads_only_what_changed(tmp_path):
    from vbeat_agent.hydrate import rebuild_beat_dir
    from vbeat_agent.state import BeatPaths
    from vbeat_backend.worker.sink import VersionSync
    db, st = FakeDb(), FakeStorage()
    pid = db.add_project()
    b = db.add_beat(pid, 0, 0, 8, model_job=False)
    scenes = [{"n": 1, "source": "s1", "report": {"ok": False}}, {"n": 2, "source": "s2", "report": {"ok": True}}]
    cues = [{"n": 1, "source": "c1", "report": {"ok": True, "metrics": {"peak": -7}}}]
    p = rebuild_beat_dir(tmp_path / "b", request={}, state={"scene_n": 2, "sfx_n": 1}, messages=[], scene_versions=scenes, sfx_versions=cues)
    p.scene_strip(2).write_bytes(b"strip2")
    p.cue_wav(1).write_bytes(b"wav1")
    p.cue_preview(1).write_bytes(b"spec1")
    vs = VersionSync(db, st, tmp_path / "b", project_id=pid, beat_id=b["beat_id"])
    assert vs.sync() == 3
    assert db.scene[(b["beat_id"], 2)]["strip_path"] == f"{pid}/{b['beat_id']}/scene_002.strip.jpg" and db.scene[(b["beat_id"], 1)]["strip_path"] is None
    assert db.sfx[(b["beat_id"], 1)]["checks"]["metrics"] == {"peak": -7} and db.sfx[(b["beat_id"], 1)]["wav_path"].endswith("cue_001.wav")
    assert st.paths("previews") == sorted([f"{pid}/{b['beat_id']}/scene_002.strip.jpg", f"{pid}/{b['beat_id']}/cue_001.wav", f"{pid}/{b['beat_id']}/cue_001.preview.jpg"])
    assert vs.sync() == 0                                                  # nothing changed: nothing written
    (tmp_path / "b" / "versions" / "scene_001.check.json").write_text(json.dumps({"ok": True, "full": True}))
    assert vs.sync() == 1 and db.scene[(b["beat_id"], 1)]["checks"] == {"ok": True, "full": True}       # a later full check updates an old version's report
    assert clean_json({"a": "x\u0000y"}) == {"a": "xy"}
