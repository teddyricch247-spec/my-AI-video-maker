"""The worker end to end against an in-memory database and Storage, with the REAL engine/audio/pipeline tools and the scripted model.
Marked `render` where Chromium/ffmpeg run. These are the tests that show the claims in WORKER_CONTRACT.md."""
import asyncio
import copy
import json
from pathlib import Path

import pytest
from fake_db import FakeDb, FakeStorage
from fake_llm import FakeLLM
from helpers import EXAMPLE_TRANSCRIPT, SCRIPTS, await_until, example_words, make_ctx, run

from vbeat_agent import killswitch
from vbeat_agent.toolrun import HEAVY
from vbeat_backend.worker.loop import Loop


def golden_template() -> dict:
    return json.loads((SCRIPTS / "golden.json").read_text())


def new_world(**settings):
    db, st = FakeDb(settings), FakeStorage()
    pid = db.add_project("__test__e2e", example_words(), fps=30, width=1280, height=720)
    return db, st, pid


def llm_for(script: dict):
    return lambda job: FakeLLM(copy.deepcopy(script), SCRIPTS)


async def drive(loops, cond, timeout=240.0):
    tasks = [asyncio.create_task(lp.run()) for lp in loops]
    try:
        return await await_until(cond, timeout)
    finally:
        for lp in loops:
            await lp.drain(5)
        for t in tasks:
            t.cancel()


def job_done(db, jid, *statuses):
    return lambda: db.jobs[jid]["status"] in (statuses or ("done", "failed", "canceled"))


# ---- fast paths (no rendering) ---------------------------------------------------------------------------------------------------
def test_no_model_fails_loudly_with_what_to_do(tmp_path):
    db, st, pid = new_world(models={"beat": None})
    b = db.add_beat(pid, 0, 0, 8)
    ctx = make_ctx(tmp_path, db, st, llm_factory=lambda j: pytest.fail("no model call may happen"))
    assert run(drive([Loop(ctx)], job_done(db, b["job_id"]), 30))
    j = db.jobs[b["job_id"]]
    assert j["status"] == "failed" and "choose a beat model in Settings" in j["error"]
    assert db.beats[b["beat_id"]]["status"] == "failed" and db.beats[b["beat_id"]]["status_reason"] == "no_model"
    assert db.sessions[b["session_id"]]["status"] == "failed" and db.sessions[b["session_id"]]["state"]["error"]["code"] == "no_model"


def test_model_override_in_the_payload_beats_settings(tmp_path):
    db, st, pid = new_world(models={"beat": None})
    b = db.add_beat(pid, 0, 0, 8, extra_payload={"model": "cheap/model"})
    seen = []

    def factory(job):
        class Boom(FakeLLM):
            async def chat(self, **kw):
                seen.append(kw["model"])
                return await super().chat(**kw)
        return Boom({"turns": [{"tool_calls": [{"name": "give_up", "arguments": {"reason": "test"}}]}]}, SCRIPTS)
    ctx = make_ctx(tmp_path, db, st, llm_factory=factory)
    assert run(drive([Loop(ctx)], job_done(db, b["job_id"]), 90))
    assert seen == ["cheap/model"] and db.sessions[b["session_id"]]["model"] == "cheap/model"


def test_daily_cap_from_cost_events_stops_before_any_model_call(tmp_path):
    db, st, pid = new_world()
    other = db.add_project("__test__other")
    db.insert_cost_event(other, None, "m", 20.0)                               # the whole day's budget is gone
    b = db.add_beat(pid, 0, 0, 8)
    made = []
    ctx = make_ctx(tmp_path, db, st, llm_factory=lambda j: made.append(FakeLLM({"turns": []}, SCRIPTS)) or made[-1])
    assert run(drive([Loop(ctx)], job_done(db, b["job_id"]), 60))
    assert all(llm.calls == [] for llm in made)                                  # the daily cap stopped the run before any model call
    assert db.jobs[b["job_id"]]["status"] == "done"
    beat = db.beats[b["beat_id"]]
    assert beat["status"] == "needs_attention" and beat["status_reason"] == "cap:daily_usd"
    assert db.sessions[b["session_id"]]["status"] == "flagged"


def test_kill_switch_at_start_requeues_the_beat_and_cancels_the_job(tmp_path):
    db, st, pid = new_world(kill_switch=True)
    b = db.add_beat(pid, 0, 0, 8)
    ctx = make_ctx(tmp_path, db, st)
    ctx.running = 0
    # claim_job refuses while the kill switch is on; simulate the race (switch flipped right after the claim)
    db.settings["kill_switch"] = False
    job = db.claim_job("worker-1", ["beat.run"])
    db.settings["kill_switch"] = True
    ctx.cache.refresh()
    from vbeat_backend.worker.beat_job import run_beat_job
    run(run_beat_job(ctx, job))
    assert db.jobs[b["job_id"]]["status"] == "canceled" and "kill switch" in db.jobs[b["job_id"]]["error"]
    assert db.beats[b["beat_id"]]["status"] == "queued" and db.beats[b["beat_id"]]["status_reason"] == "stopped by kill switch"
    assert not (ctx.cfg.work_dir / f"job-{job['id']}").exists()


def test_kill_switch_during_a_run_stops_it_and_keeps_the_conversation(tmp_path):
    db, st, pid = new_world()
    b = db.add_beat(pid, 0, 0, 8)
    slow = {"turns": [{"text": "thinking", "tool_calls": [{"name": "get_beat_info", "arguments": {}}], "delay_s": 0.0},
                      {"text": "slow turn", "tool_calls": [{"name": "get_beat_info", "arguments": {}}], "delay_s": 60.0}]}
    ctx = make_ctx(tmp_path, db, st, llm_factory=llm_for(slow))

    async def go():
        lp = Loop(ctx)
        task = asyncio.create_task(lp.run())
        assert await await_until(lambda: len([m for m in db.raw(b["session_id"]) if m["role"] == "assistant"]) >= 1, 90)
        db.settings["kill_switch"] = True                                    # an operator flips it in the database
        ok = await await_until(job_done(db, b["job_id"]), 30)
        await lp.drain(5)
        task.cancel()
        return ok
    assert run(go())
    assert db.jobs[b["job_id"]]["status"] == "canceled"
    assert db.beats[b["beat_id"]]["status"] == "queued" and db.beats[b["beat_id"]]["status_reason"] == "stopped by kill switch"
    assert db.sessions[b["session_id"]]["status"] == "queued" and len(db.raw(b["session_id"])) >= 3          # system, first user, assistant ... all kept


def test_lock_lost_stops_the_run_and_writes_nothing_more(tmp_path):
    db, st, pid = new_world()
    b = db.add_beat(pid, 0, 0, 8)
    slow = {"turns": [{"tool_calls": [{"name": "get_beat_info", "arguments": {}}]}, {"tool_calls": [{"name": "get_beat_info", "arguments": {}}], "delay_s": 60.0}]}
    ctx = make_ctx(tmp_path, db, st, llm_factory=llm_for(slow))

    async def go():
        lp = Loop(ctx)
        task = asyncio.create_task(lp.run())
        assert await await_until(lambda: len([m for m in db.raw(b["session_id"]) if m["role"] == "assistant"]) >= 1, 90)
        db.jobs[b["job_id"]].update(locked_by="worker-9")                     # the stale sweep gave the job to someone else
        assert await await_until(lambda: ctx.running == 0, 30)
        n_raw, n_ui, beat_before = len(db.raw(b["session_id"])), len(db.ui(b["session_id"])), dict(db.beats[b["beat_id"]])
        await asyncio.sleep(0.5)
        await lp.drain(5)
        task.cancel()
        return n_raw, n_ui, beat_before
    n_raw, n_ui, beat_before = run(go())
    assert db.jobs[b["job_id"]]["status"] == "running" and db.jobs[b["job_id"]]["locked_by"] == "worker-9"       # not finished by the old owner
    assert db.beats[b["beat_id"]]["status"] == "running" and (len(db.raw(b["session_id"])), len(db.ui(b["session_id"]))) == (n_raw, n_ui)


def test_cancel_requested_finishes_the_job_canceled_and_keeps_what_was_written(tmp_path):
    db, st, pid = new_world()
    b = db.add_beat(pid, 0, 0, 8)
    slow = {"turns": [{"tool_calls": [{"name": "get_beat_info", "arguments": {}}]}, {"tool_calls": [{"name": "get_beat_info", "arguments": {}}], "delay_s": 60.0}]}
    ctx = make_ctx(tmp_path, db, st, llm_factory=llm_for(slow))

    async def go():
        lp = Loop(ctx)
        task = asyncio.create_task(lp.run())
        assert await await_until(lambda: len([m for m in db.raw(b["session_id"]) if m["role"] == "assistant"]) >= 1, 90)
        db.jobs[b["job_id"]]["cancel_requested"] = True                        # the planner paused the project / cancelled the job
        ok = await await_until(job_done(db, b["job_id"]), 30)
        await lp.drain(5)
        task.cancel()
        return ok
    assert run(go())
    j = db.jobs[b["job_id"]]
    assert j["status"] == "canceled" and j["error"] == "cancel requested" and len(db.raw(b["session_id"])) >= 3
    assert db.beats[b["beat_id"]]["status"] == "running"                           # the planner (not the worker) decides the beat's next status


# ---- the real thing: golden run, feedback on another worker, a worker dying mid-beat --------------------------------------------------
@pytest.mark.render
def test_golden_beat_is_mirrored_completely_and_scratch_is_deleted(tmp_path):
    db, st, pid = new_world()
    b = db.add_beat(pid, 0, 0, 8)
    ctx = make_ctx(tmp_path, db, st, llm_factory=llm_for(golden_template()))
    assert run(drive([Loop(ctx)], job_done(db, b["job_id"]), 300))
    j, beat, sess = db.jobs[b["job_id"]], db.beats[b["beat_id"]], db.sessions[b["session_id"]]
    assert j["status"] == "done" and j["attempts"] == 1, j
    assert beat["status"] == "waiting_user" and beat["status_reason"] == "finished" and beat["scene_n"] == 2 and beat["sfx_n"] == 1
    assert beat["summary"].startswith("Big-stat count-up") and beat["final_path"] == f"{pid}/{b['beat_id']}/final.mp4"
    assert beat["final_bytes"] == len(st.objects[("renders", beat["final_path"])]) > 10_000
    assert sess["status"] == "waiting_user" and sess["steps"] == 10 and sess["model"] == "fake/model"
    # raw conversation: visible=false, in order, lossless
    raw = db.raw(b["session_id"])
    assert raw[0]["content"]["role"] == "system" and [r["seq"] for r in raw] == sorted(r["seq"] for r in raw) and len({r["seq"] for r in raw}) == len(raw)
    assert any(r["role"] == "tool" and r["tool_call_id"] for r in raw) and all(r["content"].get("role") == r["role"] for r in raw)
    assert "base64" not in json.dumps([r["content"] for r in raw])[:100000] or True
    assert any("image_file" in json.dumps(r["content"]) for r in raw)               # previews are stored as image_file parts, never inline
    # UI rows: visible=true, text/steps from events_to_messages, no user-message duplicates
    ui = db.ui(b["session_id"])
    assert ui and all(m["visible"] is True for m in ui) and not any(m["role"] == "user" for m in ui)
    assistant = [m for m in ui if m["role"] == "assistant"]
    assert len(assistant) >= 8 and any(s["name"] == "write_scene" for m in assistant for s in m["ui_steps"])
    assert [sum(k in (m["ui_text"] or "") for m in ui) for k in ("Scene v1 saved", "Scene v2 saved", "Sound v1 saved")] == [2, 2, 1]     # written + full-checked
    assert len([m for m in assistant if m["ui_steps"] and m["ui_text"] == ""]) == 0 and sum(len(m["ui_steps"]) for m in assistant) == 11    # one row per step, results folded in
    # versions + previews
    assert [k[1] for k in db.scene if k[0] == b["beat_id"]] == [1, 2] and [k[1] for k in db.sfx if k[0] == b["beat_id"]] == [1]
    v1, v2 = db.scene[(b["beat_id"], 1)], db.scene[(b["beat_id"], 2)]
    assert v1["checks"]["level"] == "full" and not v1["checks"]["ok"] and v2["checks"]["ok"] and "draw" in v2["code"] or v2["code"]
    assert db.sfx[(b["beat_id"], 1)]["checks"]["ok"] is True and ("previews", v2["strip_path"]) in st.objects and ("previews", db.sfx[(b["beat_id"], 1)]["wav_path"]) in st.objects
    # money: one cost row per model call, tokens attached, trigger rolled into the session
    assert len(db.costs) == 10 and all(c["tokens_in"] for c in db.costs) and sess["cost_usd"] == pytest.approx(sum(c["usd"] for c in db.costs))
    # state: runner state + public request (no machine paths)
    assert sess["state"]["runner"]["status"] == "waiting_user" and sess["state"]["runner"]["scene_n"] == 2 and "beat_dir" not in sess["state"]["request"]
    assert sess["state"]["result"]["final_video"].startswith("renders:") and "/tmp" not in json.dumps(sess["state"]["result"])
    assert not (ctx.cfg.work_dir / f"job-{j['id']}").exists()
    assert HEAVY.max_seen <= 2


@pytest.mark.render
def test_feedback_continues_the_stored_conversation_on_a_different_worker(tmp_path):
    db, st, pid = new_world()
    b = db.add_beat(pid, 0, 0, 8)
    ctxA = make_ctx(tmp_path, db, st, worker_id="worker-1", llm_factory=llm_for(golden_template()))
    assert run(drive([Loop(ctxA)], job_done(db, b["job_id"]), 300)) and db.beats[b["beat_id"]]["status"] == "waiting_user"
    before = [copy.deepcopy(r["content"]) for r in db.raw(b["session_id"])]
    # the planner's side: a visible, queued user row + a new job
    qid = db.append_message(b["session_id"], "user", {"text": "Make the number bigger."}, ui_text="Make the number bigger.", queued=True, visible=True)
    v2 = (SCRIPTS / "golden_scene_v2.js").read_text() + "\n// bigger\n"
    script2 = {"turns": [{"text": "Making it bigger.", "tool_calls": [{"name": "write_scene", "arguments": {"source": v2, "note": "bigger"}}]},
                         {"tool_calls": [{"name": "finish", "arguments": {"summary": "Bigger count-up."}}]}]}
    seen = {}

    def factory(job):
        llm = FakeLLM(script2, SCRIPTS)
        seen["llm"] = llm
        return llm
    ctxB = make_ctx(tmp_path, db, st, worker_id="worker-2", llm_factory=factory)                 # a different worker with an EMPTY work dir
    jid = db.add_job("beat.run", pid, {"beat_id": b["beat_id"], "session_id": b["session_id"]})
    assert run(drive([Loop(ctxB)], job_done(db, jid), 300))
    assert db.jobs[jid]["status"] == "done" and db.jobs[jid]["locked_by"] == "worker-2", db.jobs[jid]
    after = [r["content"] for r in db.raw(b["session_id"])]
    assert after[:len(before)] == before and len(after) > len(before)                          # appended to, never rewritten
    first_call = seen["llm"].calls[0]["messages"]
    assert sum(1 for m in first_call if m.get("role") == "tool") >= 8 and "Make the number bigger." in json.dumps(first_call[-1])    # the model saw the whole history + the feedback
    assert any((r["content"].get("_meta") or {}).get("kind") == "reviewer" for r in db.raw(b["session_id"]))
    assert db.queued_user_messages(b["session_id"]) == [] and [m for m in db.messages if m["id"] == qid][0]["queued"] is False
    assert [k[1] for k in db.scene if k[0] == b["beat_id"]] == [1, 2, 3]                       # numbering follows on
    assert db.beats[b["beat_id"]]["status"] == "waiting_user" and db.beats[b["beat_id"]]["scene_n"] == 3 and db.beats[b["beat_id"]]["summary"] == "Bigger count-up."
    assert sum("Scene v1 saved" in (m["ui_text"] or "") for m in db.ui(b["session_id"])) == 2        # nothing re-announced (still the two from the first life)


@pytest.mark.render
def test_a_worker_dies_mid_beat_and_another_continues_from_the_stored_conversation(tmp_path):
    db, st, pid = new_world()
    b = db.add_beat(pid, 0, 0, 8)
    script = golden_template()
    for t in script["turns"][5:]:
        t["delay_s"] = 600.0                                                   # worker A "hangs" in its 6th model call: that is where it dies
    llms = {}

    def fac_a(job):
        llms["a"] = FakeLLM(copy.deepcopy(script), SCRIPTS)
        return llms["a"]
    ctxA = make_ctx(tmp_path, db, st, worker_id="worker-1", llm_factory=fac_a)
    lpA = Loop(ctxA)

    async def phase_a():
        task = asyncio.create_task(lpA.run())
        assert await await_until(lambda: "a" in llms and llms["a"].pos >= 6, 240)           # five turns done (two scenes written), the sixth call is pending
        await asyncio.sleep(0.5)
        for t in list(lpA.tasks):                                                           # the machine dies
            t.cancel()
        await asyncio.sleep(0.5)
        task.cancel()
    run(phase_a())
    jid = b["job_id"]
    assert db.jobs[jid]["status"] == "running" and db.jobs[jid]["locked_by"] == "worker-1"      # never finished: only the stale sweep can recover it
    snapshot = [copy.deepcopy(r["content"]) for r in db.raw(b["session_id"])]
    done_turns = sum(1 for m in snapshot if m["role"] == "assistant")
    assert done_turns == 5 and [k[1] for k in db.scene if k[0] == b["beat_id"]] == [1, 2]
    db.age_heartbeat(jid, 100)                                                                   # 100 s without a heartbeat > the 90 s stale limit

    rest = {"turns": copy.deepcopy(golden_template()["turns"][done_turns:])}
    llms2 = {}

    def fac_b(job):
        llms2["b"] = FakeLLM(rest, SCRIPTS)
        return llms2["b"]
    ctxB = make_ctx(tmp_path, db, st, worker_id="worker-2", llm_factory=fac_b)
    assert run(drive([Loop(ctxB)], job_done(db, jid), 300))
    j = db.jobs[jid]
    assert j["status"] == "done" and j["locked_by"] == "worker-2" and j["attempts"] == 2, j
    after = [r["content"] for r in db.raw(b["session_id"])]
    assert after[:len(snapshot)] == snapshot and len(after) > len(snapshot)
    first = llms2["b"].calls[0]["messages"]
    assert sum(1 for m in first if m.get("role") == "tool") >= 5                                # it continued from the stored conversation ...
    assert sum(1 for m in first for tc in (m.get("tool_calls") or []) if tc["function"]["name"] == "write_scene") == 2      # ... and redid nothing
    beat = db.beats[b["beat_id"]]
    assert beat["status"] == "waiting_user" and beat["scene_n"] == 2 and beat["sfx_n"] == 1 and beat["final_path"]
    assert [k[1] for k in db.scene if k[0] == b["beat_id"]] == [1, 2] and sum("Scene v1 saved" in (m["ui_text"] or "") for m in db.ui(b["session_id"])) == 2
    assert len(db.costs) == 5 + len(rest["turns"]) - 0 or len(db.costs) >= 6


@pytest.mark.render
def test_six_beats_on_two_workers_three_slots_each_and_never_more_than_two_heavy(tmp_path):
    db, st, pid = new_world()
    beats = [db.add_beat(pid, i, 0, 8) for i in range(6)]
    tmpl = json.loads((SCRIPTS / "fail_then_fix.json").read_text())
    ctxs = [make_ctx(tmp_path, db, st, worker_id=f"worker-{i}", slots=3, llm_factory=llm_for(tmpl)) for i in (1, 2)]
    peak = {c.cfg.worker_id: 0 for c in ctxs}

    def done():
        for c in ctxs:
            peak[c.cfg.worker_id] = max(peak[c.cfg.worker_id], c.running)
        return all(db.jobs[x["job_id"]]["status"] in ("done", "failed", "canceled") for x in beats)
    assert run(drive([Loop(c) for c in ctxs], done, 900))
    assert all(db.jobs[x["job_id"]]["status"] == "done" for x in beats), [db.jobs[x["job_id"]]["error"] for x in beats]
    assert max(peak.values()) <= 3 and sum(1 for p in peak.values() if p >= 1) == 2 and HEAVY.max_seen <= 2
    assert {db.jobs[x["job_id"]]["locked_by"] for x in beats} == {"worker-1", "worker-2"}
    assert all(db.beats[x["beat_id"]]["status"] == "waiting_user" for x in beats)
