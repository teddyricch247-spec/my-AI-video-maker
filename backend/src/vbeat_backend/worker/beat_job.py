"""The `beat.run` job: hydrate a scratch directory from Supabase, run the beat, mirror everything back, finish the job.

Payload: {"beat_id", "session_id", "resume"?: bool, "model"?: str}. See backend/docs/WORKER_CONTRACT.md for every read and write.
"""
from __future__ import annotations

import asyncio
import dataclasses
import json
import logging
import shutil
import traceback
from pathlib import Path
from typing import Any

from vbeat_agent.beat import BeatRequest, continue_beat, run_beat
from vbeat_agent.config import Caps
from vbeat_agent.health import diagnose, render_text
from vbeat_agent.hydrate import rebuild_beat_dir
from vbeat_agent.redact import redact
from vbeat_agent.state import BeatPaths
from vbeat_agent.toolrun import CancelSignal, Toolbox

from .budget import SupabaseBudget
from .context import WorkerContext
from .heartbeat import Heartbeat
from .killswitch import KILL_REASON
from .mirror import DbMirror, JobWriter, clean_json
from .sink import JobSink, VersionSync, storage_uri

log = logging.getLogger("vbeat_backend.beat_job")
RENDERS_LIMIT = 52428800              # the `renders` bucket's per-file cap (Supabase free plan: 50 MB)
SESSION_STATUS = {"running": "running", "waiting_user": "waiting_user", "needs_attention": "flagged", "failed": "failed", "queued": "queued"}


class JobFailure(Exception):
    """A failure the operator can act on: `code` is stored as the beat's status_reason, `message` says what to do."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


def _word_id(v: Any) -> int | str:
    s = str(v)
    return int(s) if s.lstrip("-").isdigit() else s


def _neighbour(row: dict | None) -> dict | None:
    return {"title": row.get("title") or "", "summary": row.get("summary") or ""} if row else None


def build_request(ctx: WorkerContext, c: dict[str, Any], model: str, beat_dir: Path, transcript: Path, media: dict[str, Path]) -> BeatRequest:
    b, caps = c["beat"], ctx.cache.caps()
    nb = {k: _neighbour(c[k]) for k in ("prev", "next") if c.get(k)}
    return BeatRequest(beat_dir=beat_dir, transcript=transcript, from_word=_word_id(b["word_from"]), to_word=_word_id(b["word_to"]), fps=int(b.get("fps") or 30),
                       width=int(b.get("width") or 1920), height=int(b.get("height") or 1080), idx=int(b.get("idx") or 0), title=b.get("title") or "",
                       direction=b.get("direction") or "", mode=b.get("mode") or "technical", media=media,
                       sfx_enabled=bool(b.get("sfx_enabled", True)), bible=b.get("bible") or None, neighbours=nb or None, model=model,
                       caps=Caps(max_steps=int(caps["max_steps"]), max_minutes=float(caps["max_minutes"]), max_usd=float(caps["beat_usd"])))


def public_request(req: BeatRequest) -> dict[str, Any]:
    d = req.to_dict()
    for k in ("beat_dir", "transcript", "media"):
        d.pop(k, None)
    return d


async def _t(fn: Any, *a: Any, **k: Any) -> Any:
    return await asyncio.to_thread(fn, *a, **k)


async def run_beat_job(ctx: WorkerContext, job: dict[str, Any]) -> None:
    job_id, wid = int(job["id"]), ctx.cfg.worker_id
    payload = job.get("payload") or {}
    cancel = asyncio.Event()
    ctx.active_cancels.add(cancel)
    hb = Heartbeat(ctx.db, job_id, wid, cancel, ctx.cfg.heartbeat_s).start()      # first thing: hydrating can take a while
    scratch = ctx.cfg.work_dir / f"job-{job_id}"
    st: dict[str, Any] = {"writer": None, "beat_dir": None, "session_id": payload.get("session_id"), "beat_id": payload.get("beat_id")}
    try:
        await _execute(ctx, job, payload, cancel, hb, scratch, st)
    except JobFailure as jf:
        await _record_failure(ctx, job_id, hb, st, jf.code, jf.message, debug=None)
    except Exception as exc:  # noqa: BLE001 - never leave a job running
        log.exception("job %s crashed", job_id)
        debug = None
        try:
            bd = st.get("beat_dir")
            debug = render_text(diagnose(bd, ctx.runner_settings)) if bd and Path(bd).exists() else None
        except Exception:  # noqa: BLE001
            debug = None
        debug = redact((debug or "") + "\n\n" + traceback.format_exc())[-6000:]
        await _record_failure(ctx, job_id, hb, st, "internal_error", f"{type(exc).__name__}: {exc}", debug=debug)
    finally:
        await hb.stop()
        w = st.get("writer")
        if w is not None:
            await _t(w.close, 15.0)
        ctx.active_cancels.discard(cancel)
        shutil.rmtree(scratch, ignore_errors=True)


async def _record_failure(ctx: WorkerContext, job_id: int, hb: Heartbeat, st: dict, code: str, message: str, *, debug: str | None) -> None:
    db, wid = ctx.db, ctx.cfg.worker_id
    message = redact(message)[:1500]
    if not hb.lock_lost:
        try:
            if st.get("beat_id"):
                await _t(db.update_beat, st["beat_id"], status="failed", status_reason=code)
            if st.get("session_id"):
                patch: dict[str, Any] = {"error": {"code": code, "message": message}}
                if debug:
                    patch["debug"] = debug
                await _t(db.merge_session_state, st["session_id"], patch)
                await _t(db.update_session, st["session_id"], status="failed")
        except Exception:  # noqa: BLE001
            log.exception("job %s: could not record the failure on the beat", job_id)
    try:
        await _t(db.finish_job, job_id, wid, "failed", {"status": "failed", "status_reason": code}, f"{code}: {message}")
    except Exception:  # noqa: BLE001
        log.exception("job %s: could not finish the job; the stale sweep will pick it up", job_id)


async def _execute(ctx: WorkerContext, job: dict, payload: dict, cancel: asyncio.Event, hb: Heartbeat, scratch: Path, st: dict) -> None:
    db, storage, cache, cfg = ctx.db, ctx.storage, ctx.cache, ctx.cfg
    job_id = int(job["id"])
    beat_id = payload.get("beat_id")
    if not beat_id:
        raise JobFailure("bad_payload", "the beat.run job has no beat_id")
    c = await _t(db.beat_context, beat_id)
    if not c:
        raise JobFailure("beat_not_found", f"beat {beat_id} does not exist")
    beat = c["beat"]
    project_id = str(beat["project_id"])
    session_id = payload.get("session_id") or (str(beat["session_id"]) if beat.get("session_id") else None)
    if not session_id:
        raise JobFailure("no_session", f"beat {beat_id} has no session")
    st.update(session_id=session_id, beat_id=beat_id)

    if cache.kill_reason():
        await _killed(ctx, job_id, beat_id, session_id)
        return
    model = payload.get("model") or cache.beat_model()
    if not model:
        raise JobFailure("no_model", "choose a beat model in Settings (settings.models.beat is empty).")
    if c["transcript"] is None:
        raise JobFailure("no_transcript", "this project has no transcript row; upload the transcript first.")

    # ---- hydrate -------------------------------------------------------------------------------------------------------
    scratch.mkdir(parents=True, exist_ok=True)
    beat_dir = scratch / "beat"
    st["beat_dir"] = beat_dir
    transcript = scratch / "transcript_raw.json"
    transcript.write_text(json.dumps(c["transcript"], ensure_ascii=False), encoding="utf-8")
    media: dict[str, Path] = {}
    for m in c["media"]:
        dest = scratch / "media" / Path(m["filename"]).name
        try:
            await _t(storage.download, "uploads", m["storage_path"], dest)
        except Exception as exc:  # noqa: BLE001
            raise JobFailure("media_download_failed", f"could not fetch media {m['filename']!r} from Storage ({redact(str(exc))[:200]}).") from exc
        media[m["filename"]] = dest
    req = build_request(ctx, c, model, beat_dir, transcript, media)
    caps = cache.caps()
    rs = dataclasses.replace(ctx.runner_settings, beat_model=model, max_usd_per_beat=float(caps["beat_usd"]), sfx_peak_dbfs=float(cache.get("sfx_peak_dbfs", -6.0)))

    sess, raw, queued = await asyncio.gather(_t(db.session_row, session_id), _t(db.raw_messages, session_id), _t(db.queued_user_messages, session_id))
    scenes, sfxs = await asyncio.gather(_t(db.scene_versions, beat_id), _t(db.sfx_versions, beat_id))
    have_history = bool(raw)
    known: dict[tuple[str, int], str] = {}
    if have_history:
        rebuild_beat_dir(beat_dir, request=req.to_dict(), state=((sess or {}).get("state") or {}).get("runner") or {}, messages=[r["content"] for r in raw],
                         scene_versions=[{"n": r["n"], "source": r["code"], "report": r["checks"], "created_by": r.get("created_by"), "created_at": r.get("created_at")} for r in scenes],
                         sfx_versions=[{"n": r["n"], "source": r["code"], "report": r["checks"]} for r in sfxs])
        ing = await Toolbox(BeatPaths(beat_dir), req, rs, CancelSignal.wrap(cancel)).ingest()      # continue_beat does not ingest; it needs transcript.json
        if ing.returncode != 0 or not BeatPaths(beat_dir).transcript.exists():
            raise JobFailure("transcript_rejected", "the runner's ingest rejected this project's transcript: " + redact(ing.stderr_tail or str(ing.env))[:600])
        for r in scenes:
            known[("scene", r["n"])] = VersionSync.fingerprint(r["code"], r["checks"]) + "|None|None|None"
        for r in sfxs:
            known[("cue", r["n"])] = VersionSync.fingerprint(r["code"], r["checks"]) + "|None|None|None"

    # ---- wire the run to Supabase ----------------------------------------------------------------------------------------------
    writer = JobWriter(f"job{job_id}", guard=hb.wait_fresh)
    st["writer"] = writer
    budget = SupabaseBudget(db, cache, project_id=project_id, session_id=session_id, tz=cfg.ledger_tz)
    texts = [q["text"] for q in queued if (q.get("text") or "").strip()]
    mirror = DbMirror(db, writer, session_id=session_id, beat_id=beat_id, base_raw_count=len(raw), request_public=public_request(req),
                      pending_queue_ids=[q["id"] for q in queued] if have_history else [])
    versions = VersionSync(db, storage, beat_dir, project_id=project_id, beat_id=beat_id, known=known)
    sink = JobSink(writer, db, storage, versions, budget, session_id=session_id, beat_dir=beat_dir)
    await _t(db.update_beat, beat_id, status="running", status_reason=None)
    await _t(db.update_session, session_id, status="running", model=model)
    llm = ctx.llm_factory(job) if ctx.llm_factory else None

    if have_history:
        res = await continue_beat(beat_dir, "\n\n".join(texts), sink, cancel, req.caps, llm=llm, settings=rs, ledger=budget, mirror=mirror)
    else:
        res = await run_beat(req, sink, cancel, llm=llm, settings=rs, ledger=budget, mirror=mirror)
    budget.flush_unrecorded()
    writer.submit(versions.sync, key="versions")

    # ---- outcome --------------------------------------------------------------------------------------------------------------
    if hb.lock_lost:
        writer.drop()                                  # another worker owns this job now: write nothing more
        log.warning("job %s: lock lost; leaving the beat to its new owner", job_id)
        return
    if ctx.stopping.is_set() and res.status == "cancelled" and hb.reason is None:
        await _t(writer.flush, 20.0)                   # SIGTERM: state is saved; the stale sweep requeues the job for another worker
        log.info("job %s: worker shutting down; the job will be requeued by the stale sweep", job_id)
        return
    flushed = await _t(writer.flush, 180.0)
    result = res.to_dict()
    result["unrecorded_cost_usd"] = round(sum(r["usd"] for r in budget.unrecorded), 6)
    result["write_errors"] = writer.errors[:5]
    if not flushed:
        result["write_errors"].append("some writes were still pending after 180 s")

    if res.status == "cancelled":
        if hb.reason == "cancel_requested":
            await _t(db.finish_job, job_id, cfg.worker_id, "canceled", result, "cancel requested")
            return
        if res.status_reason == "kill_switch" or cache.kill_reason():
            await _killed(ctx, job_id, beat_id, session_id, result)
            return

    beat_status, reason = res.status, res.status_reason
    final_path = final_bytes = None
    if res.status == "waiting_user" and res.final_video and Path(res.final_video).exists():
        size = Path(res.final_video).stat().st_size
        if size > RENDERS_LIMIT:
            beat_status, reason = "needs_attention", f"final_too_large: final.mp4 is {size / 1048576:.1f} MB, the renders bucket takes at most 50 MB"
        else:
            final_path = f"{project_id}/{beat_id}/final.mp4"
            await _t(storage.upload, "renders", final_path, Path(res.final_video), "video/mp4")
            final_bytes = size
    result["final_video"] = storage_uri("renders", final_path) if final_path else None
    if beat_status == "cancelled":
        beat_status = "failed"
    update: dict[str, Any] = {"status": beat_status, "status_reason": reason, "summary": res.summary, "scene_n": res.scene_n, "sfx_n": res.sfx_n}
    if final_path:
        update.update(final_path=final_path, final_bytes=final_bytes)
    await _t(db.update_beat, beat_id, **update)
    await _t(db.merge_session_state, session_id, {"result": clean_json(result), "explanation": clean_json(res.explanation)}, steps=res.steps)
    await _t(db.update_session, session_id, status=SESSION_STATUS.get(beat_status, "flagged"))

    job_status = {"waiting_user": "done", "needs_attention": "done", "failed": "failed", "cancelled": "canceled"}.get(res.status, "done")
    error = None
    if job_status == "failed" and res.explanation:
        e = res.explanation
        error = redact(f"{e.get('code')}: {e.get('what')} Why: {e.get('why')} Fix: {e.get('fix')}")[:1500]
    elif job_status == "failed":
        error = f"{res.status_reason}"
    await _t(db.finish_job, job_id, cfg.worker_id, job_status, clean_json(result), error)


async def _killed(ctx: WorkerContext, job_id: int, beat_id: str, session_id: str, result: dict | None = None) -> None:
    """The kill switch stopped this run: the beat goes back to the queue, the job is finished canceled (nothing is lost; the state is saved)."""
    await _t(ctx.db.update_beat, beat_id, status="queued", status_reason=KILL_REASON)
    await _t(ctx.db.update_session, session_id, status="queued")
    await _t(ctx.db.finish_job, job_id, ctx.cfg.worker_id, "canceled", clean_json(result or {"status": "cancelled", "status_reason": "kill_switch"}), KILL_REASON)
