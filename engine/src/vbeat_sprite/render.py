"""Operations that render a beat: strip, frames, markers (video and bench are added below)."""
from __future__ import annotations

import base64
import time
from pathlib import Path
from typing import Any, Sequence

from vbeat_shared.timeline import LOGICAL

from .browser import BrowserSession, ScenePage
from .spec import BeatSpec, parse_size

MAX_STRIP_TILES = 6
JPEG_QUALITY = 85


def last_time(spec: BeatSpec) -> float:
    return (spec.frames - 1) / spec.fps


def snap_times(spec: BeatSpec, times: Sequence[float]) -> list[float]:
    """Snap to the frame grid. Out-of-range times raise ValueError (silent clamping hides mistakes)."""
    out = []
    top = last_time(spec)
    for t in times:
        if not (-1e-9 <= float(t) <= top + 1e-9):
            raise ValueError(f"time {t}s is outside this beat: valid range is 0..{top:.3f}s ({spec.frames} frames)")
        out.append(min(spec.frames - 1, max(0, int(float(t) * spec.fps + 0.5))) / spec.fps)
    return out


def default_strip_times(spec: BeatSpec) -> list[float]:
    """0.4 s, 25 % and 60 % of the duration, and the last frame (snapped, de-duplicated, ascending)."""
    top = last_time(spec)
    raw = [min(0.4, top), spec.duration * 0.25, spec.duration * 0.6, top]
    snapped = sorted({min(spec.frames - 1, max(0, int(t * spec.fps + 0.5))) for t in raw})
    return [f / spec.fps for f in snapped]


def _open(session: BrowserSession, spec: BeatSpec) -> ScenePage:
    page = session.new_page()
    page.init()
    return page


def _write(path: Path, b64: str) -> str:
    path.write_bytes(base64.b64decode(b64))
    return str(path)


def strip(spec: BeatSpec, times: Sequence[float] | None, out_dir: Path, png: bool = False,
          session: BrowserSession | None = None) -> dict[str, Any]:
    """Contact sheet: 2x2 for 4 tiles, 3x2 for 5-6, each tile 640x360 labelled with seconds and frame."""
    out_dir.mkdir(parents=True, exist_ok=True)
    t_list = snap_times(spec, times) if times else default_strip_times(spec)
    if not 1 <= len(t_list) <= MAX_STRIP_TILES:
        raise ValueError(f"strip takes 1..{MAX_STRIP_TILES} times, got {len(t_list)}")
    t0 = time.perf_counter()

    def run(s: BrowserSession) -> dict[str, Any]:
        page = _open(s, spec)
        res = page.ok("strip", {"times": t_list, "tileW": 640, "format": "jpeg", "quality": JPEG_QUALITY})
        artifacts = {"strip": _write(out_dir / "strip.jpg", res["data"])}
        size = (res["width"], res["height"])
        if png:
            artifacts["strip_png"] = _write(out_dir / "strip.png", page.ok("strip", {"times": t_list, "tileW": 640, "format": "png"})["data"])
        return {"artifacts": artifacts, "times": t_list, "size": list(size), "events": list(s.events)}

    if session is not None:
        result = run(session)
    else:
        with BrowserSession(spec) as s:
            result = run(s)
    result["timing_ms"] = {"render": round((time.perf_counter() - t0) * 1000)}
    return result


def _frame_scale(size: str | tuple[int, int] | None) -> tuple[int, int, float]:
    w, h = parse_size(size) if size is not None else LOGICAL
    if w * 9 != h * 16 or not (16 <= w <= LOGICAL[0]):
        raise ValueError(f"frame size must be 16:9 and at most {LOGICAL[0]} wide (e.g. 960x540), got {w}x{h}")
    if round(LOGICAL[0] * (w / LOGICAL[0])) != w:
        raise ValueError(f"frame size {w}x{h} is not representable")
    return w, h, w / LOGICAL[0]


def frames(spec: BeatSpec, times: Sequence[float], out_dir: Path, size: str | tuple[int, int] | None = None,
           fmt: str = "jpeg", session: BrowserSession | None = None) -> dict[str, Any]:
    """Single frames at the given beat-local times. Default size is the logical 1280x720."""
    if fmt not in ("jpeg", "png"):
        raise ValueError("fmt must be 'jpeg' or 'png'")
    if not times:
        raise ValueError("frames needs at least one time")
    out_dir.mkdir(parents=True, exist_ok=True)
    t_list = snap_times(spec, times)
    w, h, scale = _frame_scale(size)
    ext = "jpg" if fmt == "jpeg" else "png"
    t0 = time.perf_counter()

    def run(s: BrowserSession) -> dict[str, Any]:
        page = _open(s, spec)
        artifacts = {}
        for t in t_list:
            n = int(t * spec.fps + 0.5)
            res = page.ok("capture", {"t": t, "scale": scale, "format": fmt, "quality": JPEG_QUALITY})
            artifacts[f"frame_f{n:04d}"] = _write(out_dir / f"frame_f{n:04d}.{ext}", res["data"])
        return {"artifacts": artifacts, "times": t_list, "size": [w, h], "events": list(s.events)}

    if session is not None:
        result = run(session)
    else:
        with BrowserSession(spec) as s:
            result = run(s)
    result["timing_ms"] = {"render": round((time.perf_counter() - t0) * 1000)}
    return result


def markers(spec: BeatSpec, session: BrowserSession | None = None) -> list[dict[str, Any]]:
    """The scene's validated marker list ([] if it exports no markers())."""
    def run(s: BrowserSession) -> list[dict[str, Any]]:
        return _open(s, spec).ok("markers")["markers"]

    if session is not None:
        return run(session)
    with BrowserSession(spec) as s:
        return run(s)


# --------------------------------------------------------------------------- video and bench
BATCH = 6


def video(spec: BeatSpec, out_mp4: Path, size: str | tuple[int, int] | None = None, crf: int = 18,
          preset: str = "medium", progress: Any = None) -> dict[str, Any]:
    """Render every frame at the export size, encode silent H.264, then verify with ffprobe."""
    import sys

    from . import ffmpeg
    from .spec import export_size

    out_mp4 = Path(out_mp4)
    out_mp4.parent.mkdir(parents=True, exist_ok=True)
    w, h = export_size(spec, size)
    scale = w / LOGICAL[0]
    total, fps = spec.frames, spec.fps
    draw_ms = capture_ms = 0.0
    t_start = time.perf_counter()
    with BrowserSession(spec) as s:
        page = _open(s, spec)
        with ffmpeg.Encoder(fps, out_mp4, crf, preset) as enc:
            for start in range(0, total, BATCH):
                times = [n / fps for n in range(start, min(total, start + BATCH))]
                res = page.ok("captureBatch", times, {"scale": scale, "format": "png"}, timeout=180)
                draw_ms += sum(res["timing"]["draw"])
                capture_ms += sum(res["timing"]["capture"])
                for b64 in res["data"]:
                    enc.write(base64.b64decode(b64))
                if progress:
                    progress(min(total, start + BATCH), total)
                elif (start // BATCH) % 10 == 0:
                    print(f"video: {min(total, start + BATCH)}/{total} frames", file=sys.stderr, flush=True)
            enc.close()
        events = list(s.events)
    wall = time.perf_counter() - t_start
    verification = ffmpeg.verify(out_mp4, width=w, height=h, frames=total, fps=fps)   # raises on mismatch
    return {
        "artifacts": {"video": str(out_mp4)},
        "verification": verification,
        "events": events,
        "timing_ms": {
            "total": round(wall * 1000),
            "draw_per_frame": round(draw_ms / total, 2),
            "capture_per_frame": round(capture_ms / total, 2),
            "encode_wait_per_frame": round((enc.blocked_s + enc.finish_s) * 1000 / total, 2),
        },
    }


BUSY_SCENE = r"""
export function draw(rt, t) {
  const g = rt.g, W = rt.W, H = rt.H, rnd = rt.rng(7), P = rt.palette;
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, P.CREAM); bg.addColorStop(1, P.PAPER);
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const cols = [P.TOMATO, P.MUSTARD, P.GREEN, P.PINK, P.AQUA, P.LEAF];
  for (let i = 0; i < 140; i++) {                       // rotating rounded cards
    const x = rnd() * W, y = rnd() * H, s = 30 + rnd() * 90, sp = 0.4 + rnd();
    g.save(); g.translate(x, y); g.rotate(t * sp + i);
    g.globalAlpha = 0.55; g.fillStyle = cols[i % cols.length];
    rt.core.rrect(g, -s / 2, -s / 3, s, s * 0.66, 10); g.fill();
    g.globalAlpha = 0.9; g.lineWidth = 2; g.strokeStyle = P.INK; g.stroke();
    g.restore();
  }
  for (let i = 0; i < 700; i++) {                       // halftone-ish dots
    const x = rnd() * W, y = rnd() * H + 8 * Math.sin(t * 2 + i);
    g.globalAlpha = 0.5; g.fillStyle = cols[(i * 7) % cols.length];
    g.beginPath(); g.arc(x, y, 2 + 4 * rnd(), 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
  const rg = g.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, 700);
  rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(1, 'rgba(0,0,0,0.28)');
  g.fillStyle = rg; g.fillRect(0, 0, W, H);
  rt.core.txt(g, 'BUSY BENCH', 120, 360, { size: 120 });
  rt.core.txt(g, 'frame ' + Math.round(t * rt.fps), 124, 430, { size: 40, font: P.MONO });
}
"""


def _find_bench_assets() -> Path:
    root = Path(__file__).resolve().parents[2]
    for cand in (root / "assets", root / "tests" / "fixtures" / "assets"):
        if (cand / "core" / "core.js").is_file() and (cand / "core" / "palette.js").is_file():
            return cand
    raise FileNotFoundError("bench needs an assets directory containing core/core.js and core/palette.js (use --assets)")


def bench(assets_dir: Path | None = None, work_dir: Path | None = None, frames: int = 60,
          size: tuple[int, int] = (1920, 1080), fps: int = 30) -> dict[str, Any]:
    """Render `frames` frames of a busy built-in scene. Reports ms per frame for draw, capture and encode.

    Two views of the same work: 'serial' (render everything, then encode: a conservative bound) and
    'pipelined' (what video() really does, render and encode overlapped).
    """
    import json
    import tempfile

    from . import ffmpeg
    from .spec import load_spec

    assets = Path(assets_dir) if assets_dir else _find_bench_assets()
    tmp_ctx = tempfile.TemporaryDirectory() if work_dir is None else None
    work = Path(work_dir) if work_dir else Path(tmp_ctx.name)  # type: ignore[union-attr]
    work.mkdir(parents=True, exist_ok=True)
    try:
        (work / "busy_scene.js").write_text(BUSY_SCENE)
        spec_path = work / "bench_spec.json"
        spec_path.write_text(json.dumps({
            "project": {"fps": fps, "width": size[0], "height": size[1]},
            "beat": {"idx": 0, "f0": 0, "f1": frames}, "words": [],
            "scene": "busy_scene.js", "assets_dir": str(assets), "media": {}, "params": {},
        }))
        spec = load_spec(spec_path)
        scale = size[0] / LOGICAL[0]

        # serial: render all frames into memory (timed in the page), then encode them (timed here)
        pngs: list[bytes] = []
        draw = capture = 0.0
        with BrowserSession(spec) as s:
            page = _open(s, spec)
            page.ok("captureBatch", [0.0], {"scale": scale, "format": "png"})          # warm-up
            t0 = time.perf_counter()
            for start in range(0, frames, BATCH):
                times = [n / fps for n in range(start, min(frames, start + BATCH))]
                res = page.ok("captureBatch", times, {"scale": scale, "format": "png"}, timeout=180)
                draw += sum(res["timing"]["draw"])
                capture += sum(res["timing"]["capture"])
                pngs.extend(base64.b64decode(b) for b in res["data"])
            render_wall = time.perf_counter() - t0
        t0 = time.perf_counter()
        with ffmpeg.Encoder(fps, work / "bench_serial.mp4") as enc:
            for p in pngs:
                enc.write(p)
            enc.close()
        encode_wall = time.perf_counter() - t0

        # pipelined: the real video() path
        t0 = time.perf_counter()
        real = video(spec, work / "bench_pipelined.mp4", size=size)
        pipe_wall = time.perf_counter() - t0
        return {
            "frames": frames, "size": f"{size[0]}x{size[1]}", "fps": fps,
            "avg_png_kb": round(sum(map(len, pngs)) / len(pngs) / 1024, 1),
            "ms_per_frame": {
                "draw": round(draw / frames, 2),
                "capture": round(capture / frames, 2),
                "encode": round(encode_wall * 1000 / frames, 2),
            },
            "total_fps": {
                "serial": round(frames / (render_wall + encode_wall), 2),
                "pipelined": round(frames / pipe_wall, 2),
            },
            "pipelined_verification": real["verification"],
        }
    finally:
        if tmp_ctx:
            tmp_ctx.cleanup()
