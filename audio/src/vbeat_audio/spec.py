"""Build and validate the SFX spec from the engine beat spec and engine markers.

SFX spec = {"fps","frames","samples","dur","words":[{"id","start","end"}],"markers":[{"id","t","kind"}],
"peak_dbfs","seed"}. All times are beat-local seconds.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from .constants import (ALLOWED_FPS, DEFAULT_PEAK_DBFS, MARKER_KINDS, MAX_BEAT_SECONDS, SR, samples_for)


class SpecError(ValueError):
    """Raised when an input or spec file violates the contract."""


def load_json(path):
    """Read a JSON file; raise SpecError with the path on failure."""
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise SpecError(f"cannot read JSON from {path}: {e}") from e


def _num(v, what):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise SpecError(f"{what} must be a finite number, got {v!r}")
    return float(v)


def _clean_markers(markers, dur):
    if isinstance(markers, dict):
        markers = markers.get("markers", [])
    if markers is None:
        markers = []
    if not isinstance(markers, list):
        raise SpecError("markers must be a list of {id, t, kind}")
    out, seen = [], set()
    for i, m in enumerate(markers):
        if not isinstance(m, dict) or "id" not in m or "t" not in m or "kind" not in m:
            raise SpecError(f"marker #{i} must have id, t and kind: {m!r}")
        mid = str(m["id"])
        if mid in seen:
            raise SpecError(f"duplicate marker id {mid!r}")
        seen.add(mid)
        if m["kind"] not in MARKER_KINDS:
            raise SpecError(f"marker {mid!r}: kind {m['kind']!r} is not one of {'|'.join(MARKER_KINDS)}")
        t = min(max(_num(m["t"], f"marker {mid!r} t"), 0.0), dur)  # decision: clamp, never fail
        out.append({"id": mid, "t": round(t, 6), "kind": m["kind"]})
    out.sort(key=lambda m: (m["t"], m["id"]))
    return out


def build_spec(beat_spec: dict, markers=None, seed: int = 0, peak_dbfs: float = DEFAULT_PEAK_DBFS) -> dict:
    """Make an SFX spec from an engine beat spec dict and an engine markers list (beat-local seconds).

    Word time = (frame - beat.f0) / fps clamped to [0, dur]. Only fps, beat.f0/f1 and words[].id/f0/f1
    are read from the engine spec.
    """
    try:
        fps = int(beat_spec["project"]["fps"])
        f0, f1 = int(beat_spec["beat"]["f0"]), int(beat_spec["beat"]["f1"])
    except (KeyError, TypeError, ValueError) as e:
        raise SpecError(f"beat spec needs project.fps, beat.f0 and beat.f1: {e!r}") from e
    if fps not in ALLOWED_FPS:
        raise SpecError(f"fps {fps} not allowed; use one of {ALLOWED_FPS}")
    frames = f1 - f0
    if frames < 1:
        raise SpecError(f"beat.f1 ({f1}) must be greater than beat.f0 ({f0})")
    dur = frames / fps
    words, seen = [], set()
    for i, w in enumerate(beat_spec.get("words", []) or []):
        try:
            wid, wf0, wf1 = str(w["id"]), int(w["f0"]), int(w["f1"])
        except (KeyError, TypeError, ValueError) as e:
            raise SpecError(f"word #{i} needs id, f0 and f1: {e!r}") from e
        if wid in seen:
            raise SpecError(f"duplicate word id {wid!r}")
        seen.add(wid)
        s = min(max((wf0 - f0) / fps, 0.0), dur)
        e = min(max((wf1 - f0) / fps, 0.0), dur)
        words.append({"id": wid, "start": round(s, 6), "end": round(max(e, s), 6)})
    spec = {
        "fps": fps, "frames": frames, "samples": samples_for(frames, fps), "dur": round(dur, 6),
        "words": words, "markers": _clean_markers(markers, dur),
        "peak_dbfs": float(peak_dbfs), "seed": int(seed),
    }
    return validate_spec(spec)


def validate_spec(spec: dict) -> dict:
    """Check an SFX spec for internal consistency and return a normalised copy."""
    if not isinstance(spec, dict):
        raise SpecError("spec must be a JSON object")
    try:
        fps, frames = int(spec["fps"]), int(spec["frames"])
    except (KeyError, TypeError, ValueError) as e:
        raise SpecError(f"spec needs integer fps and frames: {e!r}") from e
    if fps not in ALLOWED_FPS:
        raise SpecError(f"fps {fps} not allowed; use one of {ALLOWED_FPS}")
    if frames < 1:
        raise SpecError("frames must be >= 1")
    samples = samples_for(frames, fps)
    if int(spec.get("samples", samples)) != samples:
        raise SpecError(f"spec.samples={spec.get('samples')} but frames*SR//fps = {samples}")
    dur = frames / fps
    if dur > MAX_BEAT_SECONDS:
        raise SpecError(f"beat of {dur:.1f}s is longer than the {MAX_BEAT_SECONDS:.0f}s limit")
    peak = _num(spec.get("peak_dbfs", DEFAULT_PEAK_DBFS), "peak_dbfs")
    if not -40.0 <= peak <= -0.1:
        raise SpecError("peak_dbfs must be between -40 and -0.1")
    words = []
    for w in spec.get("words", []):
        s, e = _num(w["start"], "word start"), _num(w["end"], "word end")
        words.append({"id": str(w["id"]), "start": min(max(s, 0.0), dur), "end": min(max(e, s, 0.0), dur)})
    return {
        "fps": fps, "frames": frames, "samples": samples, "dur": round(dur, 6), "words": words,
        "markers": _clean_markers(spec.get("markers", []), dur), "peak_dbfs": peak,
        "seed": int(spec.get("seed", 0)),
    }


def load_spec(path) -> dict:
    """Load and validate an SFX spec file."""
    return validate_spec(load_json(path))


assert SR % 24 == 0 and SR % 25 == 0 and SR % 30 == 0 and SR % 60 == 0
