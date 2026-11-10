"""The `export.build` job: payload {"export_id"}. Downloads the chosen beats' final.mp4 from `renders`, zips them with a manifest, uploads both
to `renders` and fills in the `exports` row. Nothing is re-rendered."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import shutil
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from vbeat_agent.redact import redact

from .beat_job import RENDERS_LIMIT, _t
from .context import WorkerContext
from .heartbeat import Heartbeat

log = logging.getLogger("vbeat_backend.export_job")
KEEP_DAYS = 7


def _slug(text: str) -> str:
    return re.sub(r"[^a-zA-Z0-9]+", "-", text or "").strip("-").lower()[:40] or "beat"


def _sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


async def run_export_job(ctx: WorkerContext, job: dict[str, Any]) -> None:
    db, storage, wid = ctx.db, ctx.storage, ctx.cfg.worker_id
    job_id = int(job["id"])
    export_id = (job.get("payload") or {}).get("export_id")
    cancel = asyncio.Event()
    ctx.active_cancels.add(cancel)
    hb = Heartbeat(db, job_id, wid, cancel, ctx.cfg.heartbeat_s).start()
    scratch = ctx.cfg.work_dir / f"job-{job_id}"
    try:
        try:
            if not export_id:
                raise ValueError("the export.build job has no export_id")
            row = await _t(db.export_row, export_id)
            if not row:
                raise ValueError(f"export {export_id} does not exist")
            ids = [str(i) for i in (row.get("beat_ids") or [])]
            if not ids:
                raise ValueError("this export lists no beats")
            beats = await _t(db.beats_by_ids, ids)
            missing = [i for i in ids if i not in {str(b["id"]) for b in beats}]
            if missing:
                raise ValueError(f"beats not found: {', '.join(missing[:5])}")
            unrendered = [f"#{b['idx']} {b['title']!r}" for b in beats if not b.get("final_path")]
            if unrendered:
                raise ValueError("these beats have no final video yet: " + ", ".join(unrendered[:8]))
            project_id = str(row["project_id"])
            await _t(db.update_export, export_id, status="running", progress_done=0, progress_total=len(beats), error=None)
            files_dir = scratch / "files"
            files_dir.mkdir(parents=True, exist_ok=True)
            entries: list[dict[str, Any]] = []
            for i, b in enumerate(beats):
                if cancel.is_set() or ctx.stopping.is_set():
                    raise asyncio.CancelledError()
                name = f"{int(b['idx']):02d}_{_slug(b['title'])}.mp4"
                dest = files_dir / name
                await _t(storage.download, "renders", b["final_path"], dest)
                entries.append({"name": name, "beat_id": str(b["id"]), "idx": b["idx"], "title": b["title"], "bytes": dest.stat().st_size, "sha256": _sha256(dest)})
                await _t(db.update_export, export_id, progress_done=i + 1)
            zip_path = scratch / "export.zip"
            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_STORED) as z:       # mp4 is already compressed
                for e in entries:
                    z.write(files_dir / e["name"], e["name"])
                manifest = {"export_id": str(export_id), "project_id": project_id, "created_at": datetime.now(timezone.utc).isoformat(), "files": entries}
                z.writestr("manifest.json", json.dumps(manifest, indent=2))
            size = zip_path.stat().st_size
            if size > RENDERS_LIMIT:
                raise ValueError(f"the zip is {size / 1048576:.1f} MB but the renders bucket takes at most 50 MB per file (Supabase free plan). Export fewer beats at a time, or raise the bucket limit on a paid plan.")
            base = f"{project_id}/exports/{export_id}"
            await _t(storage.upload, "renders", f"{base}/export.zip", zip_path, "application/zip")
            await _t(storage.upload, "renders", f"{base}/manifest.json", json.dumps(manifest, indent=2).encode(), "application/json")
            expires = (datetime.now(timezone.utc) + timedelta(days=KEEP_DAYS)).isoformat()
            await _t(db.update_export, export_id, status="done", progress_done=len(beats), files=entries, zip_path=f"{base}/export.zip",
                     manifest_path=f"{base}/manifest.json", expires_at=expires)
            result = {"export_id": str(export_id), "files": len(entries), "zip_bytes": size}
            if not hb.lock_lost:
                await _t(db.finish_job, job_id, wid, "done", result, None)
        except asyncio.CancelledError:
            if ctx.stopping.is_set() and hb.reason is None:
                log.info("export job %s: worker shutting down; the stale sweep will requeue it", job_id)
            elif not hb.lock_lost:
                await _t(db.finish_job, job_id, wid, "canceled", {"export_id": str(export_id)}, "cancel requested")
        except Exception as exc:  # noqa: BLE001
            msg = redact(f"{type(exc).__name__}: {exc}")[:1000]
            log.exception("export job %s failed", job_id)
            if not hb.lock_lost:
                if export_id:
                    try:
                        await _t(db.update_export, export_id, status="failed", error=msg)
                    except Exception:  # noqa: BLE001
                        log.exception("could not mark export %s failed", export_id)
                await _t(db.finish_job, job_id, wid, "failed", {"export_id": str(export_id) if export_id else None}, msg)
    finally:
        await hb.stop()
        ctx.active_cancels.discard(cancel)
        shutil.rmtree(scratch, ignore_errors=True)
