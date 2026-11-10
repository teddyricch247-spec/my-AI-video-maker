"""Command line: `python -m vbeat_agent <command>`.

Contract (same as every other vbeat tool): ONE JSON envelope on stdout (`vbeat_shared.envelope`), human text on stderr.
Exit codes: 0 = waiting_user (or cancelled on purpose, or a healthy check), 1 = needs_attention (or a failed check),
2 = failure or bad usage.

The API key is read from the OPENROUTER_API_KEY environment variable ONLY. There is deliberately no --api-key flag (it would show in
process lists and shell history) and no flag that reads or writes the key to a file. Precedence for everything else:
flag > environment variable > default. There is no fake or offline model on the command line: run `selftest` to check the machine
without spending anything.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import signal
import sys
import time
from pathlib import Path
from typing import Any, NoReturn

from vbeat_shared.envelope import make_envelope

from . import killswitch
from .beat import BeatRequest, BeatResult, continue_beat, revert_beat, run_beat
from .budget import SpendLedger
from .config import Caps, Settings, load_settings
from .errors import explain
from .events import CallbackSink, events_to_messages
from .redact import redact
from .runner import run_beats
from .state import BeatBusy, BeatPaths, read_json, write_json_atomic
from .toolrun import CancelSignal

EXIT_OK, EXIT_ATTENTION, EXIT_FAIL = 0, 1, 2


class UsageError(Exception):
    pass


# ---- output ----------------------------------------------------------------------------------------------------------------

def say(text: str = "") -> None:
    print(redact(text), file=sys.stderr, flush=True)


def emit(env: dict[str, Any]) -> None:
    sys.stdout.write(redact(json.dumps(env, ensure_ascii=False, default=str)) + "\n")
    sys.stdout.flush()


def explanation_text(ex: dict[str, Any] | None) -> str:
    return f"What happened: {ex['what']}\nWhy: {ex['why']}\nWhat to do: {ex['fix']}" if ex else ""


def result_envelope(command: str, res: BeatResult, t0: float) -> tuple[dict[str, Any], int]:
    ok = res.status == "waiting_user"
    arts = {"final_video": str(res.final_video)} if res.final_video else {}
    err = None
    if not ok:
        ex = res.explanation or {}
        err = {"type": res.status_reason or res.status, "message": " ".join(filter(None, [ex.get("what"), ex.get("why"), ex.get("fix")])) or res.status}
    code = {"waiting_user": EXIT_OK, "cancelled": EXIT_OK, "needs_attention": EXIT_ATTENTION}.get(res.status, EXIT_FAIL)
    return make_envelope(command, ok=ok, artifacts=arts, report=res.to_dict(), timing_ms={"total": int((time.monotonic() - t0) * 1000)}, error=err), code


def print_result(res: BeatResult) -> None:
    line = f"{res.status}" + (f" ({res.status_reason})" if res.status_reason else "")
    say(f"Result: {line}; {res.run_steps} steps, ${res.run_cost_usd:.4f} this run (${res.cost_usd:.4f} in total for the beat).")
    if res.summary:
        say(f"Summary: {res.summary}")
    if res.question:
        say(f"The agent asks: {res.question}")
    if res.final_video:
        say(f"Final video: {res.final_video}")
    if res.explanation:
        say(explanation_text(res.explanation))


def progress_sink(quiet: bool) -> CallbackSink | None:
    if quiet:
        return None

    def show(ev: dict[str, Any]) -> None:
        t = ev.get("type")
        who = f"[beat {ev.get('beat_idx')}] "
        if t == "tool_result":
            say(f"{who}step {ev.get('step')}: {ev.get('name')} -> {'ok' if ev.get('ok') else 'problem'} {ev.get('summary') or ''}"[:200])
        elif t == "scene_version":
            say(f"{who}scene version {ev.get('n')} saved")
        elif t == "sfx_version":
            say(f"{who}sound version {ev.get('n')} saved")
        elif t == "status":
            say(f"{who}status: {ev.get('status')} {ev.get('reason') or ''}")
    return CallbackSink(show)


# ---- settings and requests -------------------------------------------------------------------------------------------------

def settings_from(a: argparse.Namespace) -> Settings:
    s = load_settings()
    if getattr(a, "state_dir", None):
        s.state_dir = Path(a.state_dir)
    for flag, attr in (("max_usd_per_day", "max_usd_per_day"), ("max_usd_per_run", "max_usd_per_run"), ("concurrency", "beat_concurrency")):
        v = getattr(a, flag, None)
        if v is not None:
            setattr(s, attr, v)
    if getattr(a, "log_level", None):
        s.log_level = a.log_level
    return s


def pick_model(a: argparse.Namespace, s: Settings) -> str:
    m = (getattr(a, "model", None) or s.beat_model or "").strip()
    if not m:
        raise UsageError("No model chosen. Pass --model <openrouter model id> or set VBEAT_BEAT_MODEL (the `models` command lists ids).")
    if m.lower().split("/")[0] in ("fake", "mock", "offline"):
        raise UsageError(f"'{m}' is not a model. There is no fake or offline model in the command line; run `selftest` to check the machine for free.")
    return m


def caps_from(a: argparse.Namespace, base: Caps) -> Caps:
    return base.with_overrides(max_steps=a.max_steps, max_minutes=a.max_minutes, max_usd=a.max_usd)


def word_ref(v: str) -> int | str:
    return int(v) if v.lstrip("-").isdigit() else v


def request_from(a: argparse.Namespace, s: Settings) -> BeatRequest:
    try:
        w, h = (int(x) for x in a.size.lower().split("x"))
    except ValueError:
        raise UsageError("--size must look like 1280x720") from None
    media = {}
    for m in a.media or []:
        k, _, v = m.partition("=")
        if not k or not v:
            raise UsageError("--media must look like id=path")
        media[k] = Path(v)
    try:
        params = json.loads(a.params) if a.params else {}
    except ValueError as exc:
        raise UsageError(f"--params is not valid JSON: {exc}") from None
    return BeatRequest(beat_dir=Path(a.beat_dir), transcript=Path(a.transcript), from_word=word_ref(a.from_word), to_word=word_ref(a.to_word), fps=a.fps,
                       width=w, height=h, idx=a.idx, title=a.title or "", direction=a.direction or "", mode=a.mode, media=media, sfx_enabled=not a.no_sfx,
                       bible=Path(a.bible_file).read_text(encoding="utf-8") if a.bible_file else None, model=pick_model(a, s),
                       caps=caps_from(a, s.default_caps()), params=params)


def run_with_signals(coro_fn: Any) -> Any:
    """Run `coro_fn(cancel)` on a fresh loop. SIGTERM / SIGINT cancel the run cooperatively: it persists its state and returns normally."""
    async def main() -> Any:
        cancel = CancelSignal()
        loop = asyncio.get_running_loop()
        for sig, name in ((signal.SIGTERM, "sigterm"), (signal.SIGINT, "sigint")):
            try:
                loop.add_signal_handler(sig, cancel.trip, name)
            except (NotImplementedError, RuntimeError):
                pass
        return await coro_fn(cancel)
    return asyncio.run(main())


# ---- commands --------------------------------------------------------------------------------------------------------------

def cmd_run_beat(a: argparse.Namespace) -> tuple[dict[str, Any], int]:
    t0 = time.monotonic()
    s = settings_from(a)
    req = request_from(a, s)
    res = run_with_signals(lambda c: run_beat(req, progress_sink(a.quiet), c, settings=s))
    print_result(res)
    return result_envelope("run-beat", res, t0)


def cmd_continue(a: argparse.Namespace) -> tuple[dict[str, Any], int]:
    t0 = time.monotonic()
    s = settings_from(a)
    msg = Path(a.message_file).read_text(encoding="utf-8") if a.message_file else (a.message or "")
    paths = BeatPaths(a.beat_dir)
    raw = read_json(paths.request)
    if not raw:
        raise UsageError(f"{a.beat_dir} is not a beat directory created by run-beat (agent/request.json is missing).")
    if a.model:
        pick_model(a, s)
        raw["model"] = a.model
        write_json_atomic(paths.request, raw)
    caps = caps_from(a, Caps.from_dict(raw.get("caps")) if raw.get("caps") else s.default_caps())
    res = run_with_signals(lambda c: continue_beat(Path(a.beat_dir), msg, progress_sink(a.quiet), c, caps, settings=s))
    print_result(res)
    return result_envelope("continue", res, t0)


def cmd_run_beats(a: argparse.Namespace) -> tuple[dict[str, Any], int]:
    t0 = time.monotonic()
    s = settings_from(a)
    plan = json.loads(Path(a.plan).read_text(encoding="utf-8"))
    items = plan["beats"] if isinstance(plan, dict) else plan
    reqs = []
    for i, d in enumerate(items):
        r = BeatRequest.from_dict({**d, "idx": d.get("idx", i)})
        r.model = r.model or pick_model(a, s)
        if r.caps == Caps():
            r.caps = caps_from(a, s.default_caps())
        reqs.append(r)
    results = run_with_signals(lambda c: run_beats(reqs, progress_sink(a.quiet), c, concurrency=a.concurrency, total_max_usd=a.max_usd_total, settings=s))
    for r, res in zip(reqs, results):
        say(f"--- beat {r.idx} ({r.beat_dir.name}) ---")
        print_result(res)
    worst = max((EXIT_OK if x.status in ("waiting_user", "cancelled") else EXIT_ATTENTION if x.status == "needs_attention" else EXIT_FAIL) for x in results) if results else EXIT_OK
    ok = all(x.status == "waiting_user" for x in results)
    arts = {f"final_video_{r.idx}": str(x.final_video) for r, x in zip(reqs, results) if x.final_video}
    err = None if ok else {"type": "batch_incomplete", "message": f"{sum(1 for x in results if x.status != 'waiting_user')} of {len(results)} beats did not finish; see each result's explanation."}
    env = make_envelope("run-beats", ok=ok, artifacts=arts, report={"results": [x.to_dict() for x in results], "spent_usd": round(sum(x.run_cost_usd for x in results), 6)},
                        timing_ms={"total": int((time.monotonic() - t0) * 1000)}, error=err)
    return env, worst


def cmd_revert(a: argparse.Namespace) -> tuple[dict[str, Any], int]:
    revert_beat(Path(a.beat_dir), a.scene, a.cue)
    st = read_json(BeatPaths(a.beat_dir).state, {}) or {}
    say(f"Reverted: scene v{st.get('scene_n')}, cue v{st.get('sfx_n')} are current. The final video is out of date; continue the beat to render it again.")
    return make_envelope("revert", report={"scene_n": st.get("scene_n"), "sfx_n": st.get("sfx_n"), "final_stale": st.get("final_stale")}), EXIT_OK


def cmd_models(a: argparse.Namespace) -> tuple[dict[str, Any], int]:
    from .openrouter import OpenRouterClient
    s = settings_from(a)
    ms = asyncio.run(OpenRouterClient.from_settings(s).list_models(refresh=a.refresh))
    rows = [m for m in ms if (not a.tools_only or m.supports_tools) and (not a.filter or a.filter.lower() in m.id.lower())]
    rows.sort(key=lambda m: m.id)
    for m in rows[: a.limit]:
        say(f"{m.id:55s} tools={'y' if m.supports_tools else 'n'} images={'y' if m.supports_images else 'n'} "
            f"${m.price_in if m.price_in is not None else '?'}/M in, ${m.price_out if m.price_out is not None else '?'}/M out")
    return make_envelope("models", report={"count": len(rows), "models": [m.to_dict() for m in rows[: a.limit]]}), EXIT_OK


def cmd_prompt(a: argparse.Namespace) -> tuple[dict[str, Any], int]:
    from .prompts import build_system_prompt
    text, parts = build_system_prompt(settings_from(a), a.mode, not a.no_sfx)
    if a.out:
        Path(a.out).write_text(text, encoding="utf-8")
    for name, n in parts:
        say(f"{name:10s} {n:7d} chars")
    say(f"total      {len(text):7d} chars (~{len(text) // 4} tokens)" + (f"; written to {a.out}" if a.out else ""))
    return make_envelope("prompt", artifacts={"prompt": str(Path(a.out))} if a.out else None,
                         report={"chars": len(text), "sections": dict(parts), **({} if a.out else {"text": text})}), EXIT_OK


def cmd_replay(a: argparse.Namespace) -> tuple[dict[str, Any], int]:
    paths = BeatPaths(a.beat_dir)
    events = []
    try:
        events = [json.loads(ln) for ln in paths.events.read_text(encoding="utf-8").splitlines() if ln.strip()]
    except OSError:
        raise UsageError(f"{a.beat_dir} has no agent/events.jsonl: nothing to replay.") from None
    msgs = events_to_messages(events)
    for m in msgs:
        say(f"{m['role']:9s} {m['text'][:150]}" + ("".join(f"\n          - {st['name']}: {st['summary']}" for st in m["steps"]) if m["steps"] else ""))
    return make_envelope("replay", report={"events": len(events), "messages": msgs}), EXIT_OK


def cmd_preflight(a: argparse.Namespace) -> tuple[dict[str, Any], int]:
    from . import health
    rep = health.preflight(settings_from(a), model=a.model, network=not a.no_network, browser=not a.no_browser)
    say(health.render_text(rep))
    return _check_envelope("preflight", rep), EXIT_OK if rep["ok"] else EXIT_ATTENTION


def cmd_selftest(a: argparse.Namespace) -> tuple[dict[str, Any], int]:
    from . import health
    rep = health.selftest(settings_from(a), llm_ping=a.ping, model=a.model, keep=a.keep)
    say(health.render_text(rep))
    if rep["spent_usd"]:
        say(f"Spent ${rep['spent_usd']:.4f} on the model test.")
    return _check_envelope("selftest", rep), EXIT_OK if rep["ok"] else EXIT_ATTENTION


def cmd_diagnose(a: argparse.Namespace) -> tuple[dict[str, Any], int]:
    from . import health
    rep = health.diagnose(a.beat_dir, settings_from(a))
    say(health.render_text(rep))
    return _check_envelope("diagnose", rep), EXIT_OK if rep["ok"] else EXIT_ATTENTION


def _check_envelope(command: str, rep: dict[str, Any]) -> dict[str, Any]:
    bad = [c for c in rep["checks"] if c["status"] == "fail"]
    err = None if rep["ok"] else {"type": f"{command}_failed", "message": "; ".join(f"{c['what']} {c['fix']}".strip() for c in bad)}
    return make_envelope(command, ok=rep["ok"], report=rep, error=err)


def cmd_kill(a: argparse.Namespace) -> tuple[dict[str, Any], int]:
    s = settings_from(a)
    killswitch.configure(s.state_dir)
    if a.off:
        removed = killswitch.release()
        env_on = killswitch.engaged()
        say("Kill switch released: runs may start again." if removed else "The kill switch file was not set.")
        if env_on:
            say(f"Still engaged: {env_on}. Unset the VBEAT_KILL environment variable and restart.")
        return make_envelope("kill", report={"engaged": bool(env_on), "released_file": removed}), EXIT_OK
    p = killswitch.engage(a.reason)
    say(f"Kill switch ENGAGED ({p}). Running beats stop within a few seconds and nothing new will start. Undo with: kill --off")
    return make_envelope("kill", report={"engaged": True, "path": str(p)}), EXIT_OK


def cmd_ledger(a: argparse.Namespace) -> tuple[dict[str, Any], int]:
    s = settings_from(a)
    led = SpendLedger(s.state_dir, s.max_usd_per_day, s.ledger_tz)
    t = led.today()
    recent: list[dict[str, Any]] = []
    try:
        recent = [json.loads(ln) for ln in led.audit_path.read_text(encoding="utf-8").splitlines()[-a.last:] if ln.strip()] if a.last else []
    except OSError:
        pass
    say(f"{t['date']} ({t['tz']}): spent ${t['spent']:.4f} of ${t['cap']:.2f}; ${t['remaining']:.4f} left" + (f"; ${t['in_flight']:.4f} in flight" if t["in_flight"] else "") + ".")
    for r in recent:
        say(f"  {r.get('ts')}  ${r.get('usd'):.4f}  {r.get('beat')}  {r.get('model')}" + ("  (estimated)" if r.get("estimated") else ""))
    return make_envelope("ledger", report={**t, "recent": recent}), EXIT_OK


# ---- argument parsing ------------------------------------------------------------------------------------------------------

class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> "NoReturn":     # type: ignore[override]
        raise UsageError(message)


def build_parser() -> argparse.ArgumentParser:
    p = _Parser(prog="vbeat_agent", description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter,
                                epilog="The OpenRouter key comes from the OPENROUTER_API_KEY environment variable only. Run `preflight` first.")
    sub = p.add_subparsers(dest="cmd", required=True, metavar="command")

    def common(sp: argparse.ArgumentParser, *, run: bool = False) -> None:
        sp.add_argument("--state-dir", help="where the kill switch and the daily ledger live (default VBEAT_STATE_DIR or ~/.vbeat-agent)")
        sp.add_argument("--log-level", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
        sp.add_argument("--quiet", action="store_true", help="no progress lines on stderr")
        if run:
            sp.add_argument("--model", help="OpenRouter model id (default VBEAT_BEAT_MODEL)")
            sp.add_argument("--max-steps", type=int)
            sp.add_argument("--max-minutes", type=float)
            sp.add_argument("--max-usd", type=float, help="cap for this beat's run (default $0.50 / VBEAT_MAX_USD_PER_BEAT)")
            sp.add_argument("--max-usd-per-day", type=float, help="daily cap for everything on this machine (default $10)")

    r = sub.add_parser("run-beat", help="author one beat")
    common(r, run=True)
    r.add_argument("--beat-dir", required=True)
    r.add_argument("--transcript", required=True)
    r.add_argument("--from-word", required=True)
    r.add_argument("--to-word", required=True)
    r.add_argument("--fps", type=int, default=30)
    r.add_argument("--size", default="1280x720")
    r.add_argument("--idx", type=int, default=0)
    r.add_argument("--title")
    r.add_argument("--direction")
    r.add_argument("--mode", choices=["technical", "story", "either"], default="technical")
    r.add_argument("--no-sfx", action="store_true")
    r.add_argument("--bible-file")
    r.add_argument("--media", action="append", metavar="ID=PATH")
    r.add_argument("--params", help="JSON object of beat params")
    r.set_defaults(fn=cmd_run_beat)

    c = sub.add_parser("continue", help="resume a beat with a reviewer's message (or after a kill)")
    common(c, run=True)
    c.add_argument("--beat-dir", required=True)
    g = c.add_mutually_exclusive_group()
    g.add_argument("--message")
    g.add_argument("--message-file")
    c.set_defaults(fn=cmd_continue)

    rb = sub.add_parser("run-beats", help="author many beats in parallel from a plan file (JSON list of requests)")
    common(rb, run=True)
    rb.add_argument("--plan", required=True)
    rb.add_argument("--concurrency", type=int)
    rb.add_argument("--max-usd-total", type=float, help="cap for the whole batch (default $5 / VBEAT_MAX_USD_PER_RUN)")
    rb.set_defaults(fn=cmd_run_beats)

    rv = sub.add_parser("revert", help="make an older scene/cue version current")
    common(rv)
    rv.add_argument("--beat-dir", required=True)
    rv.add_argument("--scene", type=int)
    rv.add_argument("--cue", type=int)
    rv.set_defaults(fn=cmd_revert)

    m = sub.add_parser("models", help="list OpenRouter models (no key needed)")
    common(m)
    m.add_argument("--filter")
    m.add_argument("--tools-only", action="store_true")
    m.add_argument("--refresh", action="store_true")
    m.add_argument("--limit", type=int, default=60)
    m.set_defaults(fn=cmd_models)

    pr = sub.add_parser("prompt", help="build and show the system prompt")
    common(pr)
    pr.add_argument("--mode", choices=["technical", "story", "either"], default="technical")
    pr.add_argument("--no-sfx", action="store_true")
    pr.add_argument("--out", help="write the full text here")
    pr.set_defaults(fn=cmd_prompt)

    rp = sub.add_parser("replay", help="show a beat's run as chat messages")
    common(rp)
    rp.add_argument("--beat-dir", required=True)
    rp.set_defaults(fn=cmd_replay)

    pf = sub.add_parser("preflight", help="check that this system can run beats (no spend)")
    common(pf)
    pf.add_argument("--model")
    pf.add_argument("--no-network", action="store_true")
    pf.add_argument("--no-browser", action="store_true")
    pf.set_defaults(fn=cmd_preflight)

    st = sub.add_parser("selftest", help="render the example beat through the real tools (no spend unless --ping)")
    common(st)
    st.add_argument("--ping", action="store_true", help="also make one tiny paid model call that must answer with a tool call")
    st.add_argument("--model")
    st.add_argument("--keep", action="store_true", help="keep the work folder")
    st.set_defaults(fn=cmd_selftest)

    dg = sub.add_parser("diagnose", help="explain in plain language what happened to a beat")
    common(dg)
    dg.add_argument("--beat-dir", required=True)
    dg.set_defaults(fn=cmd_diagnose)

    k = sub.add_parser("kill", help="the kill switch: stop all runs and block new ones (--off to release)")
    common(k)
    k.add_argument("--off", action="store_true")
    k.add_argument("--reason", default="operator")
    k.set_defaults(fn=cmd_kill)

    lg = sub.add_parser("ledger", help="today's spend against the daily cap")
    common(lg)
    lg.add_argument("--last", type=int, default=10, help="show this many recent charges")
    lg.set_defaults(fn=cmd_ledger)
    return p


def main(argv: list[str] | None = None) -> int:
    try:
        args = build_parser().parse_args(argv)
    except UsageError as exc:
        say(f"Usage problem: {exc}\nRun with --help to see the commands and options.")
        emit(make_envelope("usage", ok=False, error={"type": "usage", "message": str(exc)}))
        return EXIT_FAIL
    import logging
    logging.basicConfig(level=getattr(logging, (args.log_level or load_settings().log_level or "INFO").upper(), logging.INFO), stream=sys.stderr,
                        format="%(levelname)s %(name)s: %(message)s")
    from .redact import RedactingFilter
    for h in logging.getLogger().handlers:
        h.addFilter(RedactingFilter())
    try:
        env, code = args.fn(args)
    except UsageError as exc:
        say(f"Usage problem: {exc}")
        env, code = make_envelope(args.cmd, ok=False, error={"type": "usage", "message": str(exc)}), EXIT_FAIL
    except BeatBusy as exc:
        ex = explain("busy", str(exc))
        say(explanation_text(ex.to_dict()) if ex else str(exc))
        env, code = make_envelope(args.cmd, ok=False, error={"type": "busy", "message": str(exc)}), EXIT_FAIL
    except (FileNotFoundError, NotADirectoryError, PermissionError) as exc:
        say(f"File problem: {exc}")
        env, code = make_envelope(args.cmd, ok=False, error={"type": "file", "message": str(exc)}), EXIT_FAIL
    except KeyboardInterrupt:
        env, code = make_envelope(args.cmd, ok=False, error={"type": "cancelled", "message": "interrupted"}), EXIT_OK
    except Exception as exc:  # noqa: BLE001 - the contract is "always one envelope"
        ex = explain("internal_error", f"{type(exc).__name__}: {exc}")
        say(explanation_text(ex.to_dict()) if ex else str(exc))
        env, code = make_envelope(args.cmd, ok=False, error={"type": "internal_error", "message": f"{type(exc).__name__}: {exc}"[:400]}), EXIT_FAIL
    emit(env)
    return code


if __name__ == "__main__":
    sys.exit(main())
