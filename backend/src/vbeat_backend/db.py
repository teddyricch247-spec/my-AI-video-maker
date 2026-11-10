"""Database access: a small psycopg 3 pool and one method per thing the worker does. Plain dicts in, plain dicts out.

All writes go through the SQL functions that already exist (claim_job, job_heartbeat, finish_job, append_message, requeue_own_orphans,
spend_today, project_spend) or through single idempotent statements (upserts keyed by (beat_id, n)). Connect with the Supabase *session
pooler* string as the postgres role; RLS is on, and this credential never reaches a browser.
Methods are synchronous; async code calls them through asyncio.to_thread (or from its own thread).
"""
from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any, Iterable

log = logging.getLogger("vbeat_backend.db")

BEAT_COLS = {"title", "status", "status_reason", "summary", "scene_n", "sfx_n", "session_id", "final_path", "final_bytes", "priority"}
SESSION_COLS = {"status", "steps", "model", "state", "cost_usd"}
EXPORT_COLS = {"status", "progress_done", "progress_total", "error", "files", "zip_path", "manifest_path", "expires_at"}
JSON_COLS = {"state", "files"}


def _clean(v: Any) -> Any:
    return float(v) if isinstance(v, Decimal) else v


class PgDb:
    def __init__(self, url: str, *, max_size: int = 6, statement_timeout_ms: int = 15000):
        self.url, self.max_size, self.timeout_ms = url, max_size, statement_timeout_ms
        self._pool: Any = None

    # ---- plumbing ----------------------------------------------------------------------------------------------------
    def open(self) -> "PgDb":
        from psycopg.rows import dict_row
        from psycopg_pool import ConnectionPool

        def configure(conn: Any) -> None:
            conn.execute(f"set statement_timeout = {int(self.timeout_ms)}")
            conn.execute("set application_name = 'vbeat-worker'")
        self._pool = ConnectionPool(self.url, min_size=1, max_size=self.max_size, open=False, configure=configure, timeout=20,
                                    kwargs={"row_factory": dict_row, "autocommit": True, "prepare_threshold": None, "connect_timeout": 10})
        self._pool.open(wait=True, timeout=30)
        return self

    def close(self) -> None:
        if self._pool is not None:
            self._pool.close()
            self._pool = None

    @staticmethod
    def _adapt(v: Any) -> Any:
        from psycopg.types.json import Jsonb
        return Jsonb(v) if isinstance(v, (dict, list)) else v

    def rows(self, sql: str, params: Iterable[Any] = ()) -> list[dict[str, Any]]:
        with self._pool.connection() as conn:
            cur = conn.execute(sql, [self._adapt(p) for p in params])
            return [{k: _clean(v) for k, v in r.items()} for r in cur.fetchall()] if cur.description else []

    def one(self, sql: str, params: Iterable[Any] = ()) -> dict[str, Any] | None:
        r = self.rows(sql, params)
        return r[0] if r else None

    def run(self, sql: str, params: Iterable[Any] = ()) -> int:
        with self._pool.connection() as conn:
            return conn.execute(sql, [self._adapt(p) for p in params]).rowcount

    def ping(self) -> bool:
        return bool(self.one("select 1 as ok"))

    # ---- jobs --------------------------------------------------------------------------------------------------------
    def requeue_own_orphans(self, worker: str) -> int:
        return int(self.one("select public.requeue_own_orphans(%s) as n", (worker,))["n"])

    def claim_job(self, worker: str, kinds: list[str], stale: str = "90 seconds") -> dict[str, Any] | None:
        r = self.one("select * from public.claim_job(%s, %s::text[], %s::interval)", (worker, kinds, stale))
        return r if r and r.get("id") is not None else None

    def job_heartbeat(self, job_id: int, worker: str) -> bool:
        return bool(self.one("select public.job_heartbeat(%s, %s) as ok", (job_id, worker))["ok"])

    def job_row(self, job_id: int) -> dict[str, Any] | None:
        return self.one("select id, kind, status, locked_by, cancel_requested, attempts, max_attempts, project_id, payload, error from public.jobs where id=%s", (job_id,))

    def finish_job(self, job_id: int, worker: str, status: str, result: dict | None, error: str | None) -> bool:
        return bool(self.one("select public.finish_job(%s, %s, %s, %s::jsonb, %s) as ok", (job_id, worker, status, result, error))["ok"])

    def upsert_worker(self, w: dict[str, Any]) -> None:
        self.run("""insert into public.workers(id, role, url, slots, running, heavy, version, last_seen, info)
                    values (%s,%s,%s,%s,%s,%s,%s, now(), %s)
                    on conflict (id) do update set role=excluded.role, url=excluded.url, slots=excluded.slots, running=excluded.running,
                      heavy=excluded.heavy, version=excluded.version, last_seen=now(), info=excluded.info""",
                 (w["id"], w.get("role", "worker"), w.get("url"), w.get("slots"), w.get("running"), w.get("heavy"), w.get("version"), w.get("info") or {}))

    # ---- settings ----------------------------------------------------------------------------------------------------
    def settings_all(self) -> dict[str, Any]:
        return {r["key"]: r["value"] for r in self.rows("select key, value from public.settings")}

    # ---- what a beat run reads ---------------------------------------------------------------------------------------
    def beat_context(self, beat_id: str) -> dict[str, Any] | None:
        b = self.one("""select b.id, b.project_id, b.idx, b.title, b.mode, b.direction, b.beat_text, b.word_from, b.word_to, b.f0, b.f1, b.status,
                               b.session_id, b.scene_n, b.sfx_n, p.name as project_name, p.fps, p.width, p.height, p.sfx_enabled, p.bible, p.paused
                          from public.beats b join public.projects p on p.id = b.project_id where b.id = %s""", (beat_id,))
        if not b:
            return None
        prev = self.one("select title, summary from public.beats where project_id=%s and idx < %s order by idx desc limit 1", (b["project_id"], b["idx"]))
        nxt = self.one("select title, summary from public.beats where project_id=%s and idx > %s order by idx asc limit 1", (b["project_id"], b["idx"]))
        tr = self.one("select data from public.transcripts where project_id=%s", (b["project_id"],))
        media = self.rows("select filename, storage_path from public.media where project_id=%s order by created_at", (b["project_id"],))
        return {"beat": b, "prev": prev, "next": nxt, "transcript": tr["data"] if tr else None, "media": media}

    def session_row(self, session_id: str) -> dict[str, Any] | None:
        return self.one("select id, project_id, beat_id, kind, status, model, steps, cost_usd, next_seq, state from public.sessions where id=%s", (session_id,))

    def raw_messages(self, session_id: str) -> list[dict[str, Any]]:
        return self.rows("select seq, content from public.messages where session_id=%s and visible = false order by seq", (session_id,))

    def count_raw_messages(self, session_id: str) -> int:
        return int(self.one("select count(*) as n from public.messages where session_id=%s and visible = false", (session_id,))["n"])

    def queued_user_messages(self, session_id: str) -> list[dict[str, Any]]:
        return self.rows("""select id, seq, coalesce(ui_text, content->>'text', '') as text from public.messages
                             where session_id=%s and queued and role='user' and visible order by seq""", (session_id,))

    def clear_queued(self, ids: list[int]) -> None:
        if ids:
            self.run("update public.messages set queued = false where id = any(%s)", (ids,))

    def scene_versions(self, beat_id: str) -> list[dict[str, Any]]:
        return self.rows("select n, code, checks, strip_path, created_by, created_at from public.scene_versions where beat_id=%s order by n", (beat_id,))

    def sfx_versions(self, beat_id: str) -> list[dict[str, Any]]:
        return self.rows("select n, code, checks, wav_path, spectrogram_path, created_at from public.sfx_versions where beat_id=%s order by n", (beat_id,))

    # ---- what a beat run writes --------------------------------------------------------------------------------------
    def append_message(self, session_id: str, role: str, content: Any, *, ui_text: str | None = None, ui_steps: list | None = None, queued: bool = False,
                       tool_call_id: str | None = None, usage: dict | None = None, visible: bool = True) -> int:
        r = self.one("select public.append_message(%s, %s, %s::jsonb, %s, %s::jsonb, %s, %s, %s::jsonb, %s) as id",
                     (session_id, role, content, ui_text, ui_steps if ui_steps is not None else [], queued, tool_call_id, usage, visible))
        return int(r["id"])

    def merge_session_state(self, session_id: str, patch: dict[str, Any], *, steps: int | None = None, model: str | None = None) -> None:
        """sessions.state = state || patch (top-level keys of the patch replace; others, e.g. `debug`, are kept)."""
        self.run("""update public.sessions set state = coalesce(state, '{}'::jsonb) || %s::jsonb, steps = coalesce(%s, steps), model = coalesce(%s, model)
                     where id = %s""", (patch, steps, model, session_id))

    def update_message_ui(self, message_id: int, ui_text: str, ui_steps: list) -> None:
        self.run("update public.messages set ui_text=%s, ui_steps=%s::jsonb, content=%s::jsonb where id=%s",
                 (ui_text, ui_steps, {"text": ui_text, "steps": ui_steps}, message_id))

    def upsert_scene_version(self, beat_id: str, n: int, code: str, checks: dict | None, strip_path: str | None, created_by: str = "agent") -> None:
        self.run("""insert into public.scene_versions(beat_id, n, code, checks, strip_path, created_by) values (%s,%s,%s,%s::jsonb,%s,%s)
                    on conflict (beat_id, n) do update set code=excluded.code, checks=excluded.checks,
                      strip_path=coalesce(excluded.strip_path, public.scene_versions.strip_path)""", (beat_id, n, code, checks, strip_path, created_by))

    def upsert_sfx_version(self, beat_id: str, n: int, code: str, checks: dict | None, wav_path: str | None, spectrogram_path: str | None) -> None:
        self.run("""insert into public.sfx_versions(beat_id, n, code, checks, wav_path, spectrogram_path) values (%s,%s,%s,%s::jsonb,%s,%s)
                    on conflict (beat_id, n) do update set code=excluded.code, checks=excluded.checks,
                      wav_path=coalesce(excluded.wav_path, public.sfx_versions.wav_path),
                      spectrogram_path=coalesce(excluded.spectrogram_path, public.sfx_versions.spectrogram_path)""",
                 (beat_id, n, code, checks, wav_path, spectrogram_path))

    def update_beat(self, beat_id: str, **cols: Any) -> None:
        self._update("public.beats", BEAT_COLS, beat_id, cols)

    def update_session(self, session_id: str, **cols: Any) -> None:
        self._update("public.sessions", SESSION_COLS, session_id, cols)

    def update_export(self, export_id: str, **cols: Any) -> None:
        self._update("public.exports", EXPORT_COLS, export_id, cols)

    def _update(self, table: str, allowed: set[str], row_id: Any, cols: dict[str, Any]) -> None:
        bad = set(cols) - allowed
        if bad:
            raise ValueError(f"{table}: columns not allowed: {sorted(bad)}")
        if not cols:
            return
        sets = ", ".join(f"{k} = %s" + ("::jsonb" if k in JSON_COLS else "") for k in cols)
        self.run(f"update {table} set {sets} where id = %s", [*cols.values(), row_id])

    # ---- money -------------------------------------------------------------------------------------------------------
    def insert_cost_event(self, project_id: str, session_id: str | None, model: str, usd: float, *, kind: str = "llm", tokens_in: int | None = None,
                          tokens_out: int | None = None, tokens_cached: int | None = None) -> int:
        r = self.one("""insert into public.cost_events(project_id, session_id, model, kind, tokens_in, tokens_out, tokens_cached, usd)
                        values (%s,%s,%s,%s,%s,%s,%s,%s) returning id""", (project_id, session_id, model, kind, tokens_in, tokens_out, tokens_cached, usd))
        return int(r["id"])

    def set_cost_tokens(self, event_id: int, tokens_in: int | None, tokens_out: int | None, tokens_cached: int | None = None) -> None:
        self.run("update public.cost_events set tokens_in=%s, tokens_out=%s, tokens_cached=%s where id=%s", (tokens_in, tokens_out, tokens_cached, event_id))

    def spend_snapshot(self, tz: str, project_id: str, session_id: str | None) -> dict[str, float]:
        r = self.one("""select public.spend_today(%s) as today, public.project_spend(%s) as project,
                               coalesce((select cost_usd from public.sessions where id = %s), 0) as session""", (tz, project_id, session_id))
        return {"today": float(r["today"] or 0), "project": float(r["project"] or 0), "session": float(r["session"] or 0)}

    # ---- exports -----------------------------------------------------------------------------------------------------
    def export_row(self, export_id: str) -> dict[str, Any] | None:
        return self.one("select id, project_id, status, beat_ids, files, zip_path, manifest_path from public.exports where id=%s", (export_id,))

    def beats_by_ids(self, ids: list[str]) -> list[dict[str, Any]]:
        return self.rows("select id, project_id, idx, title, status, final_path, final_bytes from public.beats where id = any(%s::uuid[]) order by idx", (ids,))

    # ---- ops / tests -------------------------------------------------------------------------------------------------
    def job_status(self, tz: str) -> dict[str, Any]:
        return {"queued": self.rows("select kind, count(*) as n from public.jobs where status='queued' group by kind order by kind"),
                "running": self.rows("select id, kind, locked_by, attempts, now() - heartbeat_at as since_heartbeat, payload->>'beat_id' as beat_id from public.jobs where status='running' order by id"),
                "errors": self.rows("select id, kind, status, left(coalesce(error,''), 300) as error, finished_at from public.jobs where error is not null order by id desc limit 8"),
                "spend_today": float(self.one("select public.spend_today(%s) as s", (tz,))["s"] or 0),
                "workers": self.rows("select id, slots, running, heavy, version, now() - last_seen as seen_ago from public.workers order by id")}

    def test_projects(self) -> list[dict[str, Any]]:
        return self.rows("select id, name from public.projects where left(name, 8) = '__test__' order by created_at")

    def delete_project(self, project_id: str) -> None:
        self.run("delete from public.projects where id = %s", (project_id,))      # every child table cascades (beats, sessions, jobs, messages, versions, costs, ...)

    def create_test_project(self, name: str, transcript: dict, n_beats: int, fps: int, width: int, height: int, spans: list[tuple[int, int]],
                            model: str | None) -> dict[str, Any]:
        p = self.one("insert into public.projects(name, fps, width, height, status, plan_approved) values (%s,%s,%s,%s,'building',true) returning id", (name, fps, width, height))
        pid = p["id"]
        words = transcript.get("words") if isinstance(transcript, dict) else transcript
        self.run("insert into public.transcripts(project_id, format, data, word_count) values (%s,'json',%s::jsonb,%s)", (pid, transcript, len(words or [])))
        beats = []
        for i in range(n_beats):
            a, b = spans[i % len(spans)]
            beat = self.one("insert into public.beats(project_id, idx, title, direction, word_from, word_to, status, mode) values (%s,%s,%s,%s,%s,%s,'queued','technical') returning id",
                            (pid, i, f"Test beat {i}", "Show the revenue growth number landing on 'percent'.", str(a), str(b)))
            s = self.one("insert into public.sessions(project_id, kind, beat_id, status, model) values (%s,'beat',%s,'queued',%s) returning id", (pid, beat["id"], model))
            self.run("update public.beats set session_id=%s where id=%s", (s["id"], beat["id"]))
            j = self.one("insert into public.jobs(project_id, kind, payload) values (%s,'beat.run',%s::jsonb) returning id",
                         (pid, {"beat_id": str(beat["id"]), "session_id": str(s["id"]), **({"model": model} if model else {})}))
            beats.append({"beat_id": str(beat["id"]), "session_id": str(s["id"]), "job_id": j["id"]})
        return {"project_id": str(pid), "beats": beats}
