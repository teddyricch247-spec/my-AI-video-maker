"""run_worker (startup order, preflight gate, registration, HTTP, shutdown), the export job, and the CLI helpers. No Chromium."""
import asyncio
import io
import json
import socket
import urllib.request
import zipfile

import pytest
from fake_db import FakeDb, FakeStorage
from helpers import await_until, make_ctx, run

from vbeat_agent import killswitch
from vbeat_backend.__main__ import example_spans
from vbeat_backend.worker import main as wmain
from vbeat_backend.worker.loop import Loop


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def test_run_worker_startup_order_registration_http_and_shutdown(tmp_path, monkeypatch):
    db = FakeDb()
    pid = db.add_project()
    orphan = db.add_job("beat.run", pid, {"session_id": "s1", "beat_id": "b1"})
    db.jobs[orphan].update(status="running", locked_by="worker-1", attempts=1, heartbeat_at=1e12)      # a previous life of THIS worker
    other = db.add_job("beat.run", pid, {"session_id": "s2", "beat_id": "b2"})
    db.jobs[other].update(status="running", locked_by="worker-2", attempts=1, heartbeat_at=1e12)       # somebody else's live job: must not be touched
    ctx = make_ctx(tmp_path, db, slots=2)
    ctx.cfg.port, ctx.cfg.tick_secret = free_port(), "tick-secret-xyz"
    seen = []

    async def fake_preflight(c, network=True):
        return {"ok": True, "status": "ready", "summary": "ok", "checks": []}
    monkeypatch.setattr(wmain, "run_preflight", fake_preflight)
    import vbeat_backend.worker.loop as loopmod

    async def fake_runner(c, job):
        seen.append(job["id"])
        db.finish_job(job["id"], c.cfg.worker_id, "done", {}, None)
    monkeypatch.setitem(loopmod.RUNNERS, "beat.run", fake_runner)

    async def go():
        t = asyncio.create_task(wmain.run_worker(ctx.cfg, ctx=ctx, install_signals=False))
        assert await await_until(lambda: "worker-1" in db.workers and seen, 10)
        assert killswitch.has_provider()                                       # the kill switch comes from the database
        row = db.workers["worker-1"]
        assert row["slots"] == 2 and row["role"] == "worker" and row["info"]["preflight"] == "ready" and row["version"]
        base = f"http://127.0.0.1:{ctx.cfg.port}"
        assert json.loads(urllib.request.urlopen(base + "/healthz", timeout=5).read())["worker"] == "worker-1"
        req = urllib.request.Request(base + "/wake", method="POST", headers={"X-Tick-Secret": "tick-secret-xyz"}, data=b"")
        assert json.loads(urllib.request.urlopen(req, timeout=5).read())["ok"] is True
        ctx.stopping.set()
        loop = await asyncio.wait_for(t, 40)
        return loop
    run(go())
    assert seen == [orphan] and db.jobs[other]["status"] == "running" and db.jobs[other]["locked_by"] == "worker-2"      # own orphan requeued and re-run; the other's untouched
    assert db.workers["worker-1"]["info"].get("stopped") is True and not killswitch.has_provider()


def test_failed_preflight_blocks_claiming_and_says_why(tmp_path, monkeypatch):
    db = FakeDb()
    pid = db.add_project()
    db.add_job("beat.run", pid, {"session_id": "s1", "beat_id": "b1"})
    ctx = make_ctx(tmp_path, db)
    ctx.cfg.port = free_port()

    async def bad_preflight(c, network=True):
        return {"ok": False, "status": "not_ready", "summary": "Chromium cannot start: missing libnss3", "checks": []}
    monkeypatch.setattr(wmain, "run_preflight", bad_preflight)

    async def go():
        t = asyncio.create_task(wmain.run_worker(ctx.cfg, ctx=ctx, install_signals=False, with_http=False))
        assert await await_until(lambda: "worker-1" in db.workers and db.workers["worker-1"]["info"].get("blocked_reason"), 10)
        await asyncio.sleep(0.4)
        info = db.workers["worker-1"]["info"]
        ctx.stopping.set()
        await asyncio.wait_for(t, 40)
        return info
    info = run(go())
    assert "Chromium cannot start" in info["blocked_reason"] and info["claiming"] is False and db.jobs[1]["status"] == "queued"


# ---- export.build ---------------------------------------------------------------------------------------------------------------
def _export_world(tmp_path, n=2, rendered=True):
    db, st = FakeDb(), FakeStorage()
    pid = db.add_project()
    ids = []
    for i in range(n):
        b = db.add_beat(pid, i, 0, 8, model_job=False, title=f"Big Number!")
        if rendered:
            path = f"{pid}/{b['beat_id']}/final.mp4"
            st.objects[("renders", path)] = b"\x00\x00mp4-bytes-%d" % i
            db.beats[b["beat_id"]].update(final_path=path, final_bytes=len(st.objects[("renders", path)]), status="approved")
        ids.append(b["beat_id"])
    eid = "11111111-1111-1111-1111-111111111111"
    db.exports[eid] = {"id": eid, "project_id": pid, "status": "queued", "beat_ids": ids, "files": None, "zip_path": None, "manifest_path": None}
    jid = db.add_job("export.build", pid, {"export_id": eid})
    return db, st, pid, eid, jid


def test_export_builds_zip_and_manifest_and_fills_the_row(tmp_path):
    db, st, pid, eid, jid = _export_world(tmp_path)
    ctx = make_ctx(tmp_path, db, st)

    async def go():
        lp = Loop(ctx)
        t = asyncio.create_task(lp.run())
        ok = await await_until(lambda: db.jobs[jid]["status"] in ("done", "failed", "canceled"), 30)
        await lp.drain(2)
        t.cancel()
        return ok
    assert run(go()) and db.jobs[jid]["status"] == "done", db.jobs[jid]
    ex = db.exports[eid]
    assert ex["status"] == "done" and ex["progress_done"] == ex["progress_total"] == 2 and ex["expires_at"]
    assert ex["zip_path"] == f"{pid}/exports/{eid}/export.zip" and ex["manifest_path"] == f"{pid}/exports/{eid}/manifest.json"
    z = zipfile.ZipFile(io.BytesIO(st.objects[("renders", ex["zip_path"])]))
    assert sorted(z.namelist()) == ["00_big-number.mp4", "01_big-number.mp4", "manifest.json"] and z.read("00_big-number.mp4") == b"\x00\x00mp4-bytes-0"
    manifest = json.loads(st.objects[("renders", ex["manifest_path"])])
    assert [f["name"] for f in manifest["files"]] == ["00_big-number.mp4", "01_big-number.mp4"] and all(len(f["sha256"]) == 64 for f in manifest["files"])
    assert [f["name"] for f in ex["files"]] == [f["name"] for f in manifest["files"]]
    assert not (ctx.cfg.work_dir / f"job-{jid}").exists()


def test_export_of_unrendered_beats_fails_with_the_list(tmp_path):
    db, st, pid, eid, jid = _export_world(tmp_path, rendered=False)
    ctx = make_ctx(tmp_path, db, st)

    async def go():
        lp = Loop(ctx)
        t = asyncio.create_task(lp.run())
        ok = await await_until(lambda: db.jobs[jid]["status"] in ("done", "failed", "canceled"), 30)
        await lp.drain(2)
        t.cancel()
        return ok
    assert run(go())
    assert db.jobs[jid]["status"] == "failed" and "no final video yet" in db.jobs[jid]["error"]
    assert db.exports[eid]["status"] == "failed" and "#0" in db.exports[eid]["error"]


# ---- CLI helpers ------------------------------------------------------------------------------------------------------------------
def test_seed_spans_are_real_sentences_not_one_word():
    spans = example_spans(list(range(13)), 6)
    assert spans[0] == (0, 8) and all(b - a >= 8 or b == 12 for a, b in spans) and all(0 <= a <= b <= 12 for a, b in spans)
    assert example_spans(list(range(5)), 3)[0] == (0, 4)


def test_log_lines_and_tracebacks_are_redacted(caplog):
    import logging
    from vbeat_agent.redact import register_secret
    register_secret("pw-super-secret-value-123")
    stream = io.StringIO()
    h = logging.StreamHandler(stream)
    h.addFilter(wmain.RedactFilter())
    lg = logging.getLogger("redact-test")
    lg.addHandler(h)
    lg.propagate = False
    try:
        raise RuntimeError("could not connect to postgresql://u:pw-super-secret-value-123@h/db")
    except RuntimeError:
        lg.exception("claim failed for pw-super-secret-value-123")
    assert "pw-super-secret-value-123" not in stream.getvalue() and "claim failed" in stream.getvalue() and "RuntimeError" in stream.getvalue()
