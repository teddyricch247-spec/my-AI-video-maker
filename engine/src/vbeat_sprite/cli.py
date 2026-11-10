"""Thin argparse wrapper over api.py. Every command prints exactly ONE JSON object on stdout.

Envelope: {"ok", "command", "artifacts", "report", "timing_ms", "error": null | {"type", "message"}}
ok=false with a scene fault (ContentError) exits 0: the tool ran, the beat is broken. Tool errors exit 1.
Progress and diagnostics go to stderr.
"""
from __future__ import annotations

import argparse
import contextlib
import json
import sys
import time
from typing import Any, Sequence

from . import api
from .browser import ContentError


class UsageError(Exception):
    pass


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> "None":
        raise UsageError(message)


def _times(text: str) -> list[float]:
    try:
        return [float(x) for x in text.replace(" ", "").split(",") if x]
    except ValueError:
        raise argparse.ArgumentTypeError(f"times must be comma-separated seconds, got {text!r}") from None


def _kv(text: str) -> tuple[str, str]:
    if "=" not in text:
        raise argparse.ArgumentTypeError(f"expected id=path, got {text!r}")
    k, v = text.split("=", 1)
    return k, v


def build_parser() -> argparse.ArgumentParser:
    p = _Parser(prog="python -m vbeat_sprite", description="vbeat deterministic engine")
    sub = p.add_subparsers(dest="command", required=True)

    def cmd(name: str, help_: str) -> argparse.ArgumentParser:
        sp = sub.add_parser(name, help=help_)
        sp.add_argument("--out", required=True, help="output directory (all artifacts are written here)")
        return sp

    s = cmd("ingest", "parse a transcript into frame-aligned words")
    s.add_argument("--transcript", required=True)
    s.add_argument("--fps", type=int, required=True)

    s = cmd("spec", "build a beat spec from a transcript, a word range and a scene")
    s.add_argument("--transcript", required=True)
    s.add_argument("--fps", type=int, required=True)
    s.add_argument("--from-word", required=True, help="0-based index or word id (inclusive)")
    s.add_argument("--to-word", required=True, help="0-based index or word id (inclusive)")
    s.add_argument("--scene", required=True)
    s.add_argument("--assets", required=True)
    s.add_argument("--width", type=int, default=1920)
    s.add_argument("--height", type=int, default=1080)
    s.add_argument("--idx", type=int, default=0)
    s.add_argument("--title", default="")
    s.add_argument("--direction", default="")
    s.add_argument("--mode", default="either", choices=["technical", "story", "either"])
    s.add_argument("--allow-blank-start", action="store_true")
    s.add_argument("--media", action="append", type=_kv, default=[], metavar="ID=PATH")
    s.add_argument("--params", default="{}", help="JSON object")
    s.add_argument("--tail-ms", type=int, default=600)

    s = cmd("strip", "contact sheet of a beat")
    s.add_argument("--spec", required=True)
    s.add_argument("--times", type=_times, default=None)
    s.add_argument("--png", action="store_true")

    s = cmd("frames", "single frames of a beat")
    s.add_argument("--spec", required=True)
    s.add_argument("--times", type=_times, required=True)
    s.add_argument("--size", default=None, help="e.g. 960x540 (16:9, at most 1280 wide)")
    s.add_argument("--format", default="jpeg", choices=["jpeg", "png"])

    s = cmd("check", "run visual verification checks")
    s.add_argument("--spec", required=True)
    s.add_argument("--level", default="fast", choices=["fast", "full"])

    s = cmd("video", "render the beat to a silent H.264 mp4 and verify it")
    s.add_argument("--spec", required=True)
    s.add_argument("--size", default=None)
    s.add_argument("--crf", type=int, default=18)
    s.add_argument("--preset", default="medium")

    s = cmd("markers", "list the scene's validated markers")
    s.add_argument("--spec", required=True)

    s = cmd("bench", "time rendering of a busy built-in scene at 1920x1080")
    s.add_argument("--assets", default=None)
    s.add_argument("--frames", type=int, default=60)
    return p


def _dispatch(a: argparse.Namespace) -> dict[str, Any]:
    c = a.command
    if c == "ingest":
        return api.ingest(a.transcript, a.fps, a.out)
    if c == "spec":
        try:
            params = json.loads(a.params)
        except json.JSONDecodeError as exc:
            raise ValueError(f"--params is not valid JSON: {exc}") from None
        return api.make_spec(a.transcript, a.fps, a.from_word, a.to_word, a.scene, a.assets, a.out,
                             width=a.width, height=a.height, idx=a.idx, title=a.title, direction=a.direction,
                             mode=a.mode, allow_blank_start=a.allow_blank_start, media=dict(a.media),
                             params=params, tail_ms=a.tail_ms)
    if c == "strip":
        return api.strip(a.spec, a.out, a.times, png=a.png)
    if c == "frames":
        return api.frames(a.spec, a.out, a.times, size=a.size, fmt=a.format)
    if c == "check":
        return api.check(a.spec, a.out, level=a.level)
    if c == "video":
        return api.video(a.spec, a.out, size=a.size, crf=a.crf, preset=a.preset)
    if c == "markers":
        return api.markers(a.spec, a.out)
    if c == "bench":
        return api.bench(a.out, assets_dir=a.assets, frames=a.frames)
    raise UsageError(f"unknown command {c!r}")


def _envelope(command: str, ok: bool, result: dict[str, Any] | None, error: dict[str, Any] | None, t0: float) -> dict[str, Any]:
    timing = dict((result or {}).get("timing_ms", {}))
    timing.setdefault("total", round((time.perf_counter() - t0) * 1000))
    return {"ok": ok, "command": command, "artifacts": (result or {}).get("artifacts", {}),
            "report": (result or {}).get("report"), "timing_ms": timing, "error": error}


def main(argv: Sequence[str] | None = None) -> int:
    t0 = time.perf_counter()
    command = (list(argv) if argv is not None else sys.argv[1:])[:1]
    command_name = command[0] if command and not command[0].startswith("-") else "?"
    code = 0
    try:
        args = build_parser().parse_args(argv)
        command_name = args.command
        with contextlib.redirect_stdout(sys.stderr):      # nothing but the envelope may reach stdout
            result = _dispatch(args)
        env = _envelope(command_name, True, result, None, t0)
    except ContentError as exc:
        err = {"type": exc.type, "message": exc.message}
        if exc.t is not None:
            err["t"] = exc.t
        env, code = _envelope(command_name, False, None, err, t0), 0
    except UsageError as exc:
        env, code = _envelope(command_name, False, None, {"type": "UsageError", "message": str(exc)}, t0), 2
    except (SystemExit, KeyboardInterrupt):               # e.g. --help: argparse already printed and exits 0
        raise
    except BaseException as exc:                          # tool error: bad spec, missing tool, failed verification...
        env, code = _envelope(command_name, False, None, {"type": type(exc).__name__, "message": str(exc)}, t0), 1
    sys.stdout.write(json.dumps(env) + "\n")
    sys.stdout.flush()
    return code
