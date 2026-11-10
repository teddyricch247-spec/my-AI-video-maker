"""Beat runs: the public interface the backend calls.

    run_beat(req, sink=None, cancel=None) -> BeatResult           start a beat
    continue_beat(beat_dir, user_message, ...) -> BeatResult       reviewer feedback, an answer to ask_user, or a resume after a kill
    revert_beat(beat_dir, scene_n=None, sfx_n=None)                point scene.js / cue.py at an older version

The runner knows nothing about databases or HTTP: it reads and writes files in the beat directory and emits events
(agent/docs/EVENTS.md). `llm=`, `settings=` and `budget=` are keyword-only injection points (tests, run_beats); the CLI and the
backend normally pass none of them.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import traceback
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Literal

from vbeat_shared.envelope import Outcome

from . import killswitch
from .budget import CompositeBudget, SpendLedger
from .config import Caps, Settings, load_settings
from .context import estimate_tokens
from .errors import explain
from .events import Emitter, EventSink, FileEventSink, MultiSink, NullSink
from .mirror import Mirror, SafeMirror
from .llm_types import LLM, LLMError, ModelNotSupported
from .loop import Hooks, LoopResult, ToolOutcome, run_loop
from .prompts import build_beat_message, build_reviewer_message, build_system_prompt
from .redact import redact
from .state import (BeatBusy, BeatLock, BeatPaths, ConversationStore, StateStore, VersionStore, append_line, now_iso,
                    read_json, repair_dangling_tool_calls, write_json_atomic)
from .toolrun import HEAVY, Cancelled, CancelSignal, Toolbox
from .tools import BeatContext, build_beat_tools, finding_codes

log = logging.getLogger("vbeat_agent.beat")

Status = Literal["waiting_user", "needs_attention", "failed", "cancelled"]
PLACEHOLDER_SCENE = "export function draw(rt, t) {\n  // placeholder written by the runner so the beat spec can be generated; the agent replaces it\n}\n"


@dataclass
class BeatRequest:
    beat_dir: Path
    transcript: Path
    from_word: int | str
    to_word: int | str
    fps: int = 30
    width: int = 1920
    height: int = 1080
    idx: int = 0
    title: str = ""
    direction: str = ""
    mode: str = "technical"
    media: dict[str, Path] = field(default_factory=dict)
    sfx_enabled: bool = True
    bible: str | None = None
    neighbours: dict | None = None
    model: str = ""
    caps: Caps = field(default_factory=Caps)
    params: dict = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        for k in ("beat_dir", "transcript"):
            d[k] = str(d[k])
        d["media"] = {k: str(v) for k, v in self.media.items()}
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "BeatRequest":
        d = dict(d)
        d["beat_dir"], d["transcript"] = Path(d["beat_dir"]), Path(d["transcript"])
        d["media"] = {k: Path(v) for k, v in (d.get("media") or {}).items()}
        d["caps"] = Caps.from_dict(d.get("caps"))
        names = set(cls.__dataclass_fields__)
        return cls(**{k: v for k, v in d.items() if k in names})


@dataclass
class BeatResult:
    status: Status
    status_reason: str | None = None
    summary: str | None = None
    question: str | None = None
    scene_n: int | None = None
    sfx_n: int | None = None
    final_video: Path | None = None
    steps: int = 0                 # cumulative over the beat's life (state.json)
    cost_usd: float = 0.0          # cumulative
    wall_s: float = 0.0            # cumulative
    last_report: dict | None = None
    explanation: dict | None = None     # {code, what, why, fix}: plain language, None for a normal finish
    run_steps: int = 0             # this call only
    run_cost_usd: float = 0.0
    run_wall_s: float = 0.0
    unknown_cost_calls: int = 0

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["final_video"] = str(self.final_video) if self.final_video else None
        return d


class TranscriptSink:
    """agent/transcript.md, written incrementally from the events: the human-readable log of the run."""

    def __init__(self, path: Path):
        self.path = path

    def emit(self, ev: dict[str, Any]) -> None:
        t, step = ev.get("type"), ev.get("step")
        if t == "run_started":
            line = f"\n# Run started {ev['ts']} model={ev.get('model')} caps={json.dumps(ev.get('caps'))}\n"
        elif t == "user_message":
            line = f"\n## [reviewer] {ev.get('text', '')}\n"
        elif t == "llm_call":
            line = f"\n### step {step} (llm: {ev.get('prompt_tokens')}+{ev.get('completion_tokens')} tokens, ${ev.get('cost_usd')}, {ev.get('latency_ms')} ms, {ev.get('finish_reason')})\n"
        elif t == "assistant_message":
            line = f"assistant: {ev.get('text') or '(no text)'}\n"
        elif t == "tool_call":
            line = f"- tool_call {ev.get('name')} {ev.get('args_summary', '')}\n"
        elif t == "tool_result":
            body = (ev.get("text") or "").strip().replace("\n", "\n    ")
            line = f"  -> {'ok' if ev.get('ok') else 'ERROR ' + str(ev.get('kind'))} {ev.get('summary', '')} ({ev.get('wall_ms')} ms)\n    {body}\n"
        elif t in ("scene_version", "sfx_version"):
            line = f"  [{t} n={ev.get('n')} checks={ev.get('checks')}]\n"
        elif t == "status":
            line = f"\n== status: {ev.get('status')} {ev.get('reason') or ''}\n"
            if ev.get("explanation"):
                x = ev["explanation"]
                line += f"   what: {x['what']}\n   why: {x['why']}\n   fix: {x['fix']}\n"
        elif t == "note":
            line = f"  note: {ev.get('text')}\n"
        elif t == "run_finished":
            r = ev.get("result", {})
            line = f"\n# Run finished: {r.get('status')} {r.get('status_reason') or ''} steps={r.get('steps')} cost=${r.get('cost_usd')}\n"
        else:
            return
        append_line(self.path, line)


def _args_summary(args: dict[str, Any]) -> str:
    parts = []
    for k, v in args.items():
        if isinstance(v, str) and len(v) > 60:
            v = f"<{len(v)} chars>"
        parts.append(f"{k}={json.dumps(v, ensure_ascii=False)}")
    return ", ".join(parts)[:240]


def _quality_key(rep: dict[str, Any] | None) -> tuple | None:
    if not rep or "counts" not in rep:
        return None
    return (rep["counts"]["error"], 0 if rep.get("level") == "full" else 1, rep["counts"]["warn"])


def _restore_best(vs: VersionStore, emit: Emitter) -> dict[str, int]:
    """A run that stops without finishing leaves its BEST scene and cue in place (fewest errors, a full check beats a fast one)."""
    restored: dict[str, int] = {}
    for kind in ("scene", "cue"):
        best, cur = vs.best_n(kind), vs.current_n(kind)
        if not best or best == cur:
            continue
        rb = vs.scene_report(best) if kind == "scene" else vs.cue_report(best)
        rc = (vs.scene_report(cur) if kind == "scene" else vs.cue_report(cur)) if cur else None
        qb, qc = _quality_key(rb), _quality_key(rc)
        if qc is None or (qb is not None and qb < qc):
            vs.set_current(kind, best)
            restored[kind] = best
            emit("note", text=f"The run stopped without finishing; the best {kind} (v{best}) was put back in place.")
    return restored


def _result_from_state(st: dict[str, Any], lr: LoopResult | None, explanation: Any, status: Status, reason: str | None,
                       summary: str | None, question: str | None, run_wall: float) -> BeatResult:
    return BeatResult(status=status, status_reason=reason, summary=summary, question=question, scene_n=st["scene_n"], sfx_n=st["sfx_n"],
                      final_video=Path(st["final_video"]) if st.get("final_video") and not st.get("final_stale") else None,
                      steps=st["steps"], cost_usd=st["cost_usd"], wall_s=st["wall_s"], last_report=st.get("last_report"),
                      explanation=explanation.to_dict() if explanation else None, run_steps=lr.steps if lr else 0,
                      run_cost_usd=lr.cost_usd if lr else 0.0, run_wall_s=round(run_wall, 3),
                      unknown_cost_calls=lr.unknown_cost_calls if lr else 0)


def _default_llm(settings: Settings) -> LLM:
    from .openrouter import OpenRouterClient
    return OpenRouterClient.from_settings(settings)


def _resolve_ledger(settings: Settings, ledger: Any) -> Any:
    """`ledger=None`: the machine's disk ledger (today's behaviour). `False`: no daily ledger. Anything else must provide
    `today() -> {"remaining": ...}` and `bind(beat, model) -> Budget` (a Budget may expose `denial_reason`)."""
    if ledger is None:
        return SpendLedger(settings.state_dir, settings.max_usd_per_day, settings.ledger_tz)
    return None if ledger is False else ledger


def _guard_failure(settings: Settings, llm_given: bool, ledger: Any) -> tuple[Status, str] | None:
    """Cheap local checks before anything starts. (The full set, with network, is health.preflight.)"""
    if killswitch.engaged():
        return "cancelled", "kill_switch"
    if not llm_given and not settings.api_key:
        return "failed", "no_api_key"
    if ledger is not None and ledger.today()["remaining"] <= 0:
        return "needs_attention", getattr(ledger, "denial_reason", None) or "cap:daily_usd"
    return None


async def _execute(paths: BeatPaths, req: BeatRequest, settings: Settings, sink: EventSink | None, cancel: "asyncio.Event | CancelSignal | None",
                   llm: LLM | None, shared_budget: Any, caps: Caps, user_message: str | None, starting: bool,
                   ledger_in: Any = None, mirror: "Mirror | None" = None) -> BeatResult:
    t_run = time.monotonic()
    killswitch.configure(settings.state_dir)
    if HEAVY.limit != settings.max_heavy:          # only when it differs: reconfiguring resets the gate under beats that are running
        HEAVY.configure(settings.max_heavy)
    state, conv = StateStore(paths), ConversationStore(paths)
    safe = SafeMirror(mirror) if mirror is not None else None
    if safe is not None:                                  # the disk is written first, then the mirror is told
        conv.on_append, state.on_write = safe.message, safe.state
    vs = VersionStore(paths, state)
    emitter = Emitter(MultiSink(FileEventSink(paths.events), TranscriptSink(paths.transcript_md), sink or NullSink()), req.idx)
    ledger = _resolve_ledger(settings, ledger_in)
    sig = CancelSignal.wrap(cancel, paths.cancel)
    st0 = state.load()
    emitter("run_started", model=req.model, caps=caps.to_dict(), starting=starting, scene_n=st0["scene_n"], sfx_n=st0["sfx_n"])

    def finish(status: Status, reason: str | None, *, lr: LoopResult | None = None, summary: str | None = None,
               question: str | None = None, detail: str = "", http_status: int | None = None) -> BeatResult:
        st = state.load()
        if status in ("needs_attention",) and reason in ("cap:max_tool_errors_in_a_row", "stuck") and st.get("last_report") and not st["last_report"].get("ok", True):
            codes = finding_codes(st["last_report"].get("text", ""))
            if codes:
                reason = "checks_failed:" + ",".join(codes)
        expl = explain(reason, detail or (question or summary or ""), http_status=http_status)
        restored = _restore_best(vs, emitter) if status == "needs_attention" else {}
        st = state.update(status=status, status_reason=reason, summary=summary if summary is not None else st.get("summary"), question=question,
                          pid=None, restored_best=restored or st.get("restored_best"), caps=caps.to_dict())
        res = _result_from_state(state.load(), lr, expl, status, reason, summary, question, time.monotonic() - t_run)
        emitter("status", status=status, reason=reason, explanation=expl.to_dict() if expl else None)
        emitter("cost", run_cost_usd=res.run_cost_usd, total_cost_usd=res.cost_usd, steps=res.steps)
        emitter("run_finished", result=res.to_dict())
        return res

    bad = _guard_failure(settings, llm is not None, ledger)
    if bad:
        state.update(status=bad[0], status_reason=bad[1], pid=None)
        emitter("status", status=bad[0], reason=bad[1], explanation=(explain(bad[1]).to_dict() if explain(bad[1]) else None))
        res = _result_from_state(state.load(), None, explain(bad[1]), bad[0], bad[1], None, None, 0.0)
        emitter("run_finished", result=res.to_dict())
        return res
    import os
    state.update(status="running", status_reason=None, model=req.model, pid=os.getpid(), caps=caps.to_dict(),
                 started_at=st0["started_at"] or now_iso(), runs=st0["runs"] + 1, question=None)
    box = Toolbox(paths, req, settings, sig)
    try:
        # ---- prepare the directory (start) or re-validate it (continue) ----
        if starting:
            paths.request.parent.mkdir(parents=True, exist_ok=True)
            write_json_atomic(paths.request, req.to_dict())
            r = await box.ingest()
            if r.outcome is not Outcome.PASS:
                msg = r.error_text if r.error else "the transcript could not be read"
                return finish("failed", "bootstrap:ingest", detail=msg)
            if not paths.scene.exists():
                paths.scene.write_text(PLACEHOLDER_SCENE, encoding="utf-8")
        r = await box.spec()              # also re-run on continue: request.json may have changed
        if r.outcome is not Outcome.PASS:
            msg = r.error_text if r.error else "the beat spec could not be built"
            return finish("failed", "bootstrap:spec", detail=msg)
        # ---- the model ----
        llm = llm or _default_llm(settings)
        info = await llm.model_info(req.model)
        if info is not None and not info.supports_tools:
            return finish("failed", "model_not_supported", detail=f"{req.model} does not support tool calling")
        supports_images = settings.images == "on" or (settings.images == "auto" and bool(info and info.supports_images))
        ctx = BeatContext(paths, req, settings, box, state, vs, emitter, supports_images=supports_images)
        tools = build_beat_tools(ctx)
        # ---- the conversation ----
        history = conv.load()
        if history and history[0].get("role") == "system":
            system, messages = history[0]["content"], history[1:]
        else:
            system, _ = build_system_prompt(settings, req.mode, req.sfx_enabled)
            conv.append({"role": "system", "content": system})
            paths.system_prompt.write_text(system, encoding="utf-8")
            messages = []
        for m in repair_dangling_tool_calls(messages, "interrupted: the process was stopped before this tool finished. Its effect may be partial: "
                                                       "check the current versions with get_beat_info or re-run it."):
            conv.append(m)
            messages.append(m)
        if not messages:
            first = {"role": "user", "content": build_beat_message(req, ctx.spec(), caps, supports_images)}
            conv.append(first)
            messages.append(first)
        elif user_message:
            st = state.load()
            m = {"role": "user", "content": build_reviewer_message(user_message, st["scene_n"], st["sfx_n"], answering=st0["question"] if st0["status_reason"] == "ask_user" else None),
                 "_meta": {"kind": "reviewer"}}
            conv.append(m)
            messages.append(m)
            emitter("user_message", text=user_message)
        elif messages[-1].get("role") == "assistant":
            m = {"role": "user", "content": "The run was interrupted and is resuming. Continue where you left off.", "_meta": {"kind": "resume"}}
            conv.append(m)
            messages.append(m)
        # ---- guards: per-run (shared) and per-day (ledger) budgets on top of the per-beat cap ----
        budget = CompositeBudget(shared_budget, ledger.bind(f"beat{req.idx}:{paths.dir.name}", req.model) if ledger is not None else None)

        class _Store:
            def append_message(self, message: dict[str, Any]) -> None:
                conv.append(message)

            def log_llm_call(self, record: dict[str, Any]) -> None:
                append_line(paths.llm_calls, json.dumps({"ts": now_iso(), **record}, default=str))

            def checkpoint(self, info: dict[str, Any]) -> None:
                st = state.load()
                base = st.get("_run_base") or {}
                state.update(steps=base.get("steps", st["steps"]) + info["steps"], cost_usd=round(base.get("cost_usd", st["cost_usd"]) + info["cost_usd"], 6),
                             wall_s=round(base.get("wall_s", st["wall_s"]) + info["wall_s"], 3),
                             unknown_cost_calls=base.get("unknown_cost_calls", st["unknown_cost_calls"]) + info["unknown_cost_calls"])

        base = {k: st0[k] for k in ("steps", "cost_usd", "wall_s", "unknown_cost_calls")}
        state.update(_run_base=base)

        def h_turn(step: int) -> None:
            emitter.step = step

        def h_llm(info: dict[str, Any]) -> None:
            emitter("llm_call", **{k: info[k] for k in ("model", "attempts", "latency_ms", "prompt_tokens", "completion_tokens", "cost_usd", "cost_source", "finish_reason")})
            emitter("cost", run_cost_usd=info["run_cost_usd"], total_cost_usd=round(base["cost_usd"] + info["run_cost_usd"], 6), steps=base["steps"] + info["step"])

        def h_msg(step: int, m: dict[str, Any]) -> None:
            emitter("assistant_message", text=m.get("content") if isinstance(m.get("content"), str) else "")

        def h_start(step: int, call: Any) -> None:
            emitter("tool_call", name=call.name, call_id=call.id, args_summary=_args_summary(call.arguments))

        def h_result(step: int, call: Any, out: ToolOutcome, wall: int) -> None:
            emitter("tool_result", name=call.name, call_id=call.id, ok=out.ok, kind=out.kind, summary=out.summary, text=out.text[:2000],
                    image_paths=out.image_paths, wall_ms=wall)

        hooks = Hooks(on_turn_start=h_turn, on_llm_call=h_llm, on_message=h_msg, on_tool_start=h_start, on_tool_result=h_result)
        lr = await run_loop(llm, req.model, system, messages, tools, caps, hooks, cancel=sig, store=_Store(), budget=budget,
                            media_root=paths.dir, temperature=settings.temperature, max_tokens=settings.max_tokens,
                            unknown_call_cost=settings.unknown_call_cost_usd, inflight_estimate=settings.inflight_estimate_usd)
        end = lr.end
        return finish(lr.status, lr.reason, lr=lr, summary=(end.summary if end else None), question=(end.question if end else None),
                      detail=lr.fault_detail or "", http_status=_status_of(lr.fault_detail))
    except asyncio.CancelledError:
        state.update(status="cancelled", status_reason="cancelled", pid=None)
        raise
    except Cancelled as exc:                      # cancelled while preparing the directory (before the loop took over)
        return finish("cancelled", exc.reason or sig.why())
    except ModelNotSupported as exc:
        return finish("failed", "model_not_supported", detail=str(exc))
    except LLMError as exc:
        return finish("failed", "llm_error", detail=str(exc))
    except Exception as exc:  # noqa: BLE001 - a crash becomes a failed result with the traceback in transcript.md
        append_line(paths.transcript_md, "\n!! internal error\n" + redact(traceback.format_exc()))
        log.error("beat %s crashed: %s", paths.dir, exc)
        return finish("failed", "internal_error", detail=f"{type(exc).__name__}: {exc}")
    finally:
        s = state.load()
        if "_run_base" in s:
            s.pop("_run_base")
            write_json_atomic(paths.state, s)
        if safe is not None:                              # the one final state call of this run
            safe.final(s)


def _status_of(detail: str | None) -> int | None:
    import re
    m = re.search(r"\bHTTP (\d{3})\b", detail or "")
    return int(m.group(1)) if m else None


async def run_beat(req: BeatRequest, sink: EventSink | None = None, cancel: "asyncio.Event | CancelSignal | None" = None, *,
                   llm: LLM | None = None, settings: Settings | None = None, budget: Any = None, ledger: Any = None,
                   mirror: "Mirror | None" = None) -> BeatResult:
    """Start a beat. Returns a BeatResult; it does not raise for anything that happens during the run (only BeatBusy if another
    process holds this beat directory)."""
    settings = settings or load_settings()
    req = BeatRequest.from_dict(req.to_dict())                      # a private copy
    req.model = req.model or settings.beat_model or ""
    if not req.model:
        raise ValueError("no model: set BeatRequest.model or VBEAT_BEAT_MODEL")
    if req.caps == Caps():                                           # untouched defaults follow the configured per-beat cap
        req.caps = settings.default_caps()
    paths = BeatPaths(req.beat_dir).ensure()
    with BeatLock(paths):
        return await _execute(paths, req, settings, sink, cancel, llm, budget, req.caps, None, True, ledger, mirror)


async def continue_beat(beat_dir: Path, user_message: str = "", sink: EventSink | None = None, cancel: "asyncio.Event | CancelSignal | None" = None,
                        caps_override: Caps | None = None, *, llm: LLM | None = None, settings: Settings | None = None, budget: Any = None,
                        ledger: Any = None, mirror: "Mirror | None" = None) -> BeatResult:
    """Resume the saved conversation with the reviewer's message (or an answer to ask_user). With an empty message it is a pure
    resume after a kill. Caps apply per call: a continue gets a fresh step/time/money allowance (totals accumulate in state.json)."""
    settings = settings or load_settings()
    paths = BeatPaths(beat_dir)
    raw = read_json(paths.request)
    if not raw:
        raise FileNotFoundError(f"{paths.request} not found: {beat_dir} is not a beat directory created by run_beat")
    req = BeatRequest.from_dict(raw)
    caps = caps_override or Caps.from_dict(raw.get("caps"))
    if caps_override is None and caps == Caps():
        caps = settings.default_caps()
    req.model = req.model or settings.beat_model or ""
    with BeatLock(paths):
        return await _execute(paths, req, settings, sink, cancel, llm, budget, caps, user_message or None, False, ledger, mirror)


def revert_beat(beat_dir: Path, scene_n: int | None = None, sfx_n: int | None = None) -> None:
    """Make scene.js / cue.py point at an older version (a copy of it). The final video no longer matches: `final_stale` is set."""
    paths = BeatPaths(beat_dir)
    if BeatLock.is_locked(paths):
        raise BeatBusy(f"{beat_dir} is being run; cancel it first")
    state = StateStore(paths)
    vs = VersionStore(paths, state)
    for kind, n in (("scene", scene_n), ("cue", sfx_n)):
        if n is not None:
            vs.set_current(kind, n)                                   # KeyError names the versions that exist
    state.update(final_stale=True, full_ok_n=None, markers_n=None)
    emitter = Emitter(FileEventSink(paths.events), json.loads(paths.request.read_text()).get("idx", 0) if paths.request.exists() else 0)
    emitter("note", text=f"Reverted by the reviewer: scene v{scene_n or '-'}, cue v{sfx_n or '-'} are now current; the final video is out of date.")
