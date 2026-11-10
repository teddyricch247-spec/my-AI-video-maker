"""An in-memory stand-in for vbeat_backend.db.PgDb, for tests. It mirrors the semantics of the SQL the worker relies on
(claim_job: stale sweep, kill switch, paused projects, per-kind limits, attempts counted once; append_message: atomic seq; cost trigger)."""
from __future__ import annotations

import copy
import threading
import time
import uuid
from typing import Any


class FakeDb:
    def __init__(self, settings: dict | None = None):
        self.lock = threading.RLock()
        self.settings = {"beat_concurrency": 27, "caps": {"run_usd": 1.5, "daily_usd": 20, "max_steps": 30, "max_minutes": 15, "beat_usd": 0.5},
                         "kill_switch": False, "models": {"beat": "fake/model", "director": None}, "sfx_peak_dbfs": -6, **(settings or {})}
        self.projects: dict[str, dict] = {}
        self.beats: dict[str, dict] = {}
        self.sessions: dict[str, dict] = {}
        self.messages: list[dict] = []
        self.scene: dict[tuple[str, int], dict] = {}
        self.sfx: dict[tuple[str, int], dict] = {}
        self.transcripts: dict[str, Any] = {}
        self.media: list[dict] = []
        self.jobs: dict[int, dict] = {}
        self.costs: list[dict] = []
        self.exports: dict[str, dict] = {}
        self.workers: dict[str, dict] = {}
        self._job_id = 0
        self._msg_id = 0
        self.fail_next: dict[str, int] = {}         # method name -> raise this many times (simulate a database blip)
        self.calls: dict[str, int] = {}

    # ---- helpers for tests ------------------------------------------------------------------------------------------
    def _maybe_fail(self, name: str) -> None:
        self.calls[name] = self.calls.get(name, 0) + 1
        if self.fail_next.get(name, 0) > 0:
            self.fail_next[name] -= 1
            raise ConnectionError(f"simulated database failure in {name}")

    def add_project(self, name="__test__x", words=None, fps=30, width=1280, height=720, sfx_enabled=True, bible=None) -> str:
        pid = str(uuid.uuid4())
        self.projects[pid] = {"id": pid, "name": name, "fps": fps, "width": width, "height": height, "sfx_enabled": sfx_enabled, "bible": bible, "paused": False}
        if words is not None:
            self.transcripts[pid] = words
        return pid

    def add_beat(self, pid: str, idx: int, a: int, b: int, *, model_job: bool = True, title: str | None = None, extra_payload: dict | None = None) -> dict:
        bid, sid = str(uuid.uuid4()), str(uuid.uuid4())
        self.beats[bid] = {"id": bid, "project_id": pid, "idx": idx, "title": title or f"Beat {idx}", "mode": "technical", "direction": "Show the revenue growth number landing on 'percent'.",
                           "summary": None, "word_from": str(a), "word_to": str(b), "status": "queued", "status_reason": None, "session_id": sid, "scene_n": None, "sfx_n": None,
                           "final_path": None, "final_bytes": None}
        self.sessions[sid] = {"id": sid, "project_id": pid, "beat_id": bid, "kind": "beat", "status": "queued", "model": None, "steps": 0, "cost_usd": 0.0, "next_seq": 1, "state": {}}
        jid = self.add_job("beat.run", pid, {"beat_id": bid, "session_id": sid, **(extra_payload or {})}) if model_job else None
        return {"beat_id": bid, "session_id": sid, "job_id": jid}

    def add_job(self, kind: str, pid: str | None, payload: dict, *, priority: int = 0, max_attempts: int = 3) -> int:
        with self.lock:
            self._job_id += 1
            self.jobs[self._job_id] = {"id": self._job_id, "project_id": pid, "kind": kind, "payload": payload, "status": "queued", "priority": priority, "run_after": 0.0,
                                       "attempts": 0, "max_attempts": max_attempts, "locked_by": None, "locked_at": None, "heartbeat_at": None, "cancel_requested": False,
                                       "result": None, "error": None, "finished_at": None, "created_at": time.time()}
            return self._job_id

    def age_heartbeat(self, job_id: int, seconds: float) -> None:
        self.jobs[job_id]["heartbeat_at"] -= seconds

    def raw(self, sid: str) -> list[dict]:
        return [m for m in self.messages if m["session_id"] == sid and m["visible"] is False]

    def ui(self, sid: str) -> list[dict]:
        return [m for m in self.messages if m["session_id"] == sid and m["visible"] is True]

    # ---- jobs (same semantics as the migrated SQL) -----------------------------------------------------------------------
    def requeue_own_orphans(self, worker):
        with self.lock:
            n = 0
            for j in self.jobs.values():
                if j["status"] == "running" and j["locked_by"] == worker:
                    n += 1
                    if j["cancel_requested"]:
                        j.update(status="canceled", finished_at=time.time())
                    elif j["attempts"] >= j["max_attempts"]:
                        j.update(status="failed", finished_at=time.time(), error=f"worker {worker} restarted while running this job")
                    else:
                        j.update(status="queued", locked_by=None, locked_at=None, heartbeat_at=None)
            return n

    def claim_job(self, worker, kinds, stale="90 seconds"):
        self._maybe_fail("claim_job")
        with self.lock:
            limit = float(str(stale).split()[0])
            now = time.time()
            for j in self.jobs.values():
                if j["status"] == "running" and (j["heartbeat_at"] or j["locked_at"] or j["created_at"]) < now - limit:
                    if j["cancel_requested"]:
                        j.update(status="canceled", finished_at=now)
                    elif j["attempts"] >= j["max_attempts"]:
                        j.update(status="failed", finished_at=now, error=f"stale heartbeat (worker {j['locked_by']})")
                    else:
                        j.update(status="queued", locked_by=None, locked_at=None, heartbeat_at=None, error=f"stale heartbeat (worker {j['locked_by']})")
            if self.settings.get("kill_switch") in (True, "true"):
                return None
            lim = {"beat.run": self.settings.get("beat_concurrency", 27), "director.turn": self.settings.get("concurrency.director.turn", 2), "export.build": self.settings.get("concurrency.export.build", 2)}
            cands = []
            for j in self.jobs.values():
                if j["status"] != "queued" or j["run_after"] > now or j["kind"] not in kinds:
                    continue
                if j["project_id"] and self.projects.get(j["project_id"], {}).get("paused"):
                    continue
                if sum(1 for r in self.jobs.values() if r["status"] == "running" and r["kind"] == j["kind"]) >= lim.get(j["kind"], 1):
                    continue
                cands.append(j)
            if not cands:
                return None
            j = sorted(cands, key=lambda x: (-x["priority"], x["run_after"], x["id"]))[0]
            j.update(status="running", locked_by=worker, locked_at=now, heartbeat_at=now, attempts=j["attempts"] + 1)
            return copy.deepcopy(j)

    def job_heartbeat(self, job_id, worker):
        self._maybe_fail("job_heartbeat")
        with self.lock:
            j = self.jobs[job_id]
            if j["status"] != "running" or j["locked_by"] != worker:
                return False
            j["heartbeat_at"] = time.time()
            return not j["cancel_requested"]

    def job_row(self, job_id):
        with self.lock:
            return copy.deepcopy(self.jobs.get(job_id))

    def finish_job(self, job_id, worker, status, result, error):
        with self.lock:
            j = self.jobs[job_id]
            if j["status"] != "running" or j["locked_by"] != worker:
                return False
            j.update(status=status, result=result, error=error, finished_at=time.time())
            return True

    def upsert_worker(self, w):
        with self.lock:
            self.workers[w["id"]] = {**w, "last_seen": time.time()}

    def settings_all(self):
        self._maybe_fail("settings_all")
        return copy.deepcopy(self.settings)

    # ---- reads -----------------------------------------------------------------------------------------------------------------
    def beat_context(self, beat_id):
        with self.lock:
            b = self.beats.get(beat_id)
            if not b:
                return None
            p = self.projects[b["project_id"]]
            sibs = sorted((x for x in self.beats.values() if x["project_id"] == b["project_id"]), key=lambda x: x["idx"])
            prev = [x for x in sibs if x["idx"] < b["idx"]]
            nxt = [x for x in sibs if x["idx"] > b["idx"]]
            row = {**b, "project_name": p["name"], "fps": p["fps"], "width": p["width"], "height": p["height"], "sfx_enabled": p["sfx_enabled"], "bible": p["bible"], "paused": p["paused"]}
            return {"beat": row, "prev": copy.deepcopy(prev[-1]) if prev else None, "next": copy.deepcopy(nxt[0]) if nxt else None,
                    "transcript": copy.deepcopy(self.transcripts.get(b["project_id"])), "media": [m for m in self.media if m["project_id"] == b["project_id"]]}

    def session_row(self, sid):
        with self.lock:
            return copy.deepcopy(self.sessions.get(sid))

    def raw_messages(self, sid):
        with self.lock:
            return [{"seq": m["seq"], "content": copy.deepcopy(m["content"])} for m in sorted(self.raw(sid), key=lambda m: m["seq"])]

    def count_raw_messages(self, sid):
        with self.lock:
            return len(self.raw(sid))

    def queued_user_messages(self, sid):
        with self.lock:
            return [{"id": m["id"], "seq": m["seq"], "text": m["ui_text"] or (m["content"] or {}).get("text", "")} for m in self.messages
                    if m["session_id"] == sid and m["queued"] and m["role"] == "user" and m["visible"]]

    def clear_queued(self, ids):
        with self.lock:
            for m in self.messages:
                if m["id"] in ids:
                    m["queued"] = False

    def scene_versions(self, beat_id):
        with self.lock:
            return [copy.deepcopy(v) for (b, n), v in sorted(self.scene.items()) if b == beat_id]

    def sfx_versions(self, beat_id):
        with self.lock:
            return [copy.deepcopy(v) for (b, n), v in sorted(self.sfx.items()) if b == beat_id]

    # ---- writes ------------------------------------------------------------------------------------------------------------------
    def append_message(self, session_id, role, content, *, ui_text=None, ui_steps=None, queued=False, tool_call_id=None, usage=None, visible=True):
        self._maybe_fail("append_message")
        with self.lock:
            s = self.sessions[session_id]
            seq, s["next_seq"] = s["next_seq"], s["next_seq"] + 1
            self._msg_id += 1
            self.messages.append({"id": self._msg_id, "session_id": session_id, "seq": seq, "role": role, "content": copy.deepcopy(content), "ui_text": ui_text,
                                  "ui_steps": copy.deepcopy(ui_steps or []), "queued": queued, "tool_call_id": tool_call_id, "usage": usage, "visible": visible})
            return self._msg_id

    def merge_session_state(self, session_id, patch, *, steps=None, model=None):
        with self.lock:
            s = self.sessions[session_id]
            s["state"] = {**(s["state"] or {}), **copy.deepcopy(patch)}
            if steps is not None:
                s["steps"] = steps
            if model:
                s["model"] = model

    def update_message_ui(self, mid, text, steps):
        with self.lock:
            for m in self.messages:
                if m["id"] == mid:
                    m.update(ui_text=text, ui_steps=copy.deepcopy(steps), content={"text": text, "steps": copy.deepcopy(steps)})

    def upsert_scene_version(self, beat_id, n, code, checks, strip_path, created_by="agent"):
        with self.lock:
            old = self.scene.get((beat_id, n), {})
            self.scene[(beat_id, n)] = {"n": n, "code": code, "checks": copy.deepcopy(checks), "strip_path": strip_path or old.get("strip_path"),
                                        "created_by": old.get("created_by", created_by), "created_at": old.get("created_at", "2026-01-01T00:00:00Z")}

    def upsert_sfx_version(self, beat_id, n, code, checks, wav_path, spectrogram_path):
        with self.lock:
            old = self.sfx.get((beat_id, n), {})
            self.sfx[(beat_id, n)] = {"n": n, "code": code, "checks": copy.deepcopy(checks), "wav_path": wav_path or old.get("wav_path"),
                                      "spectrogram_path": spectrogram_path or old.get("spectrogram_path"), "created_at": "2026-01-01T00:00:00Z"}

    def update_beat(self, beat_id, **cols):
        with self.lock:
            self.beats[beat_id].update(cols)

    def update_session(self, sid, **cols):
        with self.lock:
            self.sessions[sid].update({k: v for k, v in cols.items() if v is not None})

    def update_export(self, eid, **cols):
        with self.lock:
            self.exports[eid].update(cols)

    def insert_cost_event(self, project_id, session_id, model, usd, *, kind="llm", tokens_in=None, tokens_out=None, tokens_cached=None):
        self._maybe_fail("insert_cost_event")
        with self.lock:
            self.costs.append({"id": len(self.costs) + 1, "project_id": project_id, "session_id": session_id, "model": model, "kind": kind, "tokens_in": tokens_in,
                               "tokens_out": tokens_out, "tokens_cached": tokens_cached, "usd": usd, "at": time.time()})
            if session_id in self.sessions:                  # the trg_cost_event_add trigger
                self.sessions[session_id]["cost_usd"] = float(self.sessions[session_id].get("cost_usd") or 0) + usd
            return len(self.costs)

    def set_cost_tokens(self, eid, tin, tout, cached=None):
        with self.lock:
            self.costs[eid - 1].update(tokens_in=tin, tokens_out=tout, tokens_cached=cached)

    def spend_snapshot(self, tz, project_id, session_id):
        self._maybe_fail("spend_snapshot")
        with self.lock:
            return {"today": sum(c["usd"] for c in self.costs), "project": sum(c["usd"] for c in self.costs if c["project_id"] == project_id),
                    "session": float((self.sessions.get(session_id) or {}).get("cost_usd") or 0)}

    def export_row(self, eid):
        return copy.deepcopy(self.exports.get(eid))

    def beats_by_ids(self, ids):
        with self.lock:
            return sorted((copy.deepcopy(self.beats[i]) for i in ids if i in self.beats), key=lambda b: b["idx"])


class FakeStorage:
    """Objects in memory: {(bucket, path): bytes}."""

    def __init__(self):
        self.objects: dict[tuple[str, str], bytes] = {}
        self.lock = threading.Lock()
        self.fail_uploads = 0

    def upload(self, bucket, path, data, content_type=None):
        if self.fail_uploads > 0:
            self.fail_uploads -= 1
            raise ConnectionError("simulated storage failure")
        body = data if isinstance(data, (bytes, bytearray)) else __import__("pathlib").Path(data).read_bytes()
        with self.lock:
            self.objects[(bucket, path)] = bytes(body)
        return len(body)

    def download(self, bucket, path, dest):
        from pathlib import Path
        with self.lock:
            body = self.objects[(bucket, path)]
        Path(dest).parent.mkdir(parents=True, exist_ok=True)
        Path(dest).write_bytes(body)
        return len(body)

    def paths(self, bucket):
        return sorted(p for b, p in self.objects if b == bucket)
