"""Shared by the integration tests. Plain functions (no fixtures) so the tests also run under a minimal runner."""
from __future__ import annotations

import atexit
import json
import os
import subprocess
import sys
import tempfile
import urllib.request
from functools import lru_cache
from http.cookiejar import CookieJar
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SRC = [REPO / "shared" / "src", REPO / "engine" / "src", REPO / "audio" / "src", REPO / "pipeline" / "src", REPO]
for _p in reversed(SRC):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

EX = REPO / "examples"
TRANSCRIPT = EX / "transcript.json"
SCENE = EX / "beats" / "big_number" / "scene.js"
CUE = EX / "beats" / "big_number" / "cue.py"
ASSETS = REPO / "motion-assets" / "assets"
_TMP = tempfile.TemporaryDirectory(prefix="vbeat-it-")
atexit.register(_TMP.cleanup)
TMP = Path(_TMP.name)


def child_env() -> dict:
    e = dict(os.environ)
    e["PYTHONPATH"] = os.pathsep.join(map(str, SRC))
    e["PYTHONDONTWRITEBYTECODE"] = "1"
    return e


def cli(module: str, *args) -> tuple[int, dict]:
    """Run `python -m module args`, return (exit code, the single JSON envelope on stdout)."""
    p = subprocess.run([sys.executable, "-m", module, *map(str, args)], capture_output=True, text=True, env=child_env(), cwd=REPO)
    lines = [ln for ln in p.stdout.splitlines() if ln.strip()]
    assert len(lines) == 1, f"{module} {args[:1]}: stdout must be one JSON line, got {p.stdout!r} / stderr {p.stderr[-500:]}"
    return p.returncode, json.loads(lines[0])


def render_beat(out: Path, *, words=(0, 8), scene: Path = SCENE, cue: Path | None = CUE, extra=()) -> tuple[int, dict]:
    args = ["render-beat", "--transcript", TRANSCRIPT, "--from-word", words[0], "--to-word", words[1], "--scene", scene,
            "--out", out, "--size", "1280x720", "--title", "Big number", "--check-level", "fast", *extra]
    args += ["--cue", cue] if cue else ["--no-sfx"]
    return cli("vbeat_pipeline", *args)


@lru_cache(maxsize=None)
def example_beat() -> Path:
    """The documented pipeline on the example beat, once per test run (about 40 s)."""
    out = TMP / "example_beat"
    rc, env = render_beat(out)
    assert rc == 0 and env["ok"], env
    return out


@lru_cache(maxsize=None)
def spec_only_beat() -> Path:
    """A beat directory that has a real engine spec and the scene snapshot, but nothing rendered (no browser needed)."""
    out = TMP / "spec_only_beat"
    out.mkdir()
    (out / "scene.js").write_bytes(SCENE.read_bytes())
    rc, env = cli("vbeat_sprite", "spec", "--transcript", TRANSCRIPT, "--fps", 30, "--from-word", 0, "--to-word", 8,
                  "--scene", out / "scene.js", "--assets", ASSETS, "--width", 1280, "--height", 720, "--title", "Big number", "--out", out)
    assert rc == 0 and env["ok"], env
    return out


class Http:
    """urllib with a cookie jar (the mock API logs in with a cookie)."""

    def __init__(self, base: str):
        self.base = base
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))

    def req(self, path: str, method="GET", body=None, headers=None):
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(self.base + path, data=data, method=method, headers={**({"Content-Type": "application/json"} if data else {}), **(headers or {})})
        try:
            with self.opener.open(r) as resp:
                return resp.status, dict(resp.headers), resp.read()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), e.read()

    def login(self):
        st, _, _ = self.req("/api/login", "POST", {"password": "demo"})
        assert st in (200, 204), st

    def json(self, path: str):
        st, _, b = self.req(path)
        assert st == 200, (path, st, b[:200])
        return json.loads(b)


def start_devserver(beat_dirs):
    from devserver.server import start
    srv, base, real = start(beat_dirs, port=0, assets_dir=ASSETS, speed=5.0)
    return srv, base, real
