"""PgDb has not been run against a live connection (no credentials in the development environment). This test calls EVERY method through a recording
stub and checks the things psycopg would reject: the number of %s placeholders equals the number of parameters, no stray % characters, and
columns that are updated dynamically are whitelisted. The SQL text itself was run against the live schema (see WORKER_CONTRACT.md §13)."""
import inspect
import re

import pytest

from vbeat_backend.db import PgDb


class Cur:
    description = [("x",)]

    def fetchall(self):
        return [{"n": 1, "ok": True, "id": 1, "today": 0, "project": 0, "session": 0, "s": 0, "data": {}, "key": "k", "value": 1, "project_id": "p", "idx": 0}]
    rowcount = 1


class Conn:
    def __init__(self, log):
        self.log = log

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params=()):
        self.log.append((sql, list(params)))
        return Cur()


class Pool:
    def __init__(self, log):
        self.log = log

    def connection(self):
        return Conn(self.log)


def make():
    log = []
    db = PgDb("postgresql://x")
    db._pool = Pool(log)
    db._adapt = staticmethod(lambda v: v)                 # psycopg's Jsonb wrapper is not needed for the shape check
    return db, log


CALLS = {
    "requeue_own_orphans": ("w",), "claim_job": ("w", ["beat.run"], "90 seconds"), "job_heartbeat": (1, "w"), "job_row": (1,), "finish_job": (1, "w", "done", {"a": 1}, None),
    "upsert_worker": ({"id": "w", "slots": 3},), "settings_all": (), "beat_context": ("b",), "session_row": ("s",), "raw_messages": ("s",), "count_raw_messages": ("s",),
    "queued_user_messages": ("s",), "clear_queued": ([1, 2],), "scene_versions": ("b",), "sfx_versions": ("b",), "append_message": ("s", "user", {"a": 1}),
    "merge_session_state": ("s", {"a": 1}), "update_message_ui": (1, "t", []), "upsert_scene_version": ("b", 1, "code", {}, None), "upsert_sfx_version": ("b", 1, "code", {}, None, None),
    "update_beat": ("b",), "update_session": ("s",), "update_export": ("e",), "insert_cost_event": ("p", "s", "m", 0.1), "set_cost_tokens": (1, 2, 3), "spend_snapshot": ("UTC", "p", "s"),
    "export_row": ("e",), "beats_by_ids": (["b"],), "job_status": ("UTC",), "test_projects": (), "delete_project": ("p",), "ping": (),
}


def test_every_public_method_is_exercised_and_placeholders_match_parameters():
    public = {n for n, f in inspect.getmembers(PgDb, inspect.isfunction) if not n.startswith("_") and n not in ("open", "close", "rows", "one", "run", "create_test_project")}
    assert public <= set(CALLS), f"add {public - set(CALLS)} to CALLS"
    for name, args in CALLS.items():
        db, log = make()
        kwargs = {"update_beat": {"status": "running", "scene_n": 1}, "update_session": {"status": "running", "state": {"a": 1}}, "update_export": {"status": "done", "files": []}}.get(name, {})
        getattr(db, name)(*args, **kwargs)
        assert log, name
        for sql, params in log:
            assert len(re.findall(r"%s", sql)) == len(params), (name, sql, params)
            assert not re.search(r"%(?!s)", sql), f"{name}: stray % in SQL"


def test_create_test_project_statements():
    db, log = make()
    out = db.create_test_project("__test__x", {"words": [1, 2, 3]}, 2, 30, 1280, 720, [(0, 1), (2, 3)], "m")
    assert out["project_id"] and len(out["beats"]) == 2
    for sql, params in log:
        assert len(re.findall(r"%s", sql)) == len(params), (sql, params)
        assert not re.search(r"%(?!s)", sql)


def test_dynamic_updates_only_allow_known_columns():
    db, _ = make()
    with pytest.raises(ValueError, match="not allowed"):
        db.update_beat("b", **{"status = 1; drop table beats; --": "x"})
    with pytest.raises(ValueError):
        db.update_session("s", cost_usd2=1)
    db.update_beat("b")                                                       # nothing to set: no statement
