"""The real functions. cli.py is a thin wrapper so a job runner can import this module directly.

Every function returns {"artifacts": {name: path}, "report": obj | None, "timing_ms": {...}}.
Scene faults raise a ContentError subclass (browser.py); everything else is a tool error.
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Sequence

from vbeat_shared.ingest import parse_transcript
from vbeat_shared.timeline import beat_frame_range

from . import checks as _checks
from . import render as _render
from .browser import ContentError  # noqa: F401  (re-exported for callers)
from .spec import BeatSpec, as_spec, parse_spec

SpecLike = "BeatSpec | str | Path | dict"


def _ms(t0: float) -> int:
    return round((time.perf_counter() - t0) * 1000)


def _out(out_dir: "str | Path") -> Path:
    p = Path(out_dir)
    p.mkdir(parents=True, exist_ok=True)
    return p


def _word_index(words: Sequence[Any], ref: "int | str") -> int:
    """A 0-based index, or a word id such as 'w0101'."""
    if isinstance(ref, int):
        idx = ref
    elif isinstance(ref, str) and ref.lstrip("-").isdigit():
        idx = int(ref)
    else:
        idx = next((i for i, w in enumerate(words) if w.id == ref), -1)
        if idx < 0:
            raise ValueError(f"no word with id {ref!r}")
    if not 0 <= idx < len(words):
        raise ValueError(f"word index {idx} is outside 0..{len(words) - 1}")
    return idx


def ingest(transcript: "str | Path", fps: int, out_dir: "str | Path", min_pause_ms: int = 250) -> dict[str, Any]:
    t0 = time.perf_counter()
    tr = parse_transcript(Path(transcript), fps)
    out = _out(out_dir) / "transcript.json"
    out.write_text(tr.to_json(indent=1))
    return {
        "artifacts": {"transcript": str(out)},
        "report": {"words": len(tr.words), "duration_ms": tr.duration_ms, "warnings": tr.warnings,
                   "pauses": [{"before_word": i, "id": tr.words[i].id, "gap_ms": gap} for i, gap in tr.pauses(min_pause_ms)]},
        "timing_ms": {"total": _ms(t0)},
    }


def make_spec(transcript: "str | Path", fps: int, from_word: "int | str", to_word: "int | str", scene: "str | Path",
              assets_dir: "str | Path", out_dir: "str | Path", *, width: int = 1920, height: int = 1080, idx: int = 0,
              title: str = "", direction: str = "", mode: str = "either", allow_blank_start: bool = False,
              media: dict[str, str] | None = None, params: dict[str, Any] | None = None,
              tail_ms: int = 600) -> dict[str, Any]:
    """Build a beat spec from a transcript, an inclusive word range and a scene path."""
    t0 = time.perf_counter()
    tr = parse_transcript(Path(transcript), fps)
    i, j = _word_index(tr.words, from_word), _word_index(tr.words, to_word)
    f0, f1 = beat_frame_range(tr.words, i, j, fps, first=(i == 0), last=(j == len(tr.words) - 1), tail_ms=tail_ms)
    data = {
        "project": {"fps": fps, "width": width, "height": height},
        "beat": {"idx": idx, "f0": f0, "f1": f1, "title": title, "direction": direction, "mode": mode,
                 "allow_blank_start": allow_blank_start},
        "words": [{"id": w.id, "text": w.text, "start_ms": w.start_ms, "end_ms": w.end_ms, "f0": w.f0, "f1": w.f1}
                  for w in tr.words[i:j + 1]],
        "scene": str(Path(scene).resolve()),
        "assets_dir": str(Path(assets_dir).resolve()),
        "media": {k: str(Path(v).resolve()) for k, v in (media or {}).items()},
        "params": params or {},
    }
    spec = parse_spec(data)           # validates the result
    path = _out(out_dir) / "spec.json"
    path.write_text(spec.to_json())
    return {"artifacts": {"spec": str(path)},
            "report": {"beat": data["beat"], "words": len(spec.words), "frames": spec.frames,
                       "warnings": tr.warnings},
            "timing_ms": {"total": _ms(t0)}}


def strip(spec: SpecLike, out_dir: "str | Path", times: Sequence[float] | None = None, png: bool = False) -> dict[str, Any]:
    t0 = time.perf_counter()
    r = _render.strip(as_spec(spec), times, _out(out_dir), png=png)
    return {"artifacts": r["artifacts"], "timing_ms": {**r["timing_ms"], "total": _ms(t0)},
            "report": {"times": r["times"], "size": r["size"], "events": r["events"]}}


def frames(spec: SpecLike, out_dir: "str | Path", times: Sequence[float], size: "str | None" = None,
           fmt: str = "jpeg") -> dict[str, Any]:
    t0 = time.perf_counter()
    r = _render.frames(as_spec(spec), times, _out(out_dir), size=size, fmt=fmt)
    return {"artifacts": r["artifacts"], "timing_ms": {**r["timing_ms"], "total": _ms(t0)},
            "report": {"times": r["times"], "size": r["size"], "events": r["events"]}}


def markers(spec: SpecLike, out_dir: "str | Path") -> dict[str, Any]:
    t0 = time.perf_counter()
    found = _render.markers(as_spec(spec))
    path = _out(out_dir) / "markers.json"
    path.write_text(json.dumps(found, indent=1))
    return {"artifacts": {"markers": str(path)}, "report": {"markers": found}, "timing_ms": {"total": _ms(t0)}}


def check(spec: SpecLike, out_dir: "str | Path", level: str = "fast") -> dict[str, Any]:
    t0 = time.perf_counter()
    out = _out(out_dir)
    report = _checks.run_checks(as_spec(spec), level, out_dir=out)
    return {"artifacts": {"report": str(out / "report.json")}, "report": report, "timing_ms": {"total": _ms(t0)}}


def video(spec: SpecLike, out_dir: "str | Path", size: "str | None" = None, crf: int = 18,
          preset: str = "medium") -> dict[str, Any]:
    r = _render.video(as_spec(spec), _out(out_dir) / "video.mp4", size=size, crf=crf, preset=preset)
    return {"artifacts": r["artifacts"], "timing_ms": r["timing_ms"],
            "report": {"verification": r["verification"], "events": r["events"]}}


def bench(out_dir: "str | Path", assets_dir: "str | Path | None" = None, frames: int = 60) -> dict[str, Any]:
    t0 = time.perf_counter()
    out = _out(out_dir)
    result = _render.bench(assets_dir=Path(assets_dir) if assets_dir else None, work_dir=None, frames=frames)
    (out / "bench.json").write_text(json.dumps(result, indent=1))
    return {"artifacts": {"bench": str(out / "bench.json")}, "report": result,
            "timing_ms": {"total": _ms(t0), **{f"{k}_per_frame": v for k, v in result["ms_per_frame"].items()}}}
