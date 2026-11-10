"""The real functions behind every CLI command. Each returns the JSON envelope

{"ok", "command", "artifacts", "report", "timing_ms", "error"}; "ok" means the tool ran, report["ok"] means pass/fail.
"""
from __future__ import annotations

import json
import sys
import tempfile
import time
from pathlib import Path

import numpy as np

from . import analysis, checks, runner
from .constants import DEFAULT_PEAK_DBFS
from .spec import build_spec, load_json, load_spec, validate_spec

REPO = Path(__file__).resolve().parents[2]  # the source checkout (sfx/, tests/, docs/ live next to src/)


def _need_checkout(what):
    if not (REPO / "sfx" / "examples").is_dir():
        raise FileNotFoundError(f"{what} needs the source checkout (sfx/examples next to src/); "
                                f"expected it at {REPO}")


def envelope(command, ok=True, artifacts=None, report=None, timing=None, error=None):
    """Assemble the one JSON object every command prints."""
    return {"ok": ok, "command": command, "artifacts": artifacts or {}, "report": report,
            "timing_ms": timing or {}, "error": error}


def _fail(command, exc, timing=None):
    return envelope(command, ok=False, timing=timing, error={"type": type(exc).__name__, "message": str(exc)})


def _progress(msg):
    print(msg, file=sys.stderr, flush=True)


def _ms(t0):
    return round((time.perf_counter() - t0) * 1000, 1)


def _as_obj(v):
    return load_json(v) if isinstance(v, (str, Path)) else v


# ----------------------------------------------------------------------------- spec
def make_spec(beat, markers=None, out=None, seed=0, peak_dbfs=DEFAULT_PEAK_DBFS):
    """`spec` command: engine beat spec (+ engine markers) -> SFX spec json written to `out`."""
    t0 = time.perf_counter()
    try:
        spec = build_spec(_as_obj(beat), _as_obj(markers) if markers else [], seed, peak_dbfs)
        arts = {}
        if out:
            Path(out).parent.mkdir(parents=True, exist_ok=True)
            Path(out).write_text(json.dumps(spec, indent=1), encoding="utf-8")
            arts["spec"] = str(out)
        return envelope("spec", artifacts=arts, report={"spec": spec}, timing={"total": _ms(t0)})
    except Exception as e:  # noqa: BLE001
        return _fail("spec", e, {"total": _ms(t0)})


# ----------------------------------------------------------------------------- render
def _metrics(final, spec, cues, report, raw_len, res, timing):
    d = analysis.descriptors(final)
    fr = analysis.band_fractions(final)
    names = ["below_50hz", "50_250hz", "250_1khz", "1_4khz", "4_10khz", "above_10khz"]
    return {"duration_s": spec["dur"], "samples": spec["samples"], "fps": spec["fps"], "raw_len": raw_len,
            "peak_dbfs": d["peak_dbfs"], "rms_dbfs": round(20 * np.log10(max(d["rms"], 1e-9)), 2),
            "centroid_hz": d["centroid_hz"], "attack_ms": d["attack_ms"], "decay_ms": d["decay_ms"],
            "band_energy": {n: round(v, 4) for n, v in zip(names, fr)}, "cues": len(cues),
            "findings": report["counts"], "sandbox": res.sandbox, "timing_ms": timing}


def render(spec, cue, out, preview=True, wall_timeout=runner.WALL_TIMEOUT_S, cpu_limit=runner.CPU_LIMIT_S,
           mem_limit=runner.MEM_LIMIT_BYTES, source=None):
    """`render` command: run a cue script (path `cue`, or text via `source`) against an SFX spec; write sfx.wav,
    sfx_preview.jpg, cues.json, metrics.json into the directory `out`."""
    from . import preview as pv
    T0 = time.perf_counter()
    timing = {}
    try:
        spec = validate_spec(_as_obj(spec))
        if source is None:
            source = Path(cue).read_text(encoding="utf-8")
        outd = Path(out)
        outd.mkdir(parents=True, exist_ok=True)
        _progress("running cue script in sandbox ...")
        res = runner.run_cue(source, spec, wall_timeout, cpu_limit, mem_limit)
        timing.update(res.timing_ms)
        extra = {}
        if res.stdout:
            extra["stdout"] = res.stdout
        if res.raw is None:
            rep = checks.make_report(res.findings)
            rep.update(extra)
            timing["total"] = _ms(T0)
            return envelope("render", artifacts={}, report=rep, timing=timing)
        t1 = time.perf_counter()
        fixed = runner.fix_length(res.raw, spec["samples"])
        rep = checks.run_checks(fixed, spec, res.cues, res.raw_len)
        timing["checks"] = _ms(t1)
        arts = {}
        blocked = any(f["id"] == "A2" and f["severity"] == "error" for f in rep["findings"])
        if not blocked:
            t1 = time.perf_counter()
            final, pcm, more = runner.finalize(fixed, spec)
            if more:
                rep = checks.make_report(rep["findings"] + more)
            runner.write_wav(outd / "sfx.wav", pcm)
            arts["wav"] = str(outd / "sfx.wav")
            timing["finalize"] = _ms(t1)
            if preview:
                t1 = time.perf_counter()
                pv.render_preview(pcm.astype(np.float64) / 32768.0, spec, res.cues, outd / "sfx_preview.jpg")
                arts["preview"] = str(outd / "sfx_preview.jpg")
                timing["preview"] = _ms(t1)
            timing["total"] = _ms(T0)
            (outd / "metrics.json").write_text(json.dumps(_metrics(final, spec, res.cues, rep, res.raw_len, res, timing),
                                                          indent=1), encoding="utf-8")
            arts["metrics"] = str(outd / "metrics.json")
        (outd / "cues.json").write_text(json.dumps(res.cues, indent=1), encoding="utf-8")
        arts["cues"] = str(outd / "cues.json")
        rep.update(extra)
        timing["total"] = _ms(T0)
        return envelope("render", artifacts=arts, report=rep, timing=timing)
    except Exception as e:  # noqa: BLE001
        timing["total"] = _ms(T0)
        return _fail("render", e, timing)


# ----------------------------------------------------------------------------- mux
def mux(video, wav, out, codec="aac"):
    """`mux` command: copy the video stream, add the wav as stereo audio, verify with ffprobe."""
    from . import mux as _mux
    t0 = time.perf_counter()
    try:
        summary = _mux.mux(video, wav, out, codec)
        return envelope("mux", artifacts={"video": str(out)}, report={"ok": True, **summary}, timing={"total": _ms(t0)})
    except Exception as e:  # noqa: BLE001
        return _fail("mux", e, {"total": _ms(t0)})


# ----------------------------------------------------------------------------- catalog / docs / selftest
def catalog(out):
    """`catalog` command: render every recipe and example, write demo material and demo/audition.html."""
    from . import catalog as _cat
    t0 = time.perf_counter()
    try:
        arts, rep = _cat.build_catalog(out, progress=_progress)
        return envelope("catalog", artifacts=arts, report=rep, timing={"total": _ms(t0)})
    except Exception as e:  # noqa: BLE001
        return _fail("catalog", e, {"total": _ms(t0)})


def docs(out=None, check=False):
    """`docs` command: generate sfx/SYNTH_API.md from the docstrings; with check=True only compare to the file."""
    from . import docs as _docs
    t0 = time.perf_counter()
    try:
        if not out:
            _need_checkout("docs without --out")
        path = Path(out) if out else REPO / "sfx" / "SYNTH_API.md"
        text = _docs.generate()
        n = text.count("\n")
        if check:
            current = path.read_text(encoding="utf-8") if path.exists() else ""
            fresh = current == text
            rep = {"ok": fresh, "counts": {"error": 0 if fresh else 1, "warn": 0}, "findings": [],
                   "text": "SYNTH_API.md is up to date" if fresh else
                   f"{path} is stale; run: python -m vbeat_audio docs"}
            return envelope("docs", artifacts={"docs": str(path)}, report=rep, timing={"total": _ms(t0)})
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return envelope("docs", artifacts={"docs": str(path)}, report={"ok": True, "lines": n}, timing={"total": _ms(t0)})
    except Exception as e:  # noqa: BLE001
        return _fail("docs", e, {"total": _ms(t0)})


def selftest():
    """`selftest` command: spec -> render all examples -> bad cue -> mux aac/pcm, end to end on the fixtures."""
    import subprocess

    T0 = time.perf_counter()
    steps = []

    def step(name, ok, msg):
        steps.append(checks.mk_finding("SELFTEST", "info" if ok else "error", None, f"{name}: {msg}", {"step": name}))
        _progress(f"[{'ok' if ok else 'FAIL'}] {name}: {msg}")

    try:
        ex_dir, fx = REPO / "sfx" / "examples", REPO / "tests" / "fixtures"
        _need_checkout("selftest")
        if not fx.is_dir():
            raise FileNotFoundError(f"selftest needs tests/fixtures at {fx}")
        names = sorted(p.stem for p in ex_dir.glob("*.py"))
        with tempfile.TemporaryDirectory(prefix="vbeat_selftest_") as tmp:
            tmp = Path(tmp)
            for n in names:
                eng = fx / "engine"
                s = build_spec(load_json(eng / f"{n}.beat.json"), load_json(eng / f"{n}.markers.json"))
                same = s == load_spec(fx / "specs" / f"{n}.json")
                step(f"spec {n}", same, f"{s['samples']} samples" if same else "differs from tests/fixtures/specs")
            first_wav = None
            first_frames = None
            for n in names:
                env = render(fx / "specs" / f"{n}.json", ex_dir / f"{n}.py", tmp / n)
                rep = env["report"] or {}
                clean = env["ok"] and rep.get("counts") == {"error": 0, "warn": 0}
                step(f"render {n}", clean, f"{env['timing_ms'].get('total')} ms" if clean else (rep.get("text") or env["error"]))
                if clean and first_wav is None:
                    first_wav, first_frames = env["artifacts"]["wav"], load_spec(fx / "specs" / f"{n}.json")
            bad = render(fx / "specs" / "base5.json", fx / "bad" / "a0_import_os.py", tmp / "bad")
            ids = {f["id"] for f in (bad["report"] or {}).get("findings", [])}
            step("bad cue rejected", ids == {"A0"} and not bad["report"]["ok"], f"findings {sorted(ids)}")
            if first_wav:
                spec0 = first_frames
                vid = tmp / "in.mp4"
                r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc=size=320x240:rate={spec0['fps']}",
                                    "-frames:v", str(spec0["frames"]), "-c:v", "libx264", "-pix_fmt", "yuv420p", str(vid)],
                                   capture_output=True, text=True)
                step("make test video", r.returncode == 0, r.stderr.strip()[-120:] or f"{spec0['frames']} frames")
                for codec, ext in (("aac", "mp4"), ("pcm_mov", "mov")):
                    m = mux(vid, first_wav, tmp / f"out_{codec}.{ext}", codec)
                    step(f"mux {codec}", m["ok"], f"av diff {m['report']['av_diff_s']:+.4f}s" if m["ok"] else m["error"]["message"])
        total = time.perf_counter() - T0
        step("time budget", total < 30.0, f"{total:.1f} s (limit 30 s)")
    except Exception as e:  # noqa: BLE001
        step("selftest", False, f"{type(e).__name__}: {e}")
    rep = checks.make_report(steps)
    return envelope("selftest", report=rep, timing={"total": _ms(T0)})
