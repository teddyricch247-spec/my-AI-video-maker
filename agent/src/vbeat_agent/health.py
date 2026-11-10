"""preflight(), selftest(), diagnose(): "is this system able to run beats, and if not, what do I do?" for an operator who only has
the hosted system and an OpenRouter key.

- preflight()  : cheap checks of everything a run needs (key, credits, model, kill switch, ledger, disk, Chromium, ffmpeg, assets,
                 prompt inputs). One network call to OpenRouter's free `GET /key` and `GET /models`; no model call, no spend.
- selftest()   : renders the repo's example beat through the REAL tools (ingest, spec, full check, markers, sfx, the full pipeline)
                 and verifies the final.mp4. No model, no spend. Optional `llm_ping` makes one tiny paid call (tool calling).
- diagnose(dir): reads a beat's own files and says in plain language what happened and what to do.

Every result is a plain JSON-able dict: {"ok", "status": ok|warn|fail, "summary", "checks": [{name, status, what, why, fix, data}]}.
Nothing here prints or returns the API key; every string passes through redact(). Sync functions are safe to call from a running
event loop (they hop to a worker thread); the `*_async` versions are the real implementations.
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Awaitable, TypeVar

from . import killswitch
from .budget import SpendLedger
from .config import Settings, load_settings, repo_root
from .errors import explain
from .redact import redact
from .state import BeatLock, BeatPaths, StateStore, VersionStore, read_json

T = TypeVar("T")
OK, WARN, FAIL = "ok", "warn", "fail"


@dataclass
class Check:
    name: str
    status: str
    what: str
    why: str = ""
    fix: str = ""
    data: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {k: (redact(v) if isinstance(v, str) else v) for k, v in asdict(self).items()}


def _report(kind: str, checks: list[Check], **extra: Any) -> dict[str, Any]:
    status = FAIL if any(c.status == FAIL for c in checks) else WARN if any(c.status == WARN for c in checks) else OK
    bad = [c for c in checks if c.status == FAIL] or [c for c in checks if c.status == WARN]
    summary = {OK: f"{kind}: everything checked is fine.", WARN: f"{kind}: works, with {len(bad)} warning(s): " + "; ".join(c.what for c in bad),
               FAIL: f"{kind}: {len(bad)} problem(s) to fix: " + "; ".join(c.what for c in bad)}[status]
    return {"kind": kind, "ok": status != FAIL, "status": status, "summary": redact(summary), "checks": [c.to_dict() for c in checks], **extra}


def render_text(report: dict[str, Any]) -> str:
    """The report as plain text for a person (the CLI prints this to stderr)."""
    mark = {OK: "OK  ", WARN: "WARN", FAIL: "FAIL", "skip": "skip"}
    out = [report["summary"], ""]
    for c in report["checks"]:
        out.append(f"[{mark.get(c['status'], c['status'])}] {c['what']}")
        if c["status"] in (WARN, FAIL):
            if c.get("why"):
                out.append(f"       Why: {c['why']}")
            if c.get("fix"):
                out.append(f"       What to do: {c['fix']}")
    return "\n".join(out)


def _run_sync(coro: Awaitable[T]) -> T:
    """asyncio.run, or a worker thread when called from inside a running loop (the hosted backend is async)."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)    # type: ignore[arg-type]
    box: dict[str, Any] = {}

    def work() -> None:
        try:
            box["v"] = asyncio.run(coro)    # type: ignore[arg-type]
        except BaseException as exc:  # noqa: BLE001
            box["e"] = exc
    t = threading.Thread(target=work)
    t.start()
    t.join()
    if "e" in box:
        raise box["e"]
    return box["v"]


async def _guarded(name: str, fn: Any) -> Check:
    """A check that crashes is a failed check, never a crashed preflight."""
    try:
        return await fn()
    except Exception as exc:  # noqa: BLE001
        e = explain("internal_error", f"{type(exc).__name__}: {exc}")
        return Check(name, FAIL, f"The '{name}' check itself crashed.", e.why if e else "", e.fix if e else "")


def _from_explained(name: str, code: str, detail: str = "", status: str = FAIL, **ctx: Any) -> Check:
    e = explain(code, detail, **ctx)
    assert e is not None
    return Check(name, status, e.what, e.why, e.fix, {"code": code})


# ====================================================================== preflight ==========================================

def _check_python() -> Check:
    v = sys.version_info
    if v >= (3, 11):
        return Check("python", OK, f"Python {v.major}.{v.minor}.{v.micro}.")
    return Check("python", FAIL, f"Python {v.major}.{v.minor} is too old.", "The runner needs Python 3.11 or newer.", "Use a 3.11+ interpreter (agent/scripts/bootstrap.sh checks this).")


def _check_key(s: Settings) -> Check:
    if not s.api_key:
        return _from_explained("api_key", "no_api_key")
    note = "" if s.api_key.startswith("sk-or-") else " It does not look like an OpenRouter key (they start with sk-or-)."
    return Check("api_key", WARN if note else OK, ("An OpenRouter key is set." + note), "" if not note else "Keys from OpenRouter start with 'sk-or-'.",
                 "" if not note else "Check that you pasted the whole key into the OPENROUTER_API_KEY secret.")


def _check_killswitch() -> Check:
    why = killswitch.engaged()
    if why:
        return _from_explained("kill_switch", "kill_switch", why)
    return Check("kill_switch", OK, "The kill switch is off.")


def _check_state_dir(s: Settings) -> list[Check]:
    out: list[Check] = []
    d = Path(s.state_dir)
    try:
        d.mkdir(parents=True, exist_ok=True)
        probe = d / ".write-test"
        probe.write_text("x")
        probe.unlink()
        out.append(Check("state_dir", OK, f"The state folder is writable ({d}).", data={"path": str(d)}))
    except OSError as exc:
        return [Check("state_dir", FAIL, f"The state folder {d} is not writable.", redact(str(exc)),
                      "Set VBEAT_STATE_DIR to a folder on a persistent, writable disk.")]
    if killswitch.has_provider():     # a backend keeps the kill switch and the daily ledger in a database: the folder's persistence does not matter
        return out
    tmpish = str(d.resolve()).startswith(("/tmp", "/var/tmp", "/dev/shm"))
    if tmpish or not os.environ.get("VBEAT_STATE_DIR"):
        out.append(Check("state_persistence", WARN, "The daily spend ledger may not survive a restart.",
                         "The state folder is " + ("in a temporary location." if tmpish else "the default home folder, which many hosts wipe on every deploy."),
                         "Point VBEAT_STATE_DIR at a persistent disk. If the folder is wiped, the $/day cap starts again from zero."))
    return out


def _check_ledger(s: Settings) -> Check:
    led = SpendLedger(s.state_dir, s.max_usd_per_day, s.ledger_tz)
    t = led.today()
    data = {k: t[k] for k in ("date", "spent", "in_flight", "cap", "remaining")}
    if t["remaining"] <= 0:
        return Check("daily_ledger", FAIL, f"Today's spending cap (${t['cap']:.2f}) is used up.", f"${t['spent']:.2f} has been spent today ({t['tz']} day).",
                     "Wait for the new day, or raise VBEAT_MAX_USD_PER_DAY if you really want to spend more.", data)
    if t["remaining"] < s.max_usd_per_beat:
        return Check("daily_ledger", WARN, f"Only ${t['remaining']:.2f} is left of today's ${t['cap']:.2f} cap.",
                     f"A single beat may spend up to ${s.max_usd_per_beat:.2f}.", "Expect runs to stop with 'daily cap reached' soon.", data)
    return Check("daily_ledger", OK, f"${t['remaining']:.2f} of today's ${t['cap']:.2f} cap is left.", data=data)


def _check_disk(s: Settings) -> Check:
    try:
        Path(s.cache_dir).mkdir(parents=True, exist_ok=True)
        free = shutil.disk_usage(Path(s.cache_dir)).free
    except OSError as exc:
        return Check("disk", FAIL, "The cache folder is not usable.", redact(str(exc)), "Set VBEAT_CACHE_DIR to a writable folder.")
    gb = free / 1e9
    if gb < 0.3:
        return Check("disk", FAIL, f"Only {gb:.2f} GB of disk is free.", "Rendering writes video and frames.", "Free some space or use a bigger disk.", {"free_gb": round(gb, 2)})
    if gb < 2:
        return Check("disk", WARN, f"Only {gb:.1f} GB of disk is free.", "Several beats in parallel need room for video and frames.", "Free some space.", {"free_gb": round(gb, 2)})
    return Check("disk", OK, f"{gb:.0f} GB of disk is free.", data={"free_gb": round(gb, 1)})


async def _check_ffmpeg() -> Check:
    missing = [t for t in ("ffmpeg", "ffprobe") if not shutil.which(t)]
    if missing:
        return Check("ffmpeg", FAIL, f"{' and '.join(missing)} not found.", "Videos cannot be assembled or verified without it.",
                     "Install ffmpeg on the host (agent/scripts/bootstrap.sh does this where it can).")
    r = await asyncio.to_thread(subprocess.run, ["ffmpeg", "-version"], capture_output=True, text=True, timeout=20)
    return Check("ffmpeg", OK if r.returncode == 0 else FAIL, (r.stdout.splitlines() or ["ffmpeg"])[0][:80] if r.returncode == 0 else "ffmpeg does not run.",
                 "" if r.returncode == 0 else redact(r.stderr[-200:]), "" if r.returncode == 0 else "Reinstall ffmpeg.")


async def _check_chromium() -> Check:
    from .toolrun import tool_env
    code = "from playwright.sync_api import sync_playwright as s\np=s().start()\nb=p.chromium.launch()\nv=b.version\nb.close()\np.stop()\nprint(v)"
    t0 = time.monotonic()
    try:
        r = await asyncio.to_thread(subprocess.run, [sys.executable, "-c", code], capture_output=True, text=True, timeout=90, env=tool_env())
    except subprocess.TimeoutExpired:
        return Check("chromium", FAIL, "Chromium did not start within 90 seconds.", "The machine is overloaded or the browser is broken.",
                     "Restart the host and run selftest. If it repeats, give the host more memory.")
    if r.returncode != 0:
        tail = redact((r.stderr or r.stdout).strip().splitlines()[-1] if (r.stderr or r.stdout).strip() else "no output")[:200]
        return Check("chromium", FAIL, "Chromium cannot start.", tail, "Run agent/scripts/bootstrap.sh (it installs the browser), or run `playwright install chromium` on the host.")
    return Check("chromium", OK, f"Chromium {r.stdout.strip()} starts ({time.monotonic() - t0:.1f} s).")


def _check_assets_and_prompt(s: Settings) -> list[Check]:
    from .prompts import PromptBuildError, build_system_prompt
    try:
        text, parts = build_system_prompt(s, "technical", True)
    except (PromptBuildError, OSError, ValueError, KeyError) as exc:
        return [Check("prompt", FAIL, "The system prompt cannot be built.", redact(str(exc))[:300],
                      "The repo's documents or the asset index are missing or changed. Check that the checkout is complete (git status) and run bootstrap.")]
    return [Check("prompt", OK, f"The system prompt builds ({len(text) // 1000} k characters from the repo's own docs).", data={"chars": len(text), "sections": dict(parts)})]


async def _check_key_and_credits(s: Settings, client: Any) -> Check:
    from .llm_types import LLMAuthError, LLMError
    try:
        st = await client.key_status()
    except LLMAuthError as exc:
        return _from_explained("openrouter_key", "llm_auth", str(exc), http_status=exc.status)
    except LLMError as exc:
        return Check("openrouter_key", WARN, "Could not reach OpenRouter to check the key.", redact(str(exc))[:200],
                     "Check the host's outbound network access to openrouter.ai, then run preflight again.")
    data = {k: v for k, v in st.items()}
    rem = st.get("limit_remaining")
    if rem is not None and rem <= 0:
        return Check("openrouter_key", FAIL, "OpenRouter says this key has no credit left.", "The key's spending limit is used up.",
                     "Raise the key's limit or add credits at openrouter.ai, then run preflight again.", data)
    if rem is not None and rem < 1.0:
        return Check("openrouter_key", WARN, f"Only ${rem:.2f} is left on this key.", "A single beat may spend up to ${:.2f}.".format(s.max_usd_per_beat),
                     "Add credits at openrouter.ai/credits.", data)
    if st.get("is_free_tier"):
        return Check("openrouter_key", WARN, "The key is on OpenRouter's free tier.", "Free-tier keys have tight daily limits and few usable models.",
                     "Add credits at openrouter.ai/credits for reliable runs.", data)
    extra = f" (${rem:.2f} of its limit left)" if rem is not None else " (no spending limit set on the key itself)"
    return Check("openrouter_key", OK, "OpenRouter accepts the key" + extra + ".", data=data)


async def _check_model(model: str | None, client: Any) -> Check:
    from .llm_types import LLMError
    if not model:
        return Check("model", WARN, "No model is chosen yet.", "VBEAT_BEAT_MODEL is not set and none was given to preflight.",
                     "Set VBEAT_BEAT_MODEL (or pass the model with each beat) to a model id from the models list that supports tool calling.")
    try:
        info = await client.model_info(model)
    except LLMError as exc:
        return Check("model", WARN, f"Could not look up {model}.", redact(str(exc))[:200], "Run preflight again in a minute.")
    if info is None:
        return Check("model", WARN, f"{model} is not in OpenRouter's catalogue.", "The id may be misspelled (or the catalogue could not be fetched).",
                     "Check the id against the models list (`models` command).")
    if not info.supports_tools:
        return _from_explained("model", "model_not_supported", f"{model} does not support tool calling")
    return Check("model", OK, f"{model} is listed and supports tool calling" + (" and images." if info.supports_images else "; it cannot see images, so it will rely on check reports."),
                 data=info.to_dict())


async def preflight_async(settings: Settings | None = None, *, model: str | None = None, network: bool = True, browser: bool = True) -> dict[str, Any]:
    s = settings or load_settings()
    killswitch.configure(s.state_dir)
    checks: list[Check] = [_check_python(), _check_key(s), _check_killswitch(), *_check_state_dir(s)]
    checks.append(await _guarded("daily_ledger", lambda: asyncio.sleep(0, _check_ledger(s))))
    checks.append(_check_disk(s))
    checks.append(await _guarded("ffmpeg", _check_ffmpeg))
    if browser:
        checks.append(await _guarded("chromium", _check_chromium))
    checks += _check_assets_and_prompt(s)
    if network and s.api_key:
        from .openrouter import OpenRouterClient
        client = OpenRouterClient.from_settings(s)
        checks.append(await _guarded("openrouter_key", lambda: _check_key_and_credits(s, client)))
        checks.append(await _guarded("model", lambda: _check_model(model or s.beat_model, client)))
    elif network:
        checks.append(Check("openrouter_key", "skip", "OpenRouter was not contacted (no key set)."))
    return _report("preflight", checks, caps={"per_beat_usd": s.max_usd_per_beat, "per_run_usd": s.max_usd_per_run, "per_day_usd": s.max_usd_per_day})


def preflight(settings: Settings | None = None, **kw: Any) -> dict[str, Any]:
    return _run_sync(preflight_async(settings, **kw))


# ======================================================================= selftest ===========================================

async def _ffprobe(path: Path) -> dict[str, Any]:
    r = await asyncio.to_thread(subprocess.run, ["ffprobe", "-v", "error", "-count_frames", "-show_streams", "-of", "json", str(path)],
                                capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        raise RuntimeError("ffprobe could not read the video: " + redact(r.stderr[-200:]))
    return json.loads(r.stdout)


async def selftest_async(settings: Settings | None = None, *, llm_ping: bool = False, model: str | None = None, keep: bool = False) -> dict[str, Any]:
    """Render the example beat through the real tools. Spends nothing unless `llm_ping` is set (then one call of a few cents at most)."""
    from .beat import BeatRequest
    from .toolrun import Cancelled, Outcome, ToolFault, Toolbox
    s = settings or load_settings()
    killswitch.configure(s.state_dir)
    root = repo_root()
    work = Path(s.cache_dir) / "selftest" / f"{os.getpid()}-{int(time.time())}"
    steps: list[Check] = []
    t_all = time.monotonic()

    def done(name: str, ok: bool, what: str, why: str = "", fix: str = "", **data: Any) -> bool:
        steps.append(Check(name, OK if ok else FAIL, what, why, fix, data))
        return ok

    fixes = "Run preflight; if it is clean, the host is under-provisioned or broken: restart it, and make sure it has enough memory for Chromium (about 1 GB per parallel beat)."
    try:
        if killswitch.engaged():
            steps.append(_from_explained("kill_switch", "kill_switch", killswitch.engaged() or ""))
            return _report("selftest", steps, spent_usd=0.0, wall_s=0.0)
        beat = work / "beat"
        paths = BeatPaths(beat).ensure()
        ex = root / "examples"
        scene_src, cue_src = ex / "beats" / "big_number" / "scene.js", ex / "beats" / "big_number" / "cue.py"
        req = BeatRequest(beat_dir=beat, transcript=ex / "transcript.json", from_word=0, to_word=8, width=1280, height=720, idx=0, title="selftest")
        box = Toolbox(paths, req, s, None)
        paths.scene.write_text(scene_src.read_text(encoding="utf-8"), encoding="utf-8")
        plan: list[tuple[str, Any]] = [("ingest", box.ingest), ("spec", box.spec), ("check_full", lambda: box.check("full")), ("markers", box.markers),
                                       ("sfx_spec", box.sfx_spec), ("sfx_render", box.sfx_render)]
        for name, fn in plan:
            if name == "sfx_spec":                          # the audio tools read the cue from the beat directory
                paths.cue.write_text(cue_src.read_text(encoding="utf-8"), encoding="utf-8")
            t0 = time.monotonic()
            try:
                r = await fn()
            except (ToolFault, Cancelled) as exc:
                return _stopped(steps, name, exc, fixes, t_all, work, done)
            ms = int((time.monotonic() - t0) * 1000)
            if r.outcome is not Outcome.PASS:
                e = explain("tool_fault:" + name if r.outcome is Outcome.TOOL_FAILED else "checks_failed", r.error_text if r.error else (r.stderr_tail or "")[-300:])
                done(name, False, f"The '{name}' step failed.", (e.why if e else "") + " " + redact((r.error_text if r.error else r.stderr_tail or "")[-300:]), fixes, wall_ms=ms,
                     outcome=r.outcome.name)
                return _report("selftest", steps, spent_usd=0.0, wall_s=round(time.monotonic() - t_all, 1), work_dir=str(work))
            done(name, True, f"'{name}' passed ({ms / 1000:.1f} s).", wall_ms=ms)
        # the full pipeline from versioned copies (it copies scene/cue into the beat dir itself)
        ver = beat / "versions"
        ver.mkdir(exist_ok=True)
        (ver / "scene_001.js").write_text(scene_src.read_text(encoding="utf-8"), encoding="utf-8")
        (ver / "cue_001.py").write_text(cue_src.read_text(encoding="utf-8"), encoding="utf-8")
        spec = read_json(paths.spec, {}) or {}
        dur = (spec["beat"]["f1"] - spec["beat"]["f0"]) / spec["project"]["fps"] if spec else 4.0
        t0 = time.monotonic()
        try:
            r = await box.pipeline(ver / "scene_001.js", ver / "cue_001.py", dur)
        except (ToolFault, Cancelled) as exc:
            return _stopped(steps, "pipeline", exc, fixes, t_all, work, done)
        ms = int((time.monotonic() - t0) * 1000)
        if r.outcome is not Outcome.PASS or not (r.report or {}).get("ok", False):
            done("pipeline", False, "The full render pipeline failed.", redact((r.error_text if r.error else r.stderr_tail or "no details")[-300:]), fixes, wall_ms=ms)
            return _report("selftest", steps, spent_usd=0.0, wall_s=round(time.monotonic() - t_all, 1), work_dir=str(work))
        final = Path(r.artifacts.get("final") or paths.final)
        try:
            streams = {x["codec_type"]: x for x in (await _ffprobe(final))["streams"]}
            v, a = streams.get("video", {}), streams.get("audio", {})
            ok = v.get("codec_name") == "h264" and int(v.get("nb_read_frames", 0)) > 0 and a.get("codec_name") == "aac"
            done("final_video", ok, f"The example beat rendered to a verified video ({v.get('nb_read_frames')} frames, {v.get('codec_name')}/{a.get('codec_name')}) in {ms / 1000:.0f} s." if ok
                 else "The rendered video is not what was expected.", "" if ok else f"video={v.get('codec_name')} audio={a.get('codec_name')}", "" if ok else fixes, wall_ms=ms)
        except (RuntimeError, ValueError, KeyError) as exc:
            done("final_video", False, "The rendered video could not be verified.", redact(str(exc))[:300], fixes)
        spent = 0.0
        if llm_ping:
            c = await _ping(s, model)
            spent = c.data.get("cost_usd") or 0.0
            steps.append(c)
        return _report("selftest", steps, spent_usd=round(spent, 6), wall_s=round(time.monotonic() - t_all, 1))
    except Exception as exc:  # noqa: BLE001
        steps.append(_from_explained("selftest", "internal_error", f"{type(exc).__name__}: {exc}"))
        return _report("selftest", steps, spent_usd=0.0, wall_s=round(time.monotonic() - t_all, 1), work_dir=str(work))
    finally:
        if not keep and all(c.status == OK for c in steps):
            shutil.rmtree(work, ignore_errors=True)


def _stopped(steps: list[Check], name: str, exc: Exception, fixes: str, t_all: float, work: Path, done: Any) -> dict[str, Any]:
    """A tool timed out, crashed or was cancelled (run_tool raises for those): report it as the failing step."""
    from .toolrun import Cancelled
    if isinstance(exc, Cancelled):
        steps.append(_from_explained(name, "kill_switch" if exc.reason == "kill_switch" else "cancel", exc.reason))
    else:
        e = explain("tool_fault:" + name, str(exc))
        done(name, False, e.what if e else f"The '{name}' step failed.", redact(str(exc))[:300], fixes)
    return _report("selftest", steps, spent_usd=0.0, wall_s=round(time.monotonic() - t_all, 1), work_dir=str(work))


async def _ping(s: Settings, model: str | None) -> Check:
    """One tiny paid call that must come back as a tool call: proves the key, the model, the provider and tool calling together."""
    from .llm_types import LLMError
    from .openrouter import OpenRouterClient
    m = model or s.beat_model
    if not s.api_key:
        return _from_explained("model_ping", "no_api_key")
    if not m:
        return Check("model_ping", FAIL, "No model to test.", "VBEAT_BEAT_MODEL is not set and none was given.", "Pass --model or set VBEAT_BEAT_MODEL.")
    led = SpendLedger(s.state_dir, s.max_usd_per_day, s.ledger_tz).bind("selftest", m)
    tok = led.reserve(0.02)
    if tok is None:
        return _from_explained("model_ping", "cap:daily_usd")
    tools = [{"type": "function", "function": {"name": "ping", "description": "Reply by calling this.", "parameters": {
        "type": "object", "properties": {"word": {"type": "string"}}, "required": ["word"]}}}]
    cost = 0.0
    try:
        r = await OpenRouterClient.from_settings(s).chat(model=m, messages=[{"role": "user", "content": "Call the ping tool with word 'ok'."}], tools=tools,
                                                        temperature=0, max_tokens=200)
        cost = r.usage.budget_cost()
        if r.tool_calls and r.tool_calls[0].name == "ping":
            return Check("model_ping", OK, f"{m} answered with a tool call (cost ${cost:.4f}).", data={"cost_usd": cost, "latency_ms": r.latency_ms})
        return Check("model_ping", FAIL, f"{m} answered in text instead of calling the tool.", "It may not follow tool-calling instructions.",
                     "Choose a model that supports tool calling well.", {"cost_usd": cost})
    except LLMError as exc:
        code = {"LLMAuthError": "llm_auth", "ModelNotSupported": "model_not_supported", "LLMBadRequest": "llm_bad_request"}.get(type(exc).__name__, "llm_unavailable")
        return _from_explained("model_ping", code, str(exc), http_status=exc.status)
    finally:
        led.settle(tok, cost)


def selftest(settings: Settings | None = None, **kw: Any) -> dict[str, Any]:
    return _run_sync(selftest_async(settings, **kw))


# ======================================================================= diagnose ============================================

def _tail_jsonl(p: Path, limit: int = 4000) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    try:
        for ln in p.read_text(encoding="utf-8").splitlines()[-limit:]:
            try:
                out.append(json.loads(ln))
            except ValueError:
                pass
    except OSError:
        pass
    return out


def diagnose(beat_dir: "str | Path", settings: Settings | None = None) -> dict[str, Any]:
    """Plain-language findings from one beat's own files. Read-only: safe on a running or crashed beat."""
    s = settings or load_settings()
    paths = BeatPaths(beat_dir)
    checks: list[Check] = []
    if not paths.request.exists():
        checks.append(Check("beat", FAIL, f"{beat_dir} is not a beat directory.", "agent/request.json is missing.", "Check the path; beats are created by run-beat."))
        return _report("diagnose", checks)
    st = StateStore(paths).load()
    vs = VersionStore(paths, StateStore(paths))
    events = _tail_jsonl(paths.events)
    calls = _tail_jsonl(paths.llm_calls)
    status, reason = st["status"], st["status_reason"]
    locked = BeatLock.is_locked(paths)
    info: dict[str, Any] = {"status": status, "reason": reason, "steps": st["steps"], "cost_usd": st["cost_usd"], "wall_s": st["wall_s"], "model": st["model"],
                            "scene_n": st["scene_n"], "sfx_n": st["sfx_n"], "runs": st["runs"], "running_now": locked,
                            "final_video": st["final_video"] if not st["final_stale"] else None}
    # --- where it stands
    if status == "running" and not locked:
        checks.append(Check("state", WARN, "The last run stopped without saying so.", "The process was killed or the host restarted while it was running (the state still says 'running' but nothing holds the beat).",
                            "Continue the beat: it resumes from its saved conversation. Nothing is lost.", info))
    elif status == "running":
        checks.append(Check("state", OK, "The beat is running right now.", data=info))
    elif status == "waiting_user" and reason == "finished":
        checks.append(Check("state", OK, "The beat finished and is waiting for review.", data=info))
    elif status == "waiting_user":
        checks.append(Check("state", OK, "The beat is waiting for your answer.", data={**info, "question": st.get("question")}))
    else:
        e = explain(reason, "", http_status=None)
        if e:
            checks.append(Check("state", FAIL if status == "failed" else WARN, e.what, e.why, e.fix, info))
        else:
            checks.append(Check("state", OK, f"Status: {status}.", data=info))
    # --- the work product
    if st["final_video"] and st["final_stale"]:
        checks.append(Check("final_video", WARN, "The final video is out of date.", "A version was reverted or changed after it was rendered.", "Continue the beat so it can call finish again.", {}))
    elif st["final_video"] and not Path(st["final_video"]).exists():
        checks.append(Check("final_video", FAIL, "The final video file is missing.", "It was deleted or the disk was cleaned.", "Continue the beat so it renders again."))
    rep = st.get("last_report")
    if isinstance(rep, dict) and rep.get("ok") is False:
        txt = " ".join(str(rep.get("text", "")).split())[:300]
        checks.append(Check("last_check", WARN, "The latest check still has errors.", txt or "See the report in the beat folder.",
                            "Continue with a hint about the failing part, or revert to the last version that passed.", {"counts": rep.get("counts")}))
    if st.get("restored_best"):
        checks.append(Check("restored", OK, "The best version was restored after the run stopped.", "Scene/cue files point at the version with the fewest errors.", data=st["restored_best"]))
    # --- the model side
    retried = [c for c in calls if (c.get("attempts") or 1) > 1]
    if retried:
        checks.append(Check("llm_retries", WARN, f"{len(retried)} model call(s) needed retries.", "OpenRouter or the model provider was rate limiting or flaky.",
                            "Harmless if the run finished. If runs keep stopping, try another provider/model."))
    unknown = [c for c in calls if c.get("cost_source") == "unknown"]
    if unknown:
        checks.append(Check("unknown_cost", WARN, f"{len(unknown)} call(s) had no price information.", "OpenRouter did not report a cost; the cap was charged an estimate for them.",
                            "Check actual spend on openrouter.ai/activity."))
    errs: dict[str, int] = {}
    for ev in events:
        if ev.get("type") == "tool_result" and not ev.get("ok"):
            errs[f"{ev.get('name')}:{ev.get('kind')}"] = errs.get(f"{ev.get('name')}:{ev.get('kind')}", 0) + 1
    if errs:
        top = sorted(errs.items(), key=lambda kv: -kv[1])[:4]
        faults = [k for k, _ in top if k.endswith(":tool_fault")]
        checks.append(Check("tool_errors", FAIL if faults else WARN, "Tools reported errors: " + ", ".join(f"{k} x{n}" for k, n in top) + ".",
                            "'model_fault' = the model's work failed a check (normal, it fixes them); 'tool_fault' = the machine failed (Chromium, ffmpeg).",
                            "Run selftest if there are tool_fault entries." if faults else "Usually nothing: the model reads these and fixes them.", {"counts": errs}))
    cap = (st.get("caps") or {}).get("max_usd")
    if cap and st["cost_usd"] >= 0.8 * float(cap):
        checks.append(Check("cost", WARN, f"This beat has used ${st['cost_usd']:.2f} of its ${float(cap):.2f} cap per run.", "Long or stuck conversations use money.", "A shorter, more specific hint usually does better than another long run."))
    # --- consistency
    conv = _tail_jsonl(paths.conversation)
    answered = {m.get("tool_call_id") for m in conv if m.get("role") == "tool"}
    dangling = [c["id"] for m in conv if m.get("role") == "assistant" for c in m.get("tool_calls", []) if c["id"] not in answered]
    if dangling and not locked:
        checks.append(Check("conversation", OK, "The last tool call never got its result.", "The process was stopped in the middle of it.", "Nothing: continuing repairs this automatically."))
    for kind in ("scene", "cue"):
        cur = vs.current_n(kind)
        if cur and not (paths.scene if kind == "scene" else paths.cue).exists():
            checks.append(Check(f"{kind}_file", FAIL, f"{kind}.js's file is missing." if kind == "scene" else "cue.py is missing.", "It was deleted.", "Revert to the version, which restores the file.", {"version": cur}))
    if not any(c.status in (WARN, FAIL) for c in checks) and status not in ("waiting_user",):
        checks.append(Check("all", OK, "Nothing wrong was found."))
    return _report("diagnose", checks, beat=info, last_events=[{"type": e.get("type"), "summary": redact(str(e.get("summary") or e.get("text") or e.get("status") or e.get("reason") or ""))[:120]}
                                                              for e in events[-8:]])
