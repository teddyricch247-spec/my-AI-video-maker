"""Transcript ingest: native JSON, Whisper-style JSON, SRT and VTT -> frame-aligned words."""
from __future__ import annotations

import html
import json
import os
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from .timeline import check_fps, ms_to_frame

INTERPOLATED_WARNING = "interpolated: word sync will be weaker"

_TRAIL_CLOSERS = "\"'\u201d\u2019)]}\u00bb"
_SENTENCE_ENDS = ".?!\u2026"
_OPENERS = "\"'\u201c\u2018([{\u00ab\u00bf\u00a1"


@dataclass
class Word:
    id: str
    text: str
    start_ms: int
    end_ms: int
    f0: int
    f1: int
    sentence_end: bool
    gap_after_ms: int


@dataclass
class Transcript:
    fps: int
    words: list[Word]
    warnings: list[str] = field(default_factory=list)
    duration_ms: int = 0

    def pauses(self, min_ms: int = 250) -> list[tuple[int, int]]:
        """[(index of the word after the gap, gap_ms)] for every gap >= min_ms."""
        return [
            (i + 1, w.gap_after_ms)
            for i, w in enumerate(self.words[:-1])
            if w.gap_after_ms >= min_ms
        ]

    def to_dict(self) -> dict[str, Any]:
        return {
            "fps": self.fps,
            "duration_ms": self.duration_ms,
            "warnings": list(self.warnings),
            "words": [asdict(w) for w in self.words],
        }

    def to_json(self, indent: int | None = None) -> str:
        return json.dumps(self.to_dict(), indent=indent, ensure_ascii=False)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Transcript":
        return cls(
            fps=check_fps(data["fps"]),
            words=[Word(**w) for w in data["words"]],
            warnings=list(data.get("warnings", [])),
            duration_ms=int(data.get("duration_ms", 0)),
        )

    @classmethod
    def from_json(cls, text: str) -> "Transcript":
        return cls.from_dict(json.loads(text))


# --------------------------------------------------------------------------- loading

def _read_source(src: str | os.PathLike[str] | bytes) -> str:
    if isinstance(src, bytes):
        return src.decode("utf-8-sig")
    if isinstance(src, os.PathLike):
        return Path(src).read_text(encoding="utf-8-sig")
    if "\n" not in src and "{" not in src[:1] and len(src) < 4096:
        try:
            if os.path.isfile(src):
                return Path(src).read_text(encoding="utf-8-sig")
        except (OSError, ValueError):
            pass
    return src.lstrip("\ufeff")


Raw = tuple[str, "int | None", "int | None"]  # (text, start_ms, end_ms)


def _seconds_to_ms(value: Any) -> int | None:
    try:
        if value is None or isinstance(value, bool):
            return None
        return int(round(float(value) * 1000))
    except (TypeError, ValueError):
        return None


def _int_ms(value: Any) -> int | None:
    try:
        if value is None or isinstance(value, bool):
            return None
        return int(round(float(value)))
    except (TypeError, ValueError):
        return None


def _raw_from_json(data: Any, warnings: list[str]) -> list[Raw]:
    items: list[Any]
    cue_like = False
    if isinstance(data, list):
        items = data
    elif isinstance(data, dict) and isinstance(data.get("words"), list):
        items = data["words"]
    elif isinstance(data, dict) and isinstance(data.get("segments"), list):
        items = []
        for seg in data["segments"]:
            if isinstance(seg, dict) and isinstance(seg.get("words"), list) and seg["words"]:
                items.extend(seg["words"])
            elif isinstance(seg, dict):
                # segment without word timings: treat like a caption cue
                cue_like = True
                items.append(seg)
    else:
        raise ValueError("JSON transcript needs a top-level 'words' list or 'segments'")

    if any(isinstance(i, dict) and "start_ms" in i for i in items):
        return [
            (str(i.get("text", i.get("word", ""))), _int_ms(i.get("start_ms")), _int_ms(i.get("end_ms")))
            for i in items
            if isinstance(i, dict)
        ]
    raw: list[Raw] = []
    cues: list[tuple[str, int, int]] = []
    for i in items:
        if not isinstance(i, dict):
            continue
        text = str(i.get("word", i.get("text", "")))
        s, e = _seconds_to_ms(i.get("start")), _seconds_to_ms(i.get("end"))
        if cue_like and "words" not in i and " " in text.strip() and s is not None and e is not None:
            cues.append((text, s, e))
        else:
            raw.append((text, s, e))
    if cues:
        # cue-like segments are interpolated, in order with any word-level items
        raw = _interpolate_cues(cues, warnings) + raw
        raw.sort(key=lambda r: (r[1] if r[1] is not None else 0))
    return raw


_TS = r"(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})"
_TIMING_RE = re.compile(rf"{_TS}\s*-->\s*{_TS}")


def _ts_ms(h: str | None, m: str, s: str, frac: str) -> int:
    return ((int(h or 0) * 60 + int(m)) * 60 + int(s)) * 1000 + int(frac.ljust(3, "0")[:3])


def _interpolate_cues(cues: list[tuple[str, int, int]], warnings: list[str]) -> list[Raw]:
    out: list[Raw] = []
    dropped = 0
    for text, start, end in cues:
        words = text.split()
        if not words:
            continue
        if end <= start:
            dropped += 1
            continue
        weights = [max(1, len(w)) for w in words]
        total, dur, cum = sum(weights), end - start, 0
        for w, wt in zip(words, weights):
            out.append((w, start + dur * cum // total, start + dur * (cum + wt) // total))
            cum += wt
    if dropped:
        warnings.append(f"dropped {dropped} cue(s) with non-positive duration")
    if out and INTERPOLATED_WARNING not in warnings:
        warnings.append(INTERPOLATED_WARNING)
    return out


def _raw_from_cues(text: str, warnings: list[str]) -> list[Raw]:
    cues: list[tuple[str, int, int]] = []
    for block in re.split(r"\n\s*\n", text.replace("\r\n", "\n").replace("\r", "\n")):
        lines = block.strip("\n").split("\n")
        for idx, line in enumerate(lines):
            m = _TIMING_RE.search(line)
            if not m:
                continue
            g = m.groups()
            start, end = _ts_ms(*g[:4]), _ts_ms(*g[4:])
            body = []
            for raw_line in lines[idx + 1:]:
                line_text = re.sub(r"<[^>]*>|\{[^}]*\}", "", raw_line)
                line_text = re.sub(r"^\s*[-\u2013\u2014]\s+", "", html.unescape(line_text))
                if line_text.strip():
                    body.append(line_text.strip())
            cues.append((" ".join(body), start, end))
            break
    return _interpolate_cues(cues, warnings)


# --------------------------------------------------------------------------- cleanup

def _sentence_end(text: str) -> bool:
    t = text.rstrip(_TRAIL_CLOSERS)
    return bool(t) and t[-1] in _SENTENCE_ENDS


def _examples(items: list[str]) -> str:
    return ", ".join(items[:3]) + (", ..." if len(items) > 3 else "")


def _build(raw: list[Raw], fps: int, warnings: list[str]) -> list[Word]:
    # 1. trim, drop empties, merge punctuation-only tokens
    toks: list[list[Any]] = []
    prefix, lead_dropped = "", 0
    for text, s, e in raw:
        text = (text or "").strip()
        if not text:
            continue
        if not any(ch.isalnum() for ch in text):
            if all(ch in _OPENERS for ch in text):
                prefix += text
            elif toks:
                toks[-1][0] += text
                if e is not None and toks[-1][2] is not None and e > toks[-1][2]:
                    toks[-1][2] = e
            else:
                lead_dropped += 1
            continue
        toks.append([prefix + text, s, e])
        prefix = ""
    if lead_dropped:
        warnings.append(f"dropped {lead_dropped} leading punctuation-only token(s)")

    # 2. drop missing / negative / inverted times
    good: list[list[Any]] = []
    bad: list[str] = []
    for text, s, e in toks:
        if s is None or e is None:
            bad.append(f"'{text}' (missing time)")
        elif s < 0 or e < 0:
            bad.append(f"'{text}' (negative time)")
        elif e < s:
            bad.append(f"'{text}' (end before start)")
        else:
            good.append([text, s, e])
    if bad:
        warnings.append(f"dropped {len(bad)} word(s) with invalid times: {_examples(bad)}")
    if not good:
        raise ValueError("transcript has no usable words")

    # 3. monotonic times: start >= previous start, end <= next start
    clamped = 0
    for i in range(1, len(good)):
        prev, cur = good[i - 1], good[i]
        if cur[1] < prev[1]:
            cur[1] = prev[1]
            clamped += 1
        if prev[2] > cur[1]:
            prev[2] = cur[1]
            clamped += 1
        if cur[2] < cur[1]:
            cur[2] = cur[1]
    if clamped:
        warnings.append(f"clamped {clamped} overlapping word time(s) to keep times monotonic")

    # 4. frames; enforce f0 < f1 and f1_k <= f0_(k+1) by moving later words forward
    frames = [[ms_to_frame(s, fps), ms_to_frame(e, fps)] for _, s, e in good]
    adjusted = 0
    for i, fr in enumerate(frames):
        before = (fr[0], fr[1])
        if i and fr[0] < frames[i - 1][1]:
            fr[0] = frames[i - 1][1]
        if fr[1] <= fr[0]:
            fr[1] = fr[0] + 1
        if (fr[0], fr[1]) != before:
            adjusted += 1
    if adjusted:
        warnings.append(f"adjusted {adjusted} word frame range(s) to keep frames strictly ordered")

    words: list[Word] = []
    for i, ((text, s, e), (f0, f1)) in enumerate(zip(good, frames)):
        gap = good[i + 1][1] - e if i + 1 < len(good) else 0
        words.append(Word(f"w{i + 1:04d}", text, s, e, f0, f1, _sentence_end(text), max(0, gap)))
    return words


def parse_transcript(path_or_text: str | os.PathLike[str] | bytes, fps: int) -> Transcript:
    """Parse native JSON, Whisper-style JSON, SRT or VTT (auto-detected)."""
    check_fps(fps)
    text = _read_source(path_or_text)
    warnings: list[str] = []
    stripped = text.lstrip()
    if stripped.startswith(("{", "[")):
        try:
            data = json.loads(stripped)
        except json.JSONDecodeError as exc:
            raise ValueError(f"invalid JSON transcript: {exc}") from exc
        raw = _raw_from_json(data, warnings)
    elif "-->" in stripped:
        raw = _raw_from_cues(stripped, warnings)
    else:
        raise ValueError("unrecognized transcript format (expected JSON, SRT or VTT)")
    words = _build(raw, fps, warnings)
    return Transcript(fps=fps, words=words, warnings=warnings, duration_ms=max(w.end_ms for w in words))
