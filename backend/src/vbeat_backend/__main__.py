"""python -m vbeat_backend <command>

    worker                       run a worker (reads the environment; see backend/deploy/env.example)
    seed-example [--beats N] [--model M]
                                 create a project named __test__<time> with the example transcript, N beats, their sessions and beat.run jobs
    job-status                   queue depth, running jobs and their workers, last errors, spend today, workers
    cleanup-test-data            delete every __test__ project, its rows and its Storage objects
    diagnose-beat <beat_id>      what the database knows about a beat + the runner's diagnose of the rebuilt directory (paste this to your AI)
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from .config import ConfigError, load_config
from .db import PgDb
from .storage import Storage

TEST_PREFIX = "__test__"


def _json(obj: Any) -> str:
    return json.dumps(obj, indent=2, default=str, ensure_ascii=False)


def _connect(cfg: Any) -> PgDb:
    return PgDb(cfg.database_url).open()


def example_spans(words: list, n: int) -> list[tuple[int, int]]:
    """Word spans for the seeded beats. The example transcript is short (13 words) and the example scene needs a few sentences of it, so every
    beat gets a span of at least 9 words, clipped to the transcript; beats beyond the number of distinct spans reuse them."""
    last = max(0, len(words) - 1)
    return [(0, min(8, last)), (min(4, last), min(12, last))]


def cmd_seed(cfg: Any, args: argparse.Namespace) -> int:
    from vbeat_agent.config import repo_root
    db = _connect(cfg)
    try:
        tr = json.loads((repo_root() / "examples" / "transcript.json").read_text(encoding="utf-8"))
        words = tr["words"] if isinstance(tr, dict) else tr
        name = f"{TEST_PREFIX}{time.strftime('%Y%m%d-%H%M%S')}"
        out = db.create_test_project(name, tr, args.beats, 30, 1280, 720, example_spans(words, args.beats), args.model)
        print(_json({"project": name, **out, "next": "start a worker (python -m vbeat_backend worker) and watch: python -m vbeat_backend job-status"}))
        return 0
    finally:
        db.close()


def cmd_status(cfg: Any, args: argparse.Namespace) -> int:
    db = _connect(cfg)
    try:
        print(_json(db.job_status(cfg.ledger_tz)))
        return 0
    finally:
        db.close()


def cmd_cleanup(cfg: Any, args: argparse.Namespace) -> int:
    db = _connect(cfg)
    st = Storage(cfg.supabase_url, cfg.service_key)
    try:
        report = []
        for p in db.test_projects():
            pid = str(p["id"])
            removed = {b: st.delete_prefix(b, pid) for b in ("previews", "renders", "uploads")}
            db.delete_project(pid)
            report.append({"project": p["name"], "id": pid, "storage_objects_removed": removed})
        left = db.test_projects()
        print(_json({"deleted": report, "test_projects_left": len(left)}))
        return 0 if not left else 1
    finally:
        db.close()


def cmd_diagnose(cfg: Any, args: argparse.Namespace) -> int:
    from vbeat_agent.config import load_settings
    from vbeat_agent.health import diagnose, render_text
    from vbeat_agent.hydrate import rebuild_beat_dir
    db = _connect(cfg)
    try:
        c = db.beat_context(args.beat_id)
        if not c:
            print(f"no beat {args.beat_id}")
            return 1
        b = c["beat"]
        sess = db.session_row(str(b["session_id"])) if b.get("session_id") else None
        jobs = db.rows("select id, status, locked_by, attempts, left(coalesce(error,''),400) as error, finished_at from public.jobs where payload->>'beat_id' = %s order by id desc limit 5", (args.beat_id,))
        state = (sess or {}).get("state") or {}
        print(_json({"beat": {k: b[k] for k in ("id", "idx", "title", "status", "scene_n", "sfx_n")}, "session": {k: (sess or {}).get(k) for k in ("status", "model", "steps", "cost_usd")},
                     "jobs": jobs, "error": state.get("error"), "explanation": state.get("explanation"), "result": state.get("result")}))
        if state.get("debug"):
            print("\n--- stored debug (from the failed run) ---\n" + str(state["debug"]))
        if sess:
            raw = db.raw_messages(str(sess["id"]))
            with tempfile.TemporaryDirectory(prefix="diag-") as tmp:
                rebuild_beat_dir(Path(tmp) / "beat", request={"beat_dir": "", "transcript": "", "from_word": b["word_from"], "to_word": b["word_to"]}, state=state.get("runner") or {},
                                 messages=[r["content"] for r in raw],
                                 scene_versions=[{"n": r["n"], "source": r["code"], "report": r["checks"]} for r in db.scene_versions(args.beat_id)],
                                 sfx_versions=[{"n": r["n"], "source": r["code"], "report": r["checks"]} for r in db.sfx_versions(args.beat_id)])
                print("\n--- runner diagnose of the rebuilt beat ---\n" + render_text(diagnose(Path(tmp) / "beat", load_settings())))
        return 0
    finally:
        db.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m vbeat_backend", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("worker")
    s = sub.add_parser("seed-example")
    s.add_argument("--beats", type=int, default=3)
    s.add_argument("--model", default=None)
    sub.add_parser("job-status")
    sub.add_parser("cleanup-test-data")
    d = sub.add_parser("diagnose-beat")
    d.add_argument("beat_id")
    args = ap.parse_args(argv)
    try:
        if args.cmd == "worker":
            from .worker.main import main_worker
            main_worker()
            return 0
        cfg = load_config()
        return {"seed-example": cmd_seed, "job-status": cmd_status, "cleanup-test-data": cmd_cleanup, "diagnose-beat": cmd_diagnose}[args.cmd](cfg, args)
    except ConfigError as exc:
        print(f"CONFIG PROBLEM: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
