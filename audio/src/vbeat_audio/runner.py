"""Sandboxed cue runner: static AST check, child process with limits, output rules, wav writing.

Defence in depth for LLM-written code, NOT a security boundary (see docs/DECISIONS.md).
"""
from __future__ import annotations

import ast
import functools
import json
import os
import re
import resource
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import wave
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .checks import mk_finding
from .constants import (ALLOWED_IMPORTS, ALLOWED_SCIPY_SUBMODULES, CPU_LIMIT_S, FADE_MS, FORBIDDEN_ATTRS,
                        FORBIDDEN_NAMES, FSIZE_LIMIT_BYTES, MAX_SOURCE_BYTES, MEM_LIMIT_BYTES, NOFILE_LIMIT, SR,
                        STDIO_CAP, WALL_TIMEOUT_S)

CHILD = Path(__file__).with_name("_child.py")
PKG_PARENT = str(Path(__file__).resolve().parent.parent)
MAX_STATIC_FINDINGS = 10


@dataclass
class RunResult:
    """Outcome of one cue run. raw is None when the script failed (findings then hold A0)."""
    raw: object = None
    raw_len: int = 0
    cues: list = field(default_factory=list)
    findings: list = field(default_factory=list)
    stdout: str = ""
    stderr: str = ""
    timing_ms: dict = field(default_factory=dict)
    sandbox: dict = field(default_factory=dict)


# ----------------------------------------------------------------------------- static check
def _a0(line, col, msg, src_lines, kind):
    src = src_lines[line - 1].strip()[:160] if line and 0 < line <= len(src_lines) else ""
    where = f"line {line} col {col}: " if line else ""
    tail = f" | source: {src}" if src else ""
    return mk_finding("A0", "error", None, f"{where}{msg}{tail}", {"line": line, "col": col, "source": src, "kind": kind})


class _Checker(ast.NodeVisitor):
    def __init__(self, src_lines):
        self.lines = src_lines
        self.findings = []
        self.np_aliases = {"numpy", "np"}

    def bad(self, node, msg, kind):
        self.findings.append(_a0(node.lineno, node.col_offset, msg, self.lines, kind))

    def visit_Import(self, node):
        for a in node.names:
            if a.name not in ALLOWED_IMPORTS:
                self.bad(node, f"import of '{a.name}' is not allowed; allowed: {', '.join(ALLOWED_IMPORTS)}", "import")
            elif a.name == "numpy" and a.asname:
                self.np_aliases.add(a.asname)

    def visit_ImportFrom(self, node):
        mod = node.module or ""
        if node.level:
            self.bad(node, "relative imports are not allowed", "import")
            return
        if mod not in ALLOWED_IMPORTS:
            self.bad(node, f"import from '{mod}' is not allowed; allowed: {', '.join(ALLOWED_IMPORTS)}", "import")
            return
        for a in node.names:
            n = a.name
            if n == "*":
                if mod == "numpy":
                    self.bad(node, "'from numpy import *' is not allowed; use 'import numpy as np'", "import")
            elif mod == "scipy" and n not in ALLOWED_SCIPY_SUBMODULES:
                self.bad(node, f"'from scipy import {n}' is not allowed; only {', '.join(ALLOWED_SCIPY_SUBMODULES)}", "import")
            elif n == "random" and mod.startswith("numpy"):
                self.bad(node, "numpy.random is not allowed; use ctx.rng(label) or the seeded synth functions", "random")
            elif n in FORBIDDEN_ATTRS or (n.startswith("__") and n.endswith("__")):
                self.bad(node, f"importing '{n}' is not allowed", "import")
            if a.asname and mod == "numpy":
                self.np_aliases.add(a.asname)

    def visit_Name(self, node):
        if node.id in FORBIDDEN_NAMES:
            self.bad(node, f"use of '{node.id}' is not allowed in cue scripts", "name")
        elif node.id.startswith("__") and node.id.endswith("__"):
            self.bad(node, f"access to dunder name '{node.id}' is not allowed", "dunder")

    def visit_Attribute(self, node):
        a = node.attr
        if a.startswith("__") and a.endswith("__"):
            self.bad(node, f"access to dunder attribute '{a}' is not allowed", "dunder")
        elif a in FORBIDDEN_ATTRS:
            hint = " (use an f-string instead)" if a in ("format", "format_map") else ""
            self.bad(node, f"attribute '.{a}' is not allowed in cue scripts{hint}", "attribute")
        elif a == "random" and isinstance(node.value, ast.Name) and node.value.id in self.np_aliases:
            self.bad(node, "numpy.random is not allowed; use ctx.rng(label) or the seeded synth functions", "random")
        self.generic_visit(node)

    def visit_Call(self, node):
        f = node.func
        if isinstance(f, ast.Name) and f.id in ("getattr", "setattr", "delattr"):
            arg = node.args[1] if len(node.args) > 1 else None
            if not (isinstance(arg, ast.Constant) and isinstance(arg.value, str)):
                self.bad(node, f"{f.id}() needs a literal attribute name", "getattr")
            else:
                n = arg.value
                if (n.startswith("__") and n.endswith("__")) or n in FORBIDDEN_ATTRS or \
                        (n == "random" and node.args and isinstance(node.args[0], ast.Name) and node.args[0].id in self.np_aliases):
                    self.bad(node, f"{f.id}(..., '{n}') is not allowed", "getattr")
        self.generic_visit(node)


def static_check(source: str) -> list:
    """AST check of a cue script. Returns A0 findings with line and column (empty list when clean)."""
    lines = source.splitlines()
    if len(source.encode("utf-8")) > MAX_SOURCE_BYTES:
        return [mk_finding("A0", "error", None, f"cue source is {len(source.encode('utf-8'))} bytes; the limit is "
                           f"{MAX_SOURCE_BYTES} bytes", {"kind": "size"})]
    try:
        tree = ast.parse(source, filename="cue.py")
    except SyntaxError as e:
        return [_a0(e.lineno or 0, (e.offset or 1) - 1, f"SyntaxError: {e.msg}", lines, "syntax")]
    ck = _Checker(lines)
    ck.visit(tree)
    out = ck.findings
    if len(out) > MAX_STATIC_FINDINGS:
        out = out[:MAX_STATIC_FINDINGS] + [mk_finding("A0", "error", None, f"... and {len(ck.findings) - MAX_STATIC_FINDINGS} more", {})]
    return out


# ----------------------------------------------------------------------------- process sandbox
def _scrubbed_env(cwd):
    return {"PATH": "/usr/bin:/bin", "HOME": cwd, "TMPDIR": cwd, "LANG": "C.UTF-8", "OPENBLAS_NUM_THREADS": "1",
            "OMP_NUM_THREADS": "1", "MKL_NUM_THREADS": "1", "NUMEXPR_NUM_THREADS": "1"}


@functools.lru_cache(maxsize=1)
def sandbox_info() -> dict:
    """Probe once whether `unshare` can give the child a new network namespace (falls back gracefully)."""
    exe = shutil.which("unshare")
    if exe:
        for flag in ("-n", "-rn"):
            try:
                r = subprocess.run([exe, flag, "--", "true"], capture_output=True, timeout=5)
            except (OSError, subprocess.SubprocessError):
                continue
            if r.returncode == 0:
                return {"netns": True, "unshare": exe, "flag": flag}
    return {"netns": False, "unshare": exe, "flag": None}


def _limits(cpu_s, mem_bytes):
    def apply():
        for res, val in ((resource.RLIMIT_CPU, (cpu_s, cpu_s + 1)), (resource.RLIMIT_AS, (mem_bytes, mem_bytes)),
                         (resource.RLIMIT_FSIZE, (FSIZE_LIMIT_BYTES, FSIZE_LIMIT_BYTES)),
                         (resource.RLIMIT_NOFILE, (NOFILE_LIMIT, NOFILE_LIMIT)), (resource.RLIMIT_CORE, (0, 0))):
            try:
                resource.setrlimit(res, val)
            except (ValueError, OSError):  # best effort: not every OS supports every limit (macOS has no RLIMIT_AS)
                pass
    return apply


def _cue_line(stderr):
    m = re.search(r'File "cue\.py", line (\d+)', stderr or "")
    return int(m.group(1)) if m else None


def _a0_run(msg, line, src_lines, kind, data=None):
    f = _a0(line, 0, msg, src_lines, kind)
    if not line:
        f["message"] = msg
    f["data"].update(data or {})
    return f


def run_cue(source: str, spec: dict, wall_timeout: float = WALL_TIMEOUT_S, cpu_limit: int = CPU_LIMIT_S,
            mem_limit: int = MEM_LIMIT_BYTES) -> RunResult:
    """Static-check then run a cue script in the sandboxed child. Always returns a RunResult (never raises for cue errors)."""
    res = RunResult(sandbox=dict(sandbox_info()))
    t0 = time.perf_counter()
    res.findings = static_check(source)
    res.timing_ms["static"] = round((time.perf_counter() - t0) * 1000, 1)
    if res.findings:
        return res
    lines = source.splitlines()
    tmp = tempfile.mkdtemp(prefix="vbeat_cue_")
    try:
        cwd, ind, outd = (os.path.join(tmp, d) for d in ("work", "in", "out"))
        for d in (cwd, ind, outd):
            os.mkdir(d)
        Path(ind, "cue.py").write_text(source, encoding="utf-8")
        Path(ind, "spec.json").write_text(json.dumps(spec), encoding="utf-8")
        cmd = [sys.executable, "-I", str(CHILD), PKG_PARENT, ind, outd, str(wall_timeout)]
        if res.sandbox["netns"]:
            cmd = [res.sandbox["unshare"], res.sandbox["flag"], "--"] + cmd
        t1 = time.perf_counter()
        proc = subprocess.Popen(cmd, cwd=cwd, env=_scrubbed_env(cwd), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, start_new_session=True, preexec_fn=_limits(cpu_limit, mem_limit))
        timed_out = False
        try:
            out, err = proc.communicate(timeout=wall_timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except OSError:
                pass
            out, err = proc.communicate()
        res.timing_ms["child"] = round((time.perf_counter() - t1) * 1000, 1)
        err_s = err.decode("utf-8", "replace")
        res.stdout, res.stderr = out.decode("utf-8", "replace")[:STDIO_CAP], err_s[:STDIO_CAP]
        res.findings = _collect(res, proc.returncode, timed_out, outd, err_s, lines, wall_timeout, cpu_limit, mem_limit)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return res


def _collect(res, rc, timed_out, outd, err_s, lines, wall, cpu, mem):
    errp, resp = Path(outd, "error.json"), Path(outd, "result.json")
    line = _cue_line(err_s)
    if timed_out:
        return [_a0_run(f"cue script exceeded the {wall:g}s wall-clock limit (infinite loop or very heavy DSP?)"
                        + (f"; it was running line {line}" if line else ""), line, lines, "timeout")]
    if errp.exists():
        e = json.loads(errp.read_text())
        res.stdout = (e.get("stdout") or "")[:STDIO_CAP]
        trace = " -> ".join(f"line {t['line']} in {t['func']}" for t in e.get("trace", [])[-4:])
        msg = f"{e['type']}: {e['message']}" + (f" (call path: {trace})" if len(e.get("trace", [])) > 1 else "")
        f = _a0(e.get("line") or 0, 0, msg, lines, "exception")
        if not e.get("line"):
            f["message"] = msg
        f["data"]["type"] = e["type"]
        return [f]
    if rc == 0 and resp.exists():
        r = json.loads(resp.read_text())
        try:
            arr = np.load(Path(outd, "out.npy"), allow_pickle=False)
        except Exception as ex:  # noqa: BLE001
            return [_a0_run(f"could not read the child's output array: {ex}", None, lines, "output")]
        if arr.dtype.kind != "f" or arr.ndim != 1:
            return [_a0_run(f"output must be a 1-D float array, got dtype {arr.dtype} shape {arr.shape}", None, lines, "output")]
        res.raw, res.raw_len, res.cues = arr.astype(np.float64), int(r["raw_len"]), r["cues"]
        res.stdout = (r.get("stdout") or "")[:STDIO_CAP]
        return []
    if rc is not None and rc < 0:
        sig = -rc
        name = signal.Signals(sig).name if sig in signal.Signals._value2member_map_ else str(sig)
        why = {signal.SIGKILL: "killed, most likely by the memory limit "
                               f"({mem // (1 << 20)} MB) or the wall-clock limit",
               signal.SIGXCPU: f"CPU-time limit of {cpu}s exceeded (infinite loop or very heavy DSP?)",
               signal.SIGXFSZ: "wrote more than the file-size limit",
               signal.SIGSEGV: "crashed (segmentation fault, often memory exhaustion)"}.get(sig, "terminated by a signal")
        return [_a0_run(f"cue script process {why} [{name}]" + (f"; it was running line {line}" if line else ""),
                        line, lines, "killed", {"signal": name})]
    tail = err_s.strip().splitlines()[-1] if err_s.strip() else "no output"
    return [_a0_run(f"sandbox child failed (exit code {rc}): {tail[:200]}", None, lines, "child")]


# ----------------------------------------------------------------------------- output rules
def fix_length(raw, samples):
    """Pad with zeros or trim to exactly `samples`; returns float64."""
    x = np.asarray(raw, dtype=np.float64)
    if len(x) > samples:
        return x[:samples]
    if len(x) < samples:
        return np.pad(x, (0, samples - len(x)))
    return x


def finalize(x, spec):
    """Output rules on a finite, length-fixed array: DC removal if |mean|>1e-3, 5 ms fades, peak normalise, int16.

    Returns (float64 audio, int16 pcm, findings). The peak equals spec['peak_dbfs'] (sample peak).
    """
    findings = []
    x = np.array(x, dtype=np.float64)
    mean = float(x.mean())
    if abs(mean) > 1e-3:
        x -= mean
        findings.append(mk_finding("A10", "warn", None, f"DC offset {mean:+.4f} removed; high-pass or balance your "
                                   "sources", {"mean": mean}))
    m = min(int(FADE_MS * SR / 1000), len(x) // 2)
    if m > 0:
        ramp = np.arange(m) / m
        x[:m] *= ramp
        x[-m:] *= ramp[::-1]
    pk = float(np.abs(x).max())
    if pk > 0:
        x *= 10 ** (spec["peak_dbfs"] / 20.0) / pk
    pcm = np.round(np.clip(x * 32767.0, -32768, 32767)).astype("<i2")
    return x, pcm, findings


def write_wav(path, pcm):
    """Write 16-bit PCM mono 48 kHz wav with exactly len(pcm) frames (deterministic bytes)."""
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(np.asarray(pcm, dtype="<i2").tobytes())
