"""Time model. Integer math only; frames are half-open ranges [f0, f1)."""
from __future__ import annotations

from typing import Any, Iterable, Sequence

ALLOWED_FPS = (24, 25, 30, 60)
SAMPLE_RATE = 48000
LOGICAL = (1280, 720)
EXPORT_SIZES = ((1280, 720), (1920, 1080), (2560, 1440), (3840, 2160))  # 16:9 only


class TimelineError(ValueError):
    """Invalid time-model input (bad fps, size, range or beat sequence)."""


def check_fps(fps: int) -> int:
    if isinstance(fps, bool) or not isinstance(fps, int) or fps not in ALLOWED_FPS:
        raise TimelineError(f"fps must be one of {ALLOWED_FPS}, got {fps!r}")
    return fps


def check_export_size(width: int, height: int) -> tuple[int, int]:
    if (width, height) not in EXPORT_SIZES:
        sizes = ", ".join(f"{w}x{h}" for w, h in EXPORT_SIZES)
        raise TimelineError(f"export size {width}x{height} is not allowed (16:9 only: {sizes})")
    return width, height


def export_scale(width: int, height: int) -> float:
    """Factor from the 1280x720 logical canvas to an export size (1, 1.5, 2 or 3)."""
    check_export_size(width, height)
    return width / LOGICAL[0]


def _as_int(value: Any, name: str) -> int:
    if isinstance(value, bool):
        raise TimelineError(f"{name} must be an integer, got {value!r}")
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    raise TimelineError(f"{name} must be an integer, got {value!r}")


def ms_to_frame(ms: int, fps: int) -> int:
    """Nearest frame, halves rounded up. (ms*fps + 500)//1000."""
    check_fps(fps)
    return (_as_int(ms, "ms") * fps + 500) // 1000


def frame_to_seconds(frame: int, fps: int) -> float:
    check_fps(fps)
    return _as_int(frame, "frame") / fps


def frames_to_timecode(frame: int, fps: int) -> str:
    """Non-drop 'HH:MM:SS:FF'."""
    check_fps(fps)
    frame = _as_int(frame, "frame")
    if frame < 0:
        raise TimelineError("frame must be >= 0")
    secs, ff = divmod(frame, fps)
    return f"{secs // 3600:02d}:{(secs // 60) % 60:02d}:{secs % 60:02d}:{ff:02d}"


def samples_for_frames(frames: int, fps: int) -> int:
    """Sample count for a frame count; must divide exactly, otherwise raise."""
    check_fps(fps)
    total = _as_int(frames, "frames") * SAMPLE_RATE
    if total % fps:
        raise TimelineError(f"{frames} frames at {fps} fps is not a whole number of samples")
    return total // fps


def _get(obj: Any, key: str) -> int:
    value = obj[key] if isinstance(obj, dict) else getattr(obj, key)
    return _as_int(value, key)


def beat_frame_range(
    words: Sequence[Any],
    i_from: int,
    i_to: int,
    fps: int,
    first: bool,
    last: bool,
    tail_ms: int = 600,
) -> tuple[int, int]:
    """Frame range [f0, f1) of a beat covering words[i_from..i_to] (inclusive).

    Every cut sits at the integer midpoint of the pause between two words, so a cut
    never lands inside speech. The first beat starts at frame 0; the last beat ends
    tail_ms after its last word.
    """
    check_fps(fps)
    n = len(words)
    if not (0 <= i_from <= i_to < n):
        raise TimelineError(f"word range {i_from}..{i_to} is outside 0..{n - 1}")
    if first:
        start = 0
    else:
        if i_from == 0:
            raise TimelineError("a beat starting at the first word must have first=True")
        start = (_get(words[i_from - 1], "f1") + _get(words[i_from], "f0")) // 2
    if last:
        end = _get(words[i_to], "f1") + ms_to_frame(tail_ms, fps)
    else:
        if i_to == n - 1:
            raise TimelineError("a beat ending at the last word must have last=True")
        end = (_get(words[i_to], "f1") + _get(words[i_to + 1], "f0")) // 2
    if end <= start:
        raise TimelineError(f"empty beat range [{start}, {end})")
    return start, end


def check_contiguous(beats: Iterable[Any]) -> None:
    """Raise TimelineError on a gap, an overlap or an empty beat.

    Each beat is (f0, f1), or an object / dict with f0 and f1.
    """
    prev_f1: int | None = None
    for i, beat in enumerate(beats):
        if isinstance(beat, (tuple, list)):
            f0, f1 = _as_int(beat[0], "f0"), _as_int(beat[1], "f1")
        else:
            f0, f1 = _get(beat, "f0"), _get(beat, "f1")
        if f1 <= f0:
            raise TimelineError(f"beat {i} is empty or inverted: [{f0}, {f1})")
        if prev_f1 is not None:
            if f0 > prev_f1:
                raise TimelineError(f"gap of {f0 - prev_f1} frame(s) before beat {i} (prev ends {prev_f1}, starts {f0})")
            if f0 < prev_f1:
                raise TimelineError(f"overlap of {prev_f1 - f0} frame(s) at beat {i} (prev ends {prev_f1}, starts {f0})")
        prev_f1 = f1
