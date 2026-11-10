"""Shared test helpers (plain functions so they work under pytest and the stand-in runner)."""
from __future__ import annotations

import json
import struct
import zlib
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "tests" / "fixtures"
ASSETS = FIX / "assets"
SCENES = FIX / "scenes"
TRANSCRIPTS = FIX / "transcripts"


def png_bytes(w: int, h: int, rgb: tuple[int, int, int]) -> bytes:
    """Stdlib-only solid-colour PNG."""
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))

    def chunk(tag: bytes, data: bytes) -> bytes:
        body = struct.pack(">I", len(data)) + tag + data
        return body + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def write_spec(out_dir: Path, scene: str | Path, *, fps: int = 30, width: int = 1280, height: int = 720,
               beat_f0: int = 300, frames: int = 180, media: dict | None = None, params: dict | None = None,
               allow_blank_start: bool = False, assets: Path | None = None, name: str = "spec.json") -> Path:
    """Write a beat spec. Word ids: w0003 is the 3rd word of the beat (frame beat_f0 + 30 by default)."""
    words = [
        {"id": f"w{i + 1:04d}", "text": f"w{i + 1}", "start_ms": (beat_f0 + 15 * i) * 1000 // fps,
         "end_ms": (beat_f0 + 15 * i + 12) * 1000 // fps, "f0": beat_f0 + 15 * i, "f1": beat_f0 + 15 * i + 12}
        for i in range(8)
        if 15 * i + 12 <= frames
    ]
    spec = {
        "project": {"fps": fps, "width": width, "height": height},
        "beat": {"idx": 3, "f0": beat_f0, "f1": beat_f0 + frames, "title": "fixture", "direction": "",
                 "mode": "either", "allow_blank_start": allow_blank_start},
        "words": words,
        "scene": str(scene),
        "assets_dir": str(assets or ASSETS),
        "media": media or {},
        "params": params or {},
    }
    path = out_dir / name
    path.write_text(json.dumps(spec))
    return path


@lru_cache(maxsize=None)
def good_scene() -> Path:
    return SCENES / "good.js"
