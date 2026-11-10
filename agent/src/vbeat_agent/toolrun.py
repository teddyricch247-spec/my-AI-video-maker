"""Subprocess calls to vbeat_sprite / vbeat_audio / vbeat_pipeline and the JSON-envelope handling.

The rules are the ones `vbeat_pipeline.run.run_tool` follows (and `integration/test_agent_seams.py` pins them): run
`python -m <module> <args>`, stdout must be exactly one JSON line, validate it with `vbeat_shared.envelope.validate_envelope`
and read the verdict from `classify` (PASS | REPORT_FAILED | CONTENT_FAULT | TOOL_FAILED), never from the exit code alone.
Differences from the pipeline's helper, all because this runs inside an asyncio loop with many beats at once:

- async (`asyncio.create_subprocess_exec`), with a hard timeout and cancellation; a timed-out or cancelled child is killed
  together with its whole process group (Chromium and ffmpeg are grandchildren);
- every heavy subprocess holds a slot of one global gate (`VBEAT_MAX_HEAVY`) while it runs; time spent waiting for the model
  never holds a slot;
- infrastructure failures raise `ToolFault` instead of returning, so the loop can retry them.
"""
from __future__ import annotations

import asyncio
import json
import os
import signal
import sys
import threading
import time
import weakref
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable

from vbeat_shared.envelope import Outcome, classify, validate_envelope

from . import killswitch
from .config import Settings, repo_root
from .redact import scrub_env
from .state import BeatPaths

SPRITE, AUDIO, PIPELINE = "vbeat_sprite", "vbeat_audio", "vbeat_pipeline"
_SRC_DIRS = ("shared", "engine", "audio", "pipeline")


class ToolFault(Exception):
    """The infrastructure broke (Chromium crashed, ffmpeg missing, a timeout, a malformed envelope). Not the model's fault."""

    def __init__(self, message: str, *, detail: str = ""):
        super().__init__(message)
        self.detail = detail


class ToolTimeout(ToolFault):
    pass


class Cancelled(Exception):
    """The run was cancelled while a tool was running."""

    def __init__(self, reason: str = "cancelled"):
        super().__init__(reason)
        self.reason = reason


class CancelSignal:
    """An asyncio.Event plus an optional sentinel file, with a reason. `run_beat(cancel=...)` accepts a plain Event too."""

    def __init__(self, event: asyncio.Event | None = None, sentinel: Path | None = None):
        self.event = event if event is not None else asyncio.Event()
        self.sentinel = sentinel
        self.reason: str | None = None

    @classmethod
    def wrap(cls, cancel: "asyncio.Event | CancelSignal | None", sentinel: Path | None = None) -> "CancelSignal":
        if isinstance(cancel, CancelSignal):
            if sentinel is not None and cancel.sentinel is None:
                cancel.sentinel = sentinel
            return cancel
        return cls(cancel, sentinel)

    def trip(self, reason: str) -> None:
        if self.reason is None:
            self.reason = reason
        self.event.set()

    def is_set(self) -> bool:
        if self.event.is_set():
            return True
        why = killswitch.engaged()
        if why:
            self.reason = "kill_switch"
            self.event.set()
            return True
        if self.sentinel is not None and self.sentinel.exists():
            if self.reason is None:
                self.reason = "cancel_file"
            return True
        return False

    def why(self) -> str:
        return self.reason or "cancelled"


# ---- the global heavy-subprocess gate ----------------------------------------------------------------------------------

class HeavyGate:
    """At most `limit` heavy subprocesses at once, process-wide. asyncio semaphores are tied to a loop, so one is kept per
    running loop (a process normally has one). `stats()` is the instrumentation the parallelism tests read."""

    def __init__(self, limit: int | None = None):
        self._limit = max(1, limit or max(1, (os.cpu_count() or 2) // 2))
        self._sems: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore]" = weakref.WeakKeyDictionary()
        self._lock = threading.Lock()
        self.current = 0
        self.max_seen = 0
        self.total = 0
        self.waited_s = 0.0

    @property
    def limit(self) -> int:
        return self._limit

    def configure(self, limit: int) -> None:
        with self._lock:
            self._limit = max(1, int(limit))
            self._sems = weakref.WeakKeyDictionary()      # new semaphores are created lazily with the new limit

    def reset_stats(self) -> None:
        with self._lock:
            self.current = self.max_seen = self.total = 0
            self.waited_s = 0.0

    def stats(self) -> dict[str, Any]:
        with self._lock:
            return {"limit": self._limit, "current": self.current, "max_seen": self.max_seen, "total": self.total,
                    "waited_s": round(self.waited_s, 3)}

    def _sem(self) -> asyncio.Semaphore:
        loop = asyncio.get_running_loop()
        with self._lock:
            sem = self._sems.get(loop)
            if sem is None:
                sem = self._sems[loop] = asyncio.Semaphore(self._limit)
            return sem

    def slot(self) -> "_Slot":
        return _Slot(self)


class _Slot:
    def __init__(self, gate: HeavyGate):
        self.gate, self.sem = gate, None

    async def __aenter__(self) -> "_Slot":
        self.sem = self.gate._sem()
        t0 = time.perf_counter()
        await self.sem.acquire()
        g = self.gate
        with g._lock:
            g.waited_s += time.perf_counter() - t0
            g.current += 1
            g.total += 1
            g.max_seen = max(g.max_seen, g.current)
        return self

    async def __aexit__(self, *exc: Any) -> None:
        g = self.gate
        with g._lock:
            g.current -= 1
        self.sem.release()


HEAVY = HeavyGate()

# A test seam: called as fn(proc, module, args) right after a child is spawned (used to kill Chromium mid-check).
_after_spawn: list[Callable[[Any, str, list[str]], Any]] = []


def tool_env(extra: dict[str, str] | None = None) -> dict[str, str]:
    """Source checkouts are used without installing: put each package's src on the child's PYTHONPATH (as the pipeline does)."""
    root = repo_root()
    e = scrub_env(os.environ)             # the model's scene/cue code runs in these children: no secrets in their environment
    paths = [str(root / d / "src") for d in _SRC_DIRS if (root / d / "src").is_dir()]
    e["PYTHONPATH"] = os.pathsep.join(paths + ([e["PYTHONPATH"]] if e.get("PYTHONPATH") else []))
    e["PYTHONDONTWRITEBYTECODE"] = "1"
    if extra:
        e.update(extra)
    return e


@dataclass
class ToolResult:
    env: dict[str, Any]
    outcome: Outcome
    returncode: int
    stderr_tail: str
    wall_ms: int
    argv: list[str] = field(default_factory=list)

    @property
    def report(self) -> dict[str, Any] | None:
        return self.env.get("report")

    @property
    def artifacts(self) -> dict[str, str]:
        return self.env.get("artifacts") or {}

    @property
    def error(self) -> dict[str, Any] | None:
        return self.env.get("error")

    @property
    def error_text(self) -> str:
        e = self.error or {}
        return f"{e.get('type', 'Error')}: {e.get('message', '')}".strip()


def parse_envelope(stdout: str, *, module: str, command: str, returncode: int, stderr: str) -> dict[str, Any]:
    """Exactly one non-empty JSON line, a well-formed envelope; anything else is a ToolFault."""
    lines = [ln for ln in stdout.splitlines() if ln.strip()]
    tail = stderr.strip()[-600:]
    if len(lines) != 1:
        raise ToolFault(f"{module} {command}: expected exactly one JSON line on stdout, got {len(lines)} (exit {returncode})",
                        detail=tail)
    try:
        env = json.loads(lines[0])
    except json.JSONDecodeError as exc:
        raise ToolFault(f"{module} {command}: stdout is not JSON ({exc.msg})", detail=tail) from None
    problems = validate_envelope(env)
    if problems:
        raise ToolFault(f"{module} {command}: malformed envelope: {problems}", detail=tail)
    return env


def _kill_group(proc: asyncio.subprocess.Process) -> None:
    if proc.returncode is not None:
        return
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        try:
            proc.kill()
        except ProcessLookupError:
            pass


def _limit_memory(pid: int, mb: int) -> None:
    if mb <= 0:
        return
    try:
        import resource
        lim = mb * 1024 * 1024
        resource.prlimit(pid, resource.RLIMIT_AS, (lim, lim))
    except (ImportError, OSError, ValueError):
        pass


async def run_tool(module: str, args: Iterable[Any], *, timeout: float, heavy: bool = True,
                   cancel: "CancelSignal | asyncio.Event | None" = None, cwd: Path | None = None,
                   settings: Settings | None = None) -> ToolResult:
    """Run `python -m module args...` and return its validated envelope with the classification.
    Raises ToolFault (infrastructure), ToolTimeout (a ToolFault) or Cancelled."""
    argv = [str(a) for a in args]
    command = argv[0] if argv else "?"
    sig = CancelSignal.wrap(cancel) if cancel is not None else None
    if sig is None:
        sig = CancelSignal()               # even a bare call honours the kill switch
    if sig.is_set():
        raise Cancelled(sig.why())
    if heavy:
        async with HEAVY.slot():
            return await _run(module, argv, command, timeout, sig, cwd, settings)
    return await _run(module, argv, command, timeout, sig, cwd, settings)


async def _run(module: str, argv: list[str], command: str, timeout: float, sig: CancelSignal | None, cwd: Path | None,
               settings: Settings | None) -> ToolResult:
    t0 = time.perf_counter()
    try:
        proc = await asyncio.create_subprocess_exec(
            sys.executable, "-m", module, *argv, stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE, env=tool_env(), cwd=str(cwd) if cwd else None, start_new_session=True)
    except OSError as exc:
        raise ToolFault(f"cannot start {module}: {exc}") from None
    if settings is not None:
        _limit_memory(proc.pid, settings.child_mem_mb)
    comm = asyncio.ensure_future(proc.communicate())
    cancel_wait = asyncio.ensure_future(sig.event.wait()) if sig is not None else None
    try:
        for hook in list(_after_spawn):
            hook(proc, module, argv)
        waiting = {comm} | ({cancel_wait} if cancel_wait else set())
        deadline = time.monotonic() + timeout
        while True:
            # 1 s slices: the kill switch and the CANCEL file are files, so they are polled while the tool runs
            done, _ = await asyncio.wait(waiting, timeout=max(0.0, min(1.0, deadline - time.monotonic())), return_when=asyncio.FIRST_COMPLETED)
            if comm in done:
                out_b, err_b = comm.result()
                break
            if (cancel_wait is not None and cancel_wait in done) or (sig is not None and sig.is_set()):
                _kill_group(proc)
                raise Cancelled(sig.why() if sig else "cancelled")
            if time.monotonic() >= deadline:
                _kill_group(proc)
                raise ToolTimeout(f"{module} {command} did not finish within {timeout:.0f}s and was killed")
    finally:
        _kill_group(proc)                      # no orphan Chromium/ffmpeg, whatever happened above
        for f in (comm, cancel_wait):
            if f is not None and not f.done():
                f.cancel()
        try:
            await asyncio.wait_for(proc.wait(), 5)
        except (asyncio.TimeoutError, ProcessLookupError):
            pass
    stdout, stderr = out_b.decode("utf-8", "replace"), err_b.decode("utf-8", "replace")
    env = parse_envelope(stdout, module=module, command=command, returncode=proc.returncode, stderr=stderr)
    return ToolResult(env=env, outcome=classify(env), returncode=proc.returncode, stderr_tail=stderr.strip()[-600:],
                      wall_ms=round((time.perf_counter() - t0) * 1000), argv=[module, *argv])


# ---- the toolbox: argument building for each stage of the documented sequence -------------------------------------------

class Toolbox:
    """The engine/audio/pipeline commands for one beat directory, with the right flags and timeouts."""

    def __init__(self, paths: BeatPaths, req: Any, settings: Settings, cancel: "CancelSignal | asyncio.Event | None" = None):
        self.paths, self.req, self.settings, self.cancel = paths, req, settings, cancel

    def _t(self, key: str) -> float:
        return float(self.settings.timeouts[key])

    async def _run(self, module: str, args: list[Any], timeout: float) -> ToolResult:
        return await run_tool(module, args, timeout=timeout, cancel=self.cancel, settings=self.settings)

    async def ingest(self) -> ToolResult:
        """Normalise the transcript into the beat directory (`transcript.json`), which every later command then uses."""
        return await self._run(SPRITE, ["ingest", "--transcript", self.req.transcript, "--fps", self.req.fps, "--out", self.paths.dir],
                               self._t("ingest"))

    def _spec_args(self) -> list[Any]:
        r = self.req
        a: list[Any] = ["spec", "--transcript", self.paths.transcript, "--fps", r.fps, "--from-word", r.from_word, "--to-word", r.to_word,
                        "--scene", self.paths.scene, "--assets", self.settings.assets_dir, "--width", r.width, "--height", r.height,
                        "--idx", r.idx, "--title", r.title, "--direction", r.direction, "--mode", r.mode,
                        "--params", json.dumps(r.params or {}), "--out", self.paths.dir]
        for k, v in (r.media or {}).items():
            a += ["--media", f"{k}={v}"]
        return a

    async def spec(self) -> ToolResult:
        return await self._run(SPRITE, self._spec_args(), self._t("spec"))

    async def check(self, level: str, out_dir: Path | None = None) -> ToolResult:
        return await self._run(SPRITE, ["check", "--spec", self.paths.spec, "--level", level, "--out", out_dir or self.paths.dir],
                               self._t("check_full" if level == "full" else "check_fast"))

    async def strip(self, out_dir: Path, times: list[float] | None = None) -> ToolResult:
        a: list[Any] = ["strip", "--spec", self.paths.spec, "--out", out_dir]
        if times:
            a += ["--times", ",".join(f"{t:.4f}" for t in times)]
        return await self._run(SPRITE, a, self._t("strip"))

    async def frames(self, times: list[float], out_dir: Path, size: str = "960x540") -> ToolResult:
        return await self._run(SPRITE, ["frames", "--spec", self.paths.spec, "--times", ",".join(f"{t:.4f}" for t in times),
                                        "--size", size, "--out", out_dir], self._t("frames"))

    async def markers(self) -> ToolResult:
        return await self._run(SPRITE, ["markers", "--spec", self.paths.spec, "--out", self.paths.dir], self._t("markers"))

    async def sfx_spec(self) -> ToolResult:
        args: list[Any] = ["spec", "--beat", self.paths.spec, "--out", self.paths.sfx_spec, "--seed", 0,
                           "--peak-dbfs", self.settings.sfx_peak_dbfs]
        if self.paths.markers.exists():
            args[3:3] = ["--markers", self.paths.markers]
        return await self._run(AUDIO, args, self._t("sfx_spec"))

    async def sfx_render(self) -> ToolResult:
        return await self._run(AUDIO, ["render", "--spec", self.paths.sfx_spec, "--cue", self.paths.cue, "--out", self.paths.sfx],
                               self._t("sfx_render"))

    async def pipeline(self, scene_file: Path, cue_file: Path | None, duration_s: float) -> ToolResult:
        """The full documented render (`--check-level full`). `scene_file` / `cue_file` must NOT be the beat directory's own
        scene.js / cue.py: the pipeline copies them there and would fail on a same-file copy."""
        r = self.req
        a: list[Any] = ["render-beat", "--transcript", self.paths.transcript, "--fps", r.fps, "--from-word", r.from_word, "--to-word", r.to_word,
                        "--scene", scene_file, "--out", self.paths.dir, "--assets", self.settings.assets_dir,
                        "--size", f"{r.width}x{r.height}", "--idx", r.idx, "--title", r.title, "--mode", r.mode,
                        "--params", json.dumps(r.params or {}), "--check-level", "full", "--peak-dbfs", self.settings.sfx_peak_dbfs]
        if cue_file is not None and r.sfx_enabled:
            a += ["--cue", cue_file]
        else:
            a += ["--no-sfx"]
        for k, v in (r.media or {}).items():
            a += ["--media", f"{k}={v}"]
        timeout = self._t("pipeline_base") + self._t("pipeline_per_s") * max(1.0, duration_s)
        return await self._run(PIPELINE, a, timeout)
