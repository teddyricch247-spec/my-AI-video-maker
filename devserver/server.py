#!/usr/bin/env python3
"""Dev stand-in for the backend that does not exist yet: the frontend's mock API plus REAL beats played by the REAL engine.

    python devserver/server.py --beat out/my_beat [--beat out/other] [--port 8000] [--assets motion-assets/assets]

What is real here, and what is not:
  real   GET /api/beats/{id}/preview returns a PreviewBundle built by vbeat_shared.preview from the beat's real engine
         spec; the sandboxed frame then loads the real engine/runtime/runtime.js, the real asset library and the real
         scene.js from /preview/engine/..., with the headers from vbeat_shared.preview. The real sfx.wav is served with
         HTTP Range. Checks shown on the beat page are the real check reports from `vbeat_pipeline`.
  mock   everything else (login, projects, chat, director, exports...): frontend/mock/server.py, unchanged, imported.

This file must stay small. The real backend replaces it; the seam it proves (UI -> /api/beats/{id}/preview -> runtime) does not change.
Stdlib only: it runs on any machine, with none of the render-machine tools installed.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
import threading
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "shared" / "src"))

from vbeat_shared import preview as pv  # noqa: E402
from vbeat_shared.assets import list_asset_modules, safe_join  # noqa: E402
from vbeat_shared.envelope import check_projection  # noqa: E402

PREFIX = "/preview/engine/"          # the render machine's URL space, under a prefix (docs/CONTRACTS.md section 9)
RUNTIME_DIR = REPO / "engine" / "runtime"
DEFAULT_ASSETS = REPO / "motion-assets" / "assets"
FRONTEND = REPO / "frontend"
OK_CHECK = {"ok": True, "counts": {"error": 0, "warn": 0}, "text": "OK: no findings"}


def load_mock():
    """Import frontend/mock/server.py as a module (it only starts a server under __main__)."""
    spec = importlib.util.spec_from_file_location("vbeat_mock_server", FRONTEND / "mock" / "server.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


class RealBeat:
    """One beat directory written by `python -m vbeat_pipeline` (spec.json is the only required file)."""

    def __init__(self, directory: Path):
        self.dir = Path(directory).resolve()
        self.spec = json.loads((self.dir / "spec.json").read_text(encoding="utf-8"))
        snapshot = self.dir / "scene.js"       # the pipeline copies the scene it rendered next to the spec
        self.scene = (snapshot if snapshot.is_file() else self.dir / self.spec["scene"]).resolve()
        if not self.scene.is_file():
            raise FileNotFoundError(f"{self.scene} (spec.scene of {self.dir})")
        self.media = {i: (self.dir / p).resolve() for i, p in (self.spec.get("media") or {}).items()}
        wav = self.dir / "sfx" / "sfx.wav"
        self.wav = wav if wav.is_file() else None
        strip = self.dir / "strip.jpg"
        self.strip = strip if strip.is_file() else None
        try:
            self.pipeline = json.loads((self.dir / "pipeline.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.pipeline = {}

    def check(self, stage: str) -> dict:
        rep = (self.pipeline.get("stages", {}).get(stage) or {}).get("report")
        return check_projection(rep) if isinstance(rep, dict) and "counts" in rep else dict(OK_CHECK)


def install(M, beat_dirs: list[Path], assets_dir: Path) -> dict[str, RealBeat]:
    """Patch the imported mock module so that the given beats are real. Returns {beat_id: RealBeat}."""
    assets_dir = Path(assets_dir).resolve()
    real: dict[str, RealBeat] = {}
    M.CORS = dict(pv.PREVIEW_CORS)           # the mock's copies are pinned to these by integration/test_seams.py
    M.FRAME_CSP = pv.FRAME_CSP

    # ---- a project holding the real beats
    first = RealBeat(beat_dirs[0])
    pr = first.spec["project"]
    P = M.new_project("Real engine (dev server)", pr["fps"], pr["width"], pr["height"], True, "p_real")
    P["_words"], beats = [], []
    for n, d in enumerate(beat_dirs, 1):
        rb = first if n == 1 else RealBeat(d)
        a = len(P["_words"])
        P["_words"] += [{"id": w["id"], "text": w["text"], "start_ms": w["start_ms"], "end_ms": w["end_ms"]} for w in rb.spec["words"]]
        beats.append((rb, a, len(P["_words"]) - 1))
    P["word_count"], P["duration_ms"] = len(P["_words"]), P["_words"][-1]["end_ms"]
    P.update(status="building", plan_approved=True, _ready=True, bible=M.BIBLE)
    for n, (rb, a, z) in enumerate(beats, 1):
        b = M.make_beat(P, n, len(beats))
        sp = rb.spec["beat"]
        b.update(title=sp.get("title") or f"Real beat {n}", mode=sp.get("mode", "either"), direction=sp.get("direction", ""),
                 word_from=a, word_to=z, f0=sp["f0"], f1=sp["f1"], duration_s=round((sp["f1"] - sp["f0"]) / pr["fps"], 3),
                 text=" ".join(w["text"] for w in rb.spec["words"]), status="waiting_user", summary="Real beat rendered by vbeat_pipeline.",
                 steps=1, _attempts=1)
        M.add_scene(b)
        b["_scenes"][-1]["checks"] = rb.check("check")
        if rb.wav:
            M.add_sfx(b)
            b["_sfx"][-1]["checks"] = rb.check("sfx_render")
        if rb.strip:
            b["strip_url"] = f"{PREFIX}strip/{b['id']}.jpg"
        real[b["id"]] = rb
    M.refresh_project(P)

    # ---- BeatDetail: real words (project-absolute frames), real strip
    orig_detail = M.beat_detail

    def beat_detail(b):
        d = orig_detail(b)
        rb = real.get(b["id"])
        if rb:
            d["words"] = [{k: w[k] for k in ("id", "text", "start_ms", "end_ms", "f0", "f1")} for w in rb.spec["words"]]
            if rb.strip:
                for sv in d["scene_versions"]:
                    sv["strip_url"] = f"{PREFIX}strip/{b['id']}.jpg"
        return d

    M.beat_detail = beat_detail

    # ---- GET /api/beats/{id}/preview
    for i, (meth, rx, fn) in enumerate(M.ROUTES):
        if meth == "GET" and rx.pattern.endswith("/preview$") and "beats" in rx.pattern:
            orig_preview = fn

            def api_preview(c, _orig=orig_preview):
                rb = real.get(c.m[0])
                if rb is None:
                    return _orig(c)
                b = M.get_beat(c.m[0])
                if not b["scene_n"]:
                    raise M.HttpError(404, "no_scene", "This beat has no scene yet")
                media = {k: f"{PREFIX}media/{b['id']}/{k}" for k in rb.media}
                wav = f"/files/sfx/{b['id']}/{b['sfx_n']}.wav" if (rb.wav and b["sfx_n"]) else None
                bundle = pv.build_preview_bundle(rb.spec, scene_url=f"{PREFIX}scene/{b['id']}/{b['scene_n']}.js",
                                                 media_urls=media, wav_url=wav, width=960, prefix=PREFIX)
                problems = pv.validate_bundle(bundle)
                if problems:
                    raise M.HttpError(500, "bad_bundle", "; ".join(problems))
                return 200, bundle

            M.ROUTES[i] = (meth, rx, api_preview)
            break
    else:
        raise RuntimeError("mock server has no GET /api/beats/{id}/preview route to replace")

    # ---- files: the engine URL space, the real wav
    orig_files = M.file_response
    served_prefix = re.escape(PREFIX)

    def serve(path: Path, ctype: str | None, cache: str):
        return 200, path.read_bytes(), ctype or pv.MIME.get(path.suffix.lower(), "application/octet-stream"), {"Cache-Control": cache}

    def file_response(path: str):
        m = re.match(r"^/files/sfx/([\w-]+)/(\d+)\.wav$", path)
        if m and m[1] in real and real[m[1]].wav:
            return serve(real[m[1]].wav, "audio/wav", pv.IMMUTABLE)
        if not path.startswith(PREFIX):
            return orig_files(path)
        rel = path[len(PREFIX):]
        if rel == "_index.json":
            return 200, json.dumps(list_asset_modules(assets_dir)).encode(), "application/json", {"Cache-Control": pv.REVALIDATE}
        if rel == pv.RUNTIME_REL:
            return serve(RUNTIME_DIR / "runtime.js", None, pv.REVALIDATE)
        if rel.startswith("assets/"):
            f = safe_join(assets_dir, rel[len("assets/"):])
            return serve(f, None, pv.REVALIDATE) if f else None
        m = re.match(r"^scene/([\w-]+)/(\d+)\.js$", rel)
        if m and m[1] in real:
            return serve(real[m[1]].scene, None, pv.IMMUTABLE)
        m = re.match(r"^media/([\w-]+)/([\w-]+)$", rel)
        if m and m[1] in real and m[2] in real[m[1]].media:
            return serve(real[m[1]].media[m[2]], None, pv.IMMUTABLE)
        m = re.match(r"^strip/([\w-]+)\.jpg$", rel)
        if m and m[1] in real and real[m[1]].strip:
            return serve(real[m[1]].strip, None, pv.REVALIDATE)
        return None

    M.file_response = file_response
    return real


def start(beat_dirs, *, host="127.0.0.1", port=0, assets_dir=DEFAULT_ASSETS, speed=3.0):
    """Start the dev server in a background thread. Returns (server, base_url, real_beats). Used by the tests."""
    M = load_mock()
    M.SPEED = max(0.1, speed)
    M.seed()
    real = install(M, [Path(d) for d in beat_dirs], assets_dir)
    threading.Thread(target=M.engine, daemon=True).start()
    srv = M.Server((host, port), M.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://{host}:{srv.server_address[1]}", real


def main():
    ap = argparse.ArgumentParser(description="vbeat dev server: mock API + real beats through the real engine runtime")
    ap.add_argument("--beat", action="append", required=True, type=Path, help="beat directory written by `python -m vbeat_pipeline` (repeatable)")
    ap.add_argument("--assets", type=Path, default=DEFAULT_ASSETS, help="asset library served to the preview")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    a = ap.parse_args()
    srv, base, real = start(a.beat, host=a.host, port=a.port, assets_dir=a.assets, speed=1.0)
    print(f"vbeat dev server on {base}  (password: {sys.modules['vbeat_mock_server'].PASSWORD})")
    print(f"open the project 'Real engine (dev server)', or go to {base}/#/login")
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
