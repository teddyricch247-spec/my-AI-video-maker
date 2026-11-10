"""The stages, in order. Each stage is one command of vbeat_sprite or vbeat_audio (or an ffprobe check), and each is verified
from its JSON envelope before the next one starts. Nothing here imports Playwright, numpy or ffmpeg bindings."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from vbeat_shared.envelope import Outcome, check_projection, classify, error_obj, make_envelope, validate_check_report, validate_envelope
from vbeat_shared.markers import MARKER_KINDS
from vbeat_shared.timeline import SAMPLE_RATE

REPO = Path(__file__).resolve().parents[3]
DEFAULT_ASSETS = REPO / "motion-assets" / "assets"
STAGES = ("ingest", "spec", "strip", "check", "markers", "video", "sfx_spec", "sfx_render", "mux", "verify")
# Source checkouts are used without installing: put each package's src on the children's PYTHONPATH.
_SRC = [REPO / "shared" / "src", REPO / "engine" / "src", REPO / "audio" / "src"]


class PipelineError(Exception):
    type = "PipelineError"


class StageFailed(Exception):
    def __init__(self, stage: str, outcome: Outcome, message: str):
        super().__init__(message)
        self.stage, self.outcome = stage, outcome


def _env() -> dict:
    e = dict(os.environ)
    e["PYTHONPATH"] = os.pathsep.join([str(p) for p in _SRC if p.is_dir()] + ([e["PYTHONPATH"]] if e.get("PYTHONPATH") else []))
    e["PYTHONDONTWRITEBYTECODE"] = "1"
    return e


def run_tool(module: str, args: list) -> dict:
    """Run `python -m <module> <args>` and return its one-line JSON envelope (validated)."""
    p = subprocess.run([sys.executable, "-m", module, *map(str, args)], capture_output=True, text=True, env=_env())
    lines = [ln for ln in p.stdout.splitlines() if ln.strip()]
    if len(lines) != 1:
        raise PipelineError(f"{module} {args[0]}: stdout must be exactly one JSON line, got {len(lines)} (exit {p.returncode}); stderr: {p.stderr[-400:]}")
    env = json.loads(lines[0])
    problems = validate_envelope(env)
    if problems:
        raise PipelineError(f"{module} {args[0]}: malformed envelope: {problems}")
    return env


def _tail(text: str, n: int = 6) -> str:
    return "\n".join(text.splitlines()[:n])


def stage(results: dict, name: str, module: str, args: list, *, report_must_pass: bool = False) -> dict:
    t0 = time.perf_counter()
    print(f"[{name}] {module.split('_')[-1]} {args[0]} ...", file=sys.stderr, flush=True)
    env = run_tool(module, args)
    outcome = classify(env)
    results[name] = {"ok": outcome is Outcome.PASS, "outcome": outcome.value, "command": env["command"], "artifacts": env["artifacts"],
                     "report": env["report"], "timing_ms": env["timing_ms"], "error": env["error"],
                     "wall_ms": round((time.perf_counter() - t0) * 1000)}
    if outcome in (Outcome.CONTENT_FAULT, Outcome.TOOL_FAILED):
        e = env["error"]
        raise StageFailed(name, outcome, f"{e['type']}: {e['message']}")
    if outcome is Outcome.REPORT_FAILED:
        rep = env["report"]
        raise StageFailed(name, outcome, "report failed:\n" + _tail(rep.get("text", "")))
    return env


def _ffprobe(path: Path) -> dict:
    p = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)], capture_output=True, text=True)
    if p.returncode != 0:
        raise StageFailed("verify", Outcome.TOOL_FAILED, f"ffprobe failed: {p.stderr[-300:]}")
    return json.loads(p.stdout)


def verify_final(final: Path, spec: dict, *, expect_audio: bool, min_peak_db: float = -45.0) -> dict:
    """Final verification of the delivered file, independent of the tools that made it."""
    probe = _ffprobe(final)
    vs = [s for s in probe["streams"] if s["codec_type"] == "video"]
    au = [s for s in probe["streams"] if s["codec_type"] == "audio"]
    fps, frames = spec["project"]["fps"], spec["beat"]["f1"] - spec["beat"]["f0"]
    problems = []
    if len(vs) != 1:
        problems.append(f"expected 1 video stream, found {len(vs)}")
    else:
        v = vs[0]
        if v["codec_name"] != "h264":
            problems.append(f"video codec {v['codec_name']}, expected h264")
        if (v["width"], v["height"]) != (spec["project"]["width"], spec["project"]["height"]):
            problems.append(f"video size {v['width']}x{v['height']} != spec")
        num, den = (int(x) for x in v["avg_frame_rate"].split("/"))
        if den == 0 or num / den != fps:
            problems.append(f"video fps {v['avg_frame_rate']} != {fps}")
        if int(v.get("nb_frames") or -1) != frames:
            problems.append(f"video has {v.get('nb_frames')} frames, the beat has {frames}")
    if expect_audio:
        if len(au) != 1:
            problems.append(f"expected 1 audio stream, found {len(au)}")
        else:
            a = au[0]
            if int(a["sample_rate"]) != SAMPLE_RATE:
                problems.append(f"audio sample rate {a['sample_rate']} != {SAMPLE_RATE}")
            vdur, adur = float(vs[0]["duration"]), float(a["duration"])
            if abs(vdur - adur) > 2.0 / fps + 0.03:    # AAC priming/padding allowance: about one frame plus 30 ms
                problems.append(f"audio duration {adur:.3f}s differs from video {vdur:.3f}s")
    elif au:
        problems.append("a silent render must have no audio stream")
    dec = subprocess.run(["ffmpeg", "-v", "error", "-i", str(final), "-f", "null", "-"], capture_output=True, text=True)
    if dec.returncode != 0 or dec.stderr.strip():
        problems.append(f"decode errors: {dec.stderr.strip()[:200]}")
    peak = None
    if expect_audio and not problems:
        vol = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(final), "-vn", "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True)
        for ln in vol.stderr.splitlines():
            if "max_volume:" in ln:
                peak = float(ln.split("max_volume:")[1].split("dB")[0])
        if peak is None or peak < min_peak_db:
            problems.append(f"the audio track is silent (max volume {peak} dB)")
    if problems:
        raise StageFailed("verify", Outcome.REPORT_FAILED, "; ".join(problems))
    return {"ok": True, "frames": frames, "fps": fps, "size": f"{vs[0]['width']}x{vs[0]['height']}", "audio": expect_audio, "audio_max_db": peak,
            "duration_s": float(probe["format"]["duration"])}


def render_beat(a, width: int, height: int):
    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            raise PipelineError(f"{tool} is not on PATH (render machine requirement)")
    if not a.no_sfx and a.cue is None:
        raise PipelineError("give --cue for the sound effects, or --no-sfx")
    out: Path = a.out
    out.mkdir(parents=True, exist_ok=True)
    scene = out / "scene.js"
    shutil.copyfile(a.scene, scene)               # the beat directory is a self-contained snapshot of what was rendered
    cue = None
    if a.cue is not None and not a.no_sfx:
        cue = out / "cue.py"
        shutil.copyfile(a.cue, cue)
    S, A = "vbeat_sprite", "vbeat_audio"
    res: dict = {}
    t0 = time.perf_counter()
    failed = None
    try:
        stage(res, "ingest", S, ["ingest", "--transcript", a.transcript, "--fps", a.fps, "--out", out])
        spec_args = ["spec", "--transcript", a.transcript, "--fps", a.fps, "--from-word", a.from_word, "--to-word", a.to_word,
                     "--scene", scene, "--assets", a.assets, "--width", width, "--height", height, "--idx", a.idx, "--title", a.title,
                     "--mode", a.mode, "--params", a.params, "--out", out]
        spec_args += ["--allow-blank-start"] if a.allow_blank_start else []
        for k, v in a.media:
            spec_args += ["--media", f"{k}={v}"]
        stage(res, "spec", S, spec_args)
        spec_path = Path(res["spec"]["artifacts"]["spec"])
        spec = json.loads(spec_path.read_text())
        stage(res, "strip", S, ["strip", "--spec", spec_path, "--out", out])
        env = stage(res, "check", S, ["check", "--spec", spec_path, "--level", a.check_level, "--out", out])
        bad = validate_check_report(env["report"])
        if bad:
            raise StageFailed("check", Outcome.TOOL_FAILED, f"check report violates the contract: {bad}")
        env = stage(res, "markers", S, ["markers", "--spec", spec_path, "--out", out])
        markers_path = Path(env["artifacts"]["markers"])
        mk = json.loads(markers_path.read_text())
        mk = mk["markers"] if isinstance(mk, dict) else mk
        bad_kinds = sorted({m["kind"] for m in mk if m["kind"] not in MARKER_KINDS})
        if bad_kinds:
            raise StageFailed("markers", Outcome.TOOL_FAILED, f"marker kinds {bad_kinds} are not in the contract")
        env = stage(res, "video", S, ["video", "--spec", spec_path, "--out", out, "--crf", a.crf, "--preset", a.preset])
        video = Path(env["artifacts"]["video"])
        final = video
        if cue is not None:
            sfx = out / "sfx"
            stage(res, "sfx_spec", A, ["spec", "--beat", spec_path, "--markers", markers_path, "--out", sfx / "spec.json",
                                       "--seed", a.seed, "--peak-dbfs", a.peak_dbfs])
            env = stage(res, "sfx_render", A, ["render", "--spec", sfx / "spec.json", "--cue", cue, "--out", sfx])
            bad = validate_check_report(env["report"])
            if bad:
                raise StageFailed("sfx_render", Outcome.TOOL_FAILED, f"audio report violates the contract: {bad}")
            final = out / "final.mp4"
            stage(res, "mux", A, ["mux", "--video", video, "--wav", env["artifacts"]["wav"], "--out", final])
        t1 = time.perf_counter()
        res["verify"] = {"ok": True, "outcome": "pass", "command": "verify", "artifacts": {"video": str(final)},
                         "report": verify_final(final, spec, expect_audio=cue is not None), "timing_ms": {}, "error": None,
                         "wall_ms": round((time.perf_counter() - t1) * 1000)}
    except StageFailed as e:
        failed = e
        res.setdefault(e.stage, {"ok": False, "outcome": e.outcome.value, "command": e.stage, "artifacts": {}, "report": None,
                                 "timing_ms": {}, "error": error_obj("StageFailed", str(e))})
        res[e.stage]["ok"] = False
        res[e.stage]["outcome"] = e.outcome.value
        res[e.stage]["message"] = str(e)
    summary = {"ok": failed is None, "failed_stage": failed.stage if failed else None, "failure": str(failed) if failed else None,
               "stages": res, "stage_order": [s for s in STAGES if s in res], "final": str(final) if failed is None else None,
               "wall_ms": round((time.perf_counter() - t0) * 1000)}
    (out / "pipeline.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    arts = {"dir": str(out), "pipeline": str(out / "pipeline.json")}
    if failed is None:
        arts["final"] = str(final)
        return make_envelope("render-beat", artifacts=arts, report={k: summary[k] for k in ("ok", "failed_stage", "stage_order", "wall_ms")},
                             timing_ms={"total": summary["wall_ms"]}), 0
    rc = 2 if failed.outcome is Outcome.TOOL_FAILED else 1
    return make_envelope("render-beat", ok=failed.outcome is not Outcome.TOOL_FAILED, artifacts=arts,
                         report={k: summary[k] for k in ("ok", "failed_stage", "failure", "stage_order", "wall_ms")} | {"ok": False},
                         timing_ms={"total": summary["wall_ms"]},
                         error=error_obj("StageFailed", f"{failed.stage}: {failed}") if failed.outcome is Outcome.TOOL_FAILED else None), rc
