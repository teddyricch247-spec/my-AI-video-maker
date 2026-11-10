"""Beat spec: JSON file, validated with plain dataclasses."""
from __future__ import annotations

import json
import os
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from vbeat_shared.timeline import ALLOWED_FPS, EXPORT_SIZES, check_export_size

MODES = ("technical", "story", "either")
_MEDIA_ID = re.compile(r"^[A-Za-z0-9_-]+$")


class SpecError(ValueError):
    """The spec file is invalid. The message lists every problem found."""


@dataclass
class Project:
    fps: int
    width: int
    height: int


@dataclass
class Beat:
    idx: int
    f0: int
    f1: int
    title: str = ""
    direction: str = ""
    mode: str = "either"
    allow_blank_start: bool = False

    @property
    def frames(self) -> int:
        return self.f1 - self.f0


@dataclass
class SpecWord:
    id: str
    text: str
    start_ms: int
    end_ms: int
    f0: int
    f1: int


@dataclass
class BeatSpec:
    project: Project
    beat: Beat
    words: list[SpecWord]
    scene: str
    assets_dir: str
    media: dict[str, str] = field(default_factory=dict)
    params: dict[str, Any] = field(default_factory=dict)

    @property
    def fps(self) -> int:
        return self.project.fps

    @property
    def frames(self) -> int:
        return self.beat.frames

    @property
    def duration(self) -> float:
        return self.beat.frames / self.project.fps

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def to_json(self, indent: int | None = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent, ensure_ascii=False)

    def page_spec(self) -> dict[str, Any]:
        """What the browser page may see: no disk paths, media rewritten to served URLs."""
        d = self.to_dict()
        d["scene"] = "/scene.js"
        d["assets_dir"] = "/assets/"
        d["media"] = {k: f"/media/{k}" for k in self.media}
        return d


def _is_int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def parse_spec(data: Any, base_dir: str | os.PathLike[str] | None = None) -> BeatSpec:
    """Validate a decoded spec dict. Relative paths resolve against base_dir."""
    errors: list[str] = []

    def err(msg: str) -> None:
        errors.append(msg)

    if not isinstance(data, dict):
        raise SpecError("spec must be a JSON object")
    base = Path(base_dir) if base_dir is not None else Path.cwd()

    p = data.get("project")
    project = None
    if not isinstance(p, dict):
        err("project: required object")
    else:
        fps, w, h = p.get("fps"), p.get("width"), p.get("height")
        if not _is_int(fps) or fps not in ALLOWED_FPS:
            err(f"project.fps: must be one of {ALLOWED_FPS}, got {fps!r}")
        if not (_is_int(w) and _is_int(h)) or (w, h) not in EXPORT_SIZES:
            sizes = ", ".join(f"{a}x{b}" for a, b in EXPORT_SIZES)
            err(f"project.width/height: must be one of {sizes}, got {w!r}x{h!r}")
        if not errors:
            project = Project(fps, w, h)

    b = data.get("beat")
    beat = None
    if not isinstance(b, dict):
        err("beat: required object")
    else:
        n0 = len(errors)
        for key in ("idx", "f0", "f1"):
            if not _is_int(b.get(key)):
                err(f"beat.{key}: must be an integer, got {b.get(key)!r}")
        if len(errors) == n0:
            if b["f0"] < 0:
                err("beat.f0: must be >= 0")
            if b["f1"] <= b["f0"]:
                err(f"beat: f1 must be greater than f0 (half-open range), got [{b['f0']}, {b['f1']})")
        mode = b.get("mode", "either")
        if mode not in MODES:
            err(f"beat.mode: must be one of {MODES}, got {mode!r}")
        for key in ("title", "direction"):
            if not isinstance(b.get(key, ""), str):
                err(f"beat.{key}: must be a string")
        if not isinstance(b.get("allow_blank_start", False), bool):
            err("beat.allow_blank_start: must be a boolean")
        if len(errors) == n0:
            beat = Beat(b["idx"], b["f0"], b["f1"], b.get("title", ""), b.get("direction", ""), mode,
                        b.get("allow_blank_start", False))

    words: list[SpecWord] = []
    raw_words = data.get("words", [])
    if not isinstance(raw_words, list):
        err("words: must be a list")
        raw_words = []
    seen: set[str] = set()
    for i, w in enumerate(raw_words):
        if not isinstance(w, dict):
            err(f"words[{i}]: must be an object")
            continue
        ok = isinstance(w.get("id"), str) and isinstance(w.get("text"), str)
        ok = ok and all(_is_int(w.get(k)) for k in ("start_ms", "end_ms", "f0", "f1"))
        if not ok:
            err(f"words[{i}]: needs id, text (strings) and start_ms, end_ms, f0, f1 (integers)")
            continue
        if w["id"] in seen:
            err(f"words[{i}]: duplicate id {w['id']!r}")
        seen.add(w["id"])
        if w["f1"] <= w["f0"]:
            err(f"words[{i}] {w['id']}: f1 must be greater than f0")
        elif beat and not (beat.f0 <= w["f0"] and w["f1"] <= beat.f1):
            err(f"words[{i}] {w['id']}: frames [{w['f0']}, {w['f1']}) are outside the beat [{beat.f0}, {beat.f1})")
        words.append(SpecWord(w["id"], w["text"], w["start_ms"], w["end_ms"], w["f0"], w["f1"]))

    for key in ("scene", "assets_dir"):
        if not isinstance(data.get(key), str) or not data.get(key):
            err(f"{key}: required non-empty string path")

    media_in = data.get("media", {})
    media: dict[str, str] = {}
    if not isinstance(media_in, dict):
        err("media: must be an object of id -> path")
    else:
        for k, v in media_in.items():
            if not _MEDIA_ID.match(str(k)):
                err(f"media.{k}: id must match [A-Za-z0-9_-]+")
            elif not isinstance(v, str) or not v:
                err(f"media.{k}: path must be a non-empty string")
            else:
                media[k] = str((base / v).resolve())

    params = data.get("params", {})
    if not isinstance(params, dict):
        err("params: must be an object")
        params = {}

    if errors:
        raise SpecError("invalid beat spec:\n  " + "\n  ".join(errors))
    assert project and beat
    return BeatSpec(
        project=project, beat=beat, words=words,
        scene=str((base / data["scene"]).resolve()),
        assets_dir=str((base / data["assets_dir"]).resolve()),
        media=media, params=params,
    )


def load_spec(path: str | os.PathLike[str]) -> BeatSpec:
    p = Path(path)
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise SpecError(f"spec file not found: {p}") from None
    except json.JSONDecodeError as exc:
        raise SpecError(f"spec is not valid JSON: {exc}") from None
    return parse_spec(data, p.resolve().parent)


def as_spec(spec: "BeatSpec | str | os.PathLike[str] | dict[str, Any]") -> BeatSpec:
    if isinstance(spec, BeatSpec):
        return spec
    if isinstance(spec, dict):
        return parse_spec(spec)
    return load_spec(spec)


def export_size(spec: BeatSpec, size: "str | tuple[int, int] | None" = None) -> tuple[int, int]:
    """Export size for video: the spec's size unless overridden (must be an allowed 16:9 size)."""
    if size is None:
        return spec.project.width, spec.project.height
    return check_export_size(*parse_size(size))


def parse_size(size: "str | tuple[int, int]") -> tuple[int, int]:
    if isinstance(size, str):
        m = re.fullmatch(r"(\d+)[xX](\d+)", size.strip())
        if not m:
            raise SpecError(f"size must look like 1280x720, got {size!r}")
        return int(m.group(1)), int(m.group(2))
    return int(size[0]), int(size[1])
