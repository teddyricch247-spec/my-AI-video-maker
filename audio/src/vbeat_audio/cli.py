"""Thin argparse wrapper: python -m vbeat_audio <command> ...  Every command prints exactly ONE JSON object on stdout
(progress goes to stderr). Exit code: 0 pass, 1 report says fail, 2 the tool itself failed or usage error."""
from __future__ import annotations

import argparse
import contextlib
import json
import sys

from . import api


class _Usage(Exception):
    pass


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        raise _Usage(message)

    def print_help(self, file=None):
        super().print_help(sys.stderr)

    def exit(self, status=0, message=None):
        if message:
            sys.stderr.write(message)
        raise SystemExit(status)


def _build():
    p = _Parser(prog="python -m vbeat_audio", description="vbeat SFX subsystem")
    sub = p.add_subparsers(dest="command", required=True, parser_class=_Parser)
    s = sub.add_parser("spec", help="engine beat spec + markers -> SFX spec json")
    s.add_argument("--beat", required=True)
    s.add_argument("--markers")
    s.add_argument("--out", required=True, help="spec json file to write")
    s.add_argument("--seed", type=int, default=0)
    s.add_argument("--peak-dbfs", type=float, default=-6.0)
    r = sub.add_parser("render", help="run a cue script and write wav, preview, cues, metrics")
    r.add_argument("--spec", required=True)
    r.add_argument("--cue", required=True)
    r.add_argument("--out", required=True, help="output directory")
    r.add_argument("--no-preview", action="store_true")
    m = sub.add_parser("mux", help="add the wav to an existing video (video stream copied)")
    m.add_argument("--video", required=True)
    m.add_argument("--wav", required=True)
    m.add_argument("--out", required=True)
    m.add_argument("--codec", choices=("aac", "pcm_mov"), default="aac")
    c = sub.add_parser("catalog", help="render every recipe and example plus demo/audition.html")
    c.add_argument("--out", required=True)
    d = sub.add_parser("docs", help="generate sfx/SYNTH_API.md from the docstrings")
    d.add_argument("--out")
    d.add_argument("--check", action="store_true", help="fail when the file is stale")
    sub.add_parser("selftest", help="end-to-end check on the fixtures")
    return p


def _json_default(o):
    import numpy as np
    if isinstance(o, np.generic):
        return o.item()
    if isinstance(o, np.ndarray):
        return o.tolist()
    return str(o)


def run(argv=None):
    """Parse and run; returns the envelope dict."""
    a = _build().parse_args(argv)
    with contextlib.redirect_stdout(sys.stderr):  # nothing but the envelope may reach stdout
        if a.command == "spec":
            return api.make_spec(a.beat, a.markers, a.out, a.seed, a.peak_dbfs)
        if a.command == "render":
            return api.render(a.spec, a.cue, a.out, preview=not a.no_preview)
        if a.command == "mux":
            return api.mux(a.video, a.wav, a.out, a.codec)
        if a.command == "catalog":
            return api.catalog(a.out)
        if a.command == "docs":
            return api.docs(a.out, a.check)
        return api.selftest()


def main(argv=None):
    try:
        env = run(argv)
    except _Usage as e:
        env = api.envelope("usage", ok=False, error={"type": "UsageError", "message": str(e)})
    except SystemExit as e:
        return int(e.code or 0)
    sys.stdout.write(json.dumps(env, ensure_ascii=True, default=_json_default) + "\n")
    sys.stdout.flush()
    if not env["ok"]:
        return 2
    rep = env.get("report")
    return 1 if isinstance(rep, dict) and rep.get("ok") is False else 0
