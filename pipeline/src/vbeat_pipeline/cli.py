"""python -m vbeat_pipeline render-beat ...   (one JSON envelope on stdout; progress on stderr)

Exit codes: 0 every stage passed; 1 a stage reported a broken beat (scene fault, failed checks, bad cue script) or the
final file failed verification; 2 tool failure or usage error. The envelope says which stage and why.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from vbeat_shared.envelope import error_obj, make_envelope

from .run import REPO, DEFAULT_ASSETS, PipelineError, render_beat


def _kv(s: str):
    if "=" not in s:
        raise argparse.ArgumentTypeError("expected ID=PATH")
    k, v = s.split("=", 1)
    return k, v


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="vbeat_pipeline", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="command", required=True)
    r = sub.add_parser("render-beat", help="transcript + word range + scene + cue script -> out/final.mp4")
    r.add_argument("--transcript", required=True, type=Path)
    r.add_argument("--fps", type=int, default=30)
    r.add_argument("--from-word", required=True, help="0-based index or word id (inclusive)")
    r.add_argument("--to-word", required=True, help="0-based index or word id (inclusive)")
    r.add_argument("--scene", required=True, type=Path, help="scene.js (draw/markers/meta) written against the real asset library")
    r.add_argument("--cue", type=Path, default=None, help="sound-effect cue script (.py); omit together with --no-sfx for a silent beat")
    r.add_argument("--no-sfx", action="store_true", help="stop after the silent render")
    r.add_argument("--out", required=True, type=Path, help="beat directory (everything is written here)")
    r.add_argument("--assets", type=Path, default=DEFAULT_ASSETS, help=f"asset library (default {DEFAULT_ASSETS.relative_to(REPO)})")
    r.add_argument("--size", default="1920x1080", help="export size WxH (16:9: 1280x720, 1920x1080, 2560x1440, 3840x2160)")
    r.add_argument("--idx", type=int, default=0)
    r.add_argument("--title", default="")
    r.add_argument("--mode", default="either", choices=["technical", "story", "either"])
    r.add_argument("--allow-blank-start", action="store_true")
    r.add_argument("--media", action="append", type=_kv, default=[], metavar="ID=PATH")
    r.add_argument("--params", default="{}", help="JSON object passed to the scene as rt.param")
    r.add_argument("--check-level", default="full", choices=["fast", "full"])
    r.add_argument("--peak-dbfs", type=float, default=-6.0)
    r.add_argument("--seed", type=int, default=0)
    r.add_argument("--crf", type=int, default=18)
    r.add_argument("--preset", default="medium")
    return ap


def main(argv=None) -> int:
    ap = build_parser()
    try:
        a = ap.parse_args(argv)
    except SystemExit as e:
        if e.code in (0, None):
            return 0
        print(json.dumps(make_envelope("render-beat", ok=False, error=error_obj("UsageError", "bad command line (see --help)"))))
        return 2
    try:
        w, h = (int(x) for x in a.size.lower().split("x"))
        env, rc = render_beat(a, w, h)
    except PipelineError as e:
        env, rc = make_envelope("render-beat", ok=False, error=error_obj(e.type, str(e))), 2
    except Exception as e:  # noqa: BLE001
        env, rc = make_envelope("render-beat", ok=False, error=error_obj(type(e).__name__, str(e))), 2
    print(json.dumps(env))
    return rc


if __name__ == "__main__":
    sys.exit(main())
