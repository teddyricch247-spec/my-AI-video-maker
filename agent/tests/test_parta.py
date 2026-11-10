"""Part A of the worker work: kill-switch provider (A1), injectable ledger (A2), mirror (A3), hydrate / dump (A4), preflight (A5).
Pure tests first (fast, no Chromium); the round-trip at the end runs real tools with the scripted model and is marked `render`."""
import json
import os
from pathlib import Path

import pytest
from conftest import EXAMPLE_TRANSCRIPT, SCRIPTS, run
from fake_llm import FakeLLM

from vbeat_agent import killswitch
from vbeat_agent.beat import BeatRequest, _guard_failure, _resolve_ledger, continue_beat, run_beat
from vbeat_agent.config import Caps, Settings
from vbeat_agent.events import ListSink
from vbeat_agent.hydrate import read_version_bundle, rebuild_beat_dir
from vbeat_agent.mirror import SafeMirror
from vbeat_agent.state import BeatPaths, ConversationStore, StateStore, VersionStore


# ---- A1: kill-switch provider ---------------------------------------------------------------------------------------------
def test_provider_is_consulted_last_and_can_be_removed(_isolated_state, monkeypatch):
    assert killswitch.engaged() is None and not killswitch.has_provider()
    killswitch.register_provider(lambda: "stopped from the database")
    assert killswitch.engaged() == "stopped from the database"
    killswitch.engage("file wins")                                   # env, then file, then provider
    assert killswitch.engaged() == "file wins"
    killswitch.release()
    monkeypatch.setenv("VBEAT_KILL", "1")
    assert "VBEAT_KILL" in killswitch.engaged()
    monkeypatch.delenv("VBEAT_KILL")
    killswitch.register_provider(lambda: None)
    assert killswitch.engaged() is None
    killswitch.register_provider(None)
    assert not killswitch.has_provider()


def test_a_broken_provider_does_not_halt_runs(_isolated_state):
    def boom():
        raise RuntimeError("db down")
    killswitch.register_provider(boom)
    assert killswitch.engaged() is None


def test_cancel_signal_sees_the_provider(_isolated_state):
    from vbeat_agent.toolrun import CancelSignal
    flag = {"on": False}
    killswitch.register_provider(lambda: "provider says stop" if flag["on"] else None)
    sig = CancelSignal.wrap(None)
    assert not sig.is_set()
    flag["on"] = True
    assert sig.is_set()


# ---- A2: ledger injection --------------------------------------------------------------------------------------------------
class FakeLedger:
    def __init__(self, remaining, reason=None):
        self.remaining, self.binds = remaining, []
        if reason:
            self.denial_reason = reason

    def today(self):
        return {"remaining": self.remaining}

    def bind(self, beat, model):
        self.binds.append((beat, model))
        ledger = self

        class Bound:
            denial_reason = getattr(ledger, "denial_reason", "cap:daily_usd")

            def reserve(self, estimate):
                ledger.reserved = getattr(ledger, "reserved", 0) + 1
                return "tok"

            def settle(self, token, actual):
                ledger.settled = getattr(ledger, "settled", 0) + 1
        return Bound()


def test_ledger_resolution_and_guard(tmp_path, _isolated_state):
    s = Settings(state_dir=_isolated_state, api_key=None, max_usd_per_day=0.0)
    assert _resolve_ledger(s, False) is None
    assert _resolve_ledger(s, None).cap == 0.0                       # default: the disk ledger, as before
    assert _guard_failure(s, True, None) is None                     # disabled ledger: no daily guard
    assert _guard_failure(s, True, _resolve_ledger(s, None)) == ("needs_attention", "cap:daily_usd")
    assert _guard_failure(s, True, FakeLedger(0)) == ("needs_attention", "cap:daily_usd")        # no denial_reason: the daily default
    assert _guard_failure(s, True, FakeLedger(0, "cap:run_usd")) == ("needs_attention", "cap:run_usd")
    assert _guard_failure(s, True, FakeLedger(1.0)) is None


def test_run_beat_stops_on_an_injected_exhausted_ledger(tmp_path, _isolated_state):
    req = BeatRequest(beat_dir=tmp_path / "b", transcript=EXAMPLE_TRANSCRIPT, from_word=0, to_word=8, model="fake/model")
    llm = FakeLLM({"turns": []})
    res = run(run_beat(req, llm=llm, settings=Settings(state_dir=_isolated_state, api_key=None), ledger=FakeLedger(0, "cap:daily_usd")))
    assert res.status == "needs_attention" and res.status_reason == "cap:daily_usd" and llm.calls == []


def test_composite_budget_names_the_injected_budget_that_refused():
    from vbeat_agent.budget import CompositeBudget

    class Deny:
        denial_reason = "cap:run_usd"
        def reserve(self, e): return None
        def settle(self, t, a): pass

    class Allow:
        denial_reason = "x"
        def reserve(self, e): return 1
        def settle(self, t, a): pass
    cb = CompositeBudget(Allow(), Deny())
    assert cb.reserve(0.1) is None and cb.denial_reason == "cap:run_usd"


# ---- A3: mirror -------------------------------------------------------------------------------------------------------------
class Rec:
    def __init__(self, fail=False):
        self.msgs, self.states, self.fail = [], [], fail

    def message(self, m):
        if self.fail:
            raise RuntimeError("mirror down")
        self.msgs.append(m)

    def state(self, st):
        if self.fail:
            raise RuntimeError("mirror down")
        self.states.append(st)


def test_state_mirror_is_throttled_but_the_final_call_always_happens():
    t = {"now": 100.0}
    rec = Rec()
    m = SafeMirror(rec, 1.0, clock=lambda: t["now"])
    m.state({"a": 1, "_run_base": {}})
    m.state({"a": 2})
    m.state({"a": 3})                                   # inside the second: held back
    assert [s["a"] for s in rec.states] == [1] and "_run_base" not in rec.states[0]
    t["now"] += 1.5
    m.state({"a": 4})
    assert [s["a"] for s in rec.states] == [1, 4]
    m.final({"a": 5})
    assert [s["a"] for s in rec.states] == [1, 4, 5]


def test_mirror_failures_are_swallowed():
    m = SafeMirror(Rec(fail=True))
    m.message({"role": "user"})
    m.state({"x": 1})
    m.final({"x": 2})


def test_hooks_fire_after_the_disk_write_and_see_redacted_data(tmp_path, monkeypatch):
    from vbeat_agent.redact import register_secret
    register_secret("sk-or-SECRETVALUE1234567890")
    paths = BeatPaths(tmp_path / "b").ensure()
    conv, state = ConversationStore(paths), StateStore(paths)
    seen = []

    def on_msg(m):
        assert paths.conversation.read_text().strip().splitlines()[-1]          # already on disk
        seen.append(m)
    conv.on_append = on_msg
    state.on_write = lambda st: seen.append(("state", st["status"]))
    conv.append({"role": "user", "content": "my key is sk-or-SECRETVALUE1234567890", "_meta": {"kind": "reviewer"}})
    state.update(status="running")
    assert "SECRETVALUE" not in json.dumps(seen) and seen[0]["_meta"] == {"kind": "reviewer"} and seen[1] == ("state", "running")
    conv.on_append = lambda m: (_ for _ in ()).throw(RuntimeError("boom"))      # a raising hook never breaks the write
    conv.append({"role": "assistant", "content": "x"})
    assert len(conv.load()) == 2


# ---- A4: hydrate / dump -------------------------------------------------------------------------------------------------------
def _fake_data(n_scene=2, n_cue=1):
    scenes = [{"n": i, "source": f"export function draw(rt,t){{/*v{i}*/}}\n", "report": {"ok": i == n_scene, "level": "full", "counts": {"error": 0 if i == n_scene else 1, "warn": 0}, "text": f"report {i}"},
               "created_by": "agent", "created_at": "2026-01-01T00:00:0%dZ" % i} for i in range(1, n_scene + 1)]
    cues = [{"n": i, "code": f"# cue {i}\n", "checks": {"ok": True, "counts": {"error": 0, "warn": 0}, "text": "", "metrics": {"peak": -7}}} for i in range(1, n_cue + 1)]
    msgs = [{"role": "system", "content": "sys"}, {"role": "user", "content": "go", "_meta": {"kind": "first"}},
            {"role": "assistant", "content": "ok", "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "get_beat_info", "arguments": "{}"}}]},
            {"role": "tool", "tool_call_id": "c1", "content": "{}", "_meta": {"name": "get_beat_info"}}]
    return scenes, cues, msgs


def test_rebuild_writes_exactly_the_runner_layout(tmp_path):
    scenes, cues, msgs = _fake_data()
    st = {"status": "waiting_user", "scene_n": 2, "sfx_n": 1, "steps": 7, "cost_usd": 0.12, "pid": 4242, "_run_base": {"steps": 1},
          "final_video": "/gone/final.mp4", "markers_n": 2, "full_ok_n": 2}
    paths = rebuild_beat_dir(tmp_path / "x", request={"beat_dir": "/old/machine/b", "transcript": "/old/t.json", "from_word": 0, "to_word": 8, "idx": 3, "model": "m"},
                             state=st, messages=msgs, scene_versions=scenes, sfx_versions=cues)
    d = tmp_path / "x"
    for f in ("agent/request.json", "agent/state.json", "agent/conversation.jsonl", "versions/scene_001.js", "versions/scene_001.check.json", "versions/scene_001.meta.json",
              "versions/scene_002.js", "versions/cue_001.py", "versions/cue_001.report.json", "versions/cue_001.meta.json", "scene.js", "cue.py"):
        assert (d / f).exists(), f
    assert json.loads(paths.request.read_text())["beat_dir"] == str(d.resolve())
    lines = [json.loads(ln) for ln in paths.conversation.read_text().splitlines()]
    assert lines == msgs and lines[1]["_meta"] == {"kind": "first"}               # _meta preserved, order preserved
    assert paths.scene.read_text() == paths.scene_version(2).read_text() and paths.cue.read_text() == "# cue 1\n"
    s = json.loads(paths.state.read_text())
    assert s["pid"] is None and "_run_base" not in s and s["final_video"] is None and s["markers_n"] is None and s["steps"] == 7 and s["scene_n"] == 2
    vs = VersionStore(paths, StateStore(paths))
    assert vs.numbers("scene") == [1, 2] and vs.numbers("cue") == [1] and vs.latest_n("scene") == 2
    assert vs.scene_report(1)["counts"]["error"] == 1 and vs.best_n("scene") == 2 and vs.cue_report(1)["metrics"] == {"peak": -7}
    assert json.loads(paths.scene_meta(1).read_text())["created_by"] == "agent"


def test_rebuild_corrects_a_lagging_state_and_handles_nothing_stored(tmp_path):
    scenes, cues, msgs = _fake_data()
    p = rebuild_beat_dir(tmp_path / "a", request={}, state={"scene_n": 9, "sfx_n": None}, messages=[], scene_versions=scenes, sfx_versions=cues)
    s = json.loads(p.state.read_text())
    assert s["scene_n"] == 2 and s["sfx_n"] == 1 and p.conversation.read_text() == ""          # state named v9, which was never stored: use the highest
    p = rebuild_beat_dir(tmp_path / "b", request={}, state={"scene_n": 3, "sfx_n": 1}, messages=[], scene_versions=[], sfx_versions=[])
    s = json.loads(p.state.read_text())
    assert s["scene_n"] is None and s["sfx_n"] is None and not p.scene.exists() and not p.cue.exists()


def test_read_version_bundle_is_the_inverse(tmp_path):
    scenes, cues, msgs = _fake_data()
    p = rebuild_beat_dir(tmp_path / "x", request={}, state={"scene_n": 2, "sfx_n": 1}, messages=msgs, scene_versions=scenes, sfx_versions=cues)
    (p.scene_strip(2)).write_bytes(b"jpg")
    (p.cue_wav(1)).write_bytes(b"wav")
    b = read_version_bundle(tmp_path / "x", "scene", 2)
    assert b["n"] == 2 and "v2" in b["source"] and b["report"]["ok"] is True and b["meta"]["n"] == 2
    assert b["strip_path"] == p.scene_strip(2) and b["wav_path"] is None and b["spectrogram_path"] is None
    c = read_version_bundle(tmp_path / "x", "cue", 1)
    assert c["source"] == "# cue 1\n" and c["report"]["metrics"] == {"peak": -7} and c["wav_path"] == p.cue_wav(1) and c["spectrogram_path"] is None and c["strip_path"] is None
    assert read_version_bundle(tmp_path / "x", "sfx", 1)["n"] == 1
    assert read_version_bundle(tmp_path / "x", "scene", 7)["source"] is None
    with pytest.raises(ValueError):
        read_version_bundle(tmp_path / "x", "video", 1)


# ---- A5: preflight -----------------------------------------------------------------------------------------------------------
def test_preflight_state_folder_warning_goes_away_with_a_provider(tmp_path, monkeypatch):
    from vbeat_agent.health import _check_state_dir
    monkeypatch.delenv("VBEAT_STATE_DIR", raising=False)
    s = Settings(state_dir=tmp_path / "state", api_key=None)
    assert any(c.id == "state_persistence" for c in _check_state_dir(s)) if hasattr(_check_state_dir(s)[0], "id") else len(_check_state_dir(s)) == 2
    killswitch.register_provider(lambda: None)
    assert len(_check_state_dir(s)) == 1
    killswitch.register_provider(None)


def test_explain_and_diagnose_are_exported():
    import vbeat_agent
    assert "explain" in vbeat_agent.__all__ and "diagnose" in vbeat_agent.__all__
    assert vbeat_agent.explain("cap:daily_usd") is not None and callable(vbeat_agent.diagnose)


# ---- A4 round trip: run, dump, rebuild into an EMPTY directory, continue ---------------------------------------------------------
def dump(beat_dir: Path) -> dict:
    """What a backend stores after a run (and reads back later): the conversation lines, the state dict and every version."""
    paths = BeatPaths(beat_dir)
    vs = VersionStore(paths, StateStore(paths))
    bundles = {k: [read_version_bundle(beat_dir, k, n) for n in vs.numbers(k)] for k in ("scene", "cue")}
    return {"request": json.loads(paths.request.read_text()), "state": json.loads(paths.state.read_text()),
            "messages": [json.loads(ln) for ln in paths.conversation.read_text().splitlines()],
            "scene_versions": [{"n": b["n"], "source": b["source"], "report": b["report"], "meta": b["meta"]} for b in bundles["scene"]],
            "sfx_versions": [{"n": b["n"], "source": b["source"], "report": b["report"], "meta": b["meta"]} for b in bundles["cue"]]}


@pytest.mark.render
def test_round_trip_through_an_empty_directory_continues_without_redoing_anything(tmp_path, _isolated_state):
    settings = Settings(state_dir=_isolated_state, api_key=None)
    rec, sink = Rec(), ListSink()
    ledger = FakeLedger(5.0)
    first = BeatRequest(beat_dir=tmp_path / "w1" / "beat", transcript=EXAMPLE_TRANSCRIPT, from_word=0, to_word=8, width=1280, height=720, idx=0,
                        title="Big number", direction="Show the revenue growth number landing on 'percent'.", model="fake/model", caps=Caps(max_steps=3))
    llm1 = FakeLLM.from_file(SCRIPTS / "golden.json")
    r1 = run(run_beat(first, sink=sink, llm=llm1, settings=settings, ledger=ledger, mirror=rec))
    assert r1.status == "needs_attention" and r1.status_reason == "cap:max_steps" and r1.scene_n == 1, r1.to_dict()
    assert ledger.binds and ledger.binds[0][1] == "fake/model" and ledger.reserved == 3 == ledger.settled   # A2: used for every model call
    d1 = tmp_path / "w1" / "beat"
    disk_lines = [json.loads(ln) for ln in (d1 / "agent" / "conversation.jsonl").read_text().splitlines()]
    assert rec.msgs == disk_lines                                                                   # A3: every message mirrored, in order, same content
    assert rec.states and rec.states[-1]["status"] == "needs_attention" and rec.states[-1]["scene_n"] == 1 and all(not k.startswith("_") for k in rec.states[-1])
    assert len(rec.states) < 40                                                                     # throttled (one state write per step would be more)

    # ---- "worker 1 died": everything below sees only the dumped data ----
    data = dump(d1)
    assert [v["n"] for v in data["scene_versions"]] == [1] and data["scene_versions"][0]["report"]
    d2 = tmp_path / "w2" / "beat"                                                                   # an EMPTY directory, as on a new machine
    assert not d2.exists()
    rebuild_beat_dir(d2, request=data["request"], state=data["state"], messages=data["messages"], scene_versions=data["scene_versions"], sfx_versions=data["sfx_versions"])
    (d2 / "transcript.json").write_text((d1 / "transcript.json").read_text())                       # the caller's job: transcript (and media)
    conv_before = (d2 / "agent" / "conversation.jsonl").read_text()

    script2 = {"turns": [{"text": "Fixing it.", "tool_calls": [{"name": "write_scene", "arguments": {"source": {"$file": "golden_scene_v2.js"}, "note": "fix"}}]}]}
    llm2 = FakeLLM(script2, SCRIPTS)
    rec2 = Rec()
    r2 = run(continue_beat(d2, "please fix the check errors", llm=llm2, settings=settings, ledger=False, mirror=rec2, caps_override=Caps(max_steps=4)))
    # the conversation continued: the model saw the whole earlier conversation (nothing redone) and the reviewer's message came last
    seen = [m for m in llm2.calls[0]["messages"]]
    assert any(m.get("role") == "tool" and "get_beat_info" in json.dumps(m) or m.get("tool_call_id") for m in seen)
    assert seen[-1]["role"] == "user" and "please fix the check errors" in seen[-1]["content"]
    assert len(seen) >= len(data["messages"])
    conv_after = (d2 / "agent" / "conversation.jsonl").read_text()
    assert conv_after.startswith(conv_before)                                                       # appended to, never rewritten
    assert rec2.msgs[0]["role"] == "user" and len(rec2.msgs) == len(conv_after.splitlines()) - len(conv_before.splitlines())   # only NEW messages are mirrored
    # version numbers follow on from the stored ones
    paths2 = BeatPaths(d2)
    vs2 = VersionStore(paths2, StateStore(paths2))
    assert vs2.numbers("scene") == [1, 2] and r2.scene_n == 2 and (d2 / "scene.js").read_text() == (SCRIPTS / "golden_scene_v2.js").read_text()
    assert r2.steps > r1.steps and r2.run_steps >= 1                                                # totals accumulate across lives
