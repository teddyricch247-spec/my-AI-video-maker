# vbeat

A word-timestamped transcript and a scene file go in; a finished MP4 with sound effects baked in comes out. Four pieces that were built separately now form one system:
the deterministic canvas engine, the technical asset library, the sound-effects toolkit and the web UI. Three pieces are not built yet and have prepared homes: story assets, an agent runner, a backend.

```
shared/         vbeat_shared   stdlib only: time model, ingest, JSON envelope, marker kinds, asset manifest/index rules, preview bundle + headers
engine/         vbeat_sprite   Playwright/Chromium renderer, scene runtime (runtime/runtime.js), visual checks, silent video
audio/          vbeat_audio    synthesis toolkit, sandboxed cue-script runner, audio checks, preview image, mux
motion-assets/  the asset library (assets/core = the only core, palette, fonts) and its index/check tools
pipeline/       vbeat_pipeline the one documented render command (runs the two tools above stage by stage, verifies each)
frontend/       the web UI (no build step, no external resources), mock API server, e2e tests
devserver/      stand-in for the missing backend: mock API + real beats played by the real engine
examples/       transcript.json and a beat on the real library (scene.js + cue.py)
integration/    tests that fail when a seam between pieces breaks
docs/           CONTRACTS.md (read first) · EXTENDING.md · MERGE_DECISIONS.md
```

## Quick start (Linux, Python 3.11+, ffmpeg + ffprobe on PATH)

```
make setup          # playwright, numpy, scipy, pillow, pytest + Chromium (render machine only)
make example        # transcript + scene + cue -> out/big_number/final.mp4   (stages: ingest spec strip check markers video sfx_spec sfx_render mux verify)
make devserver      # http://127.0.0.1:8000  password: demo  -> open the project "Real engine (dev server)", press play
make check-assets   # asset manifest/index vs files on disk, id collisions (no browser)
make test           # every suite in its own process; make test-fast skips the ones that start Chromium
```

Nothing needs installing to run from a checkout (the Makefile sets `PYTHONPATH`); `pip install -e shared engine audio pipeline` also works.
The web server needs only `shared/src` and the standard library; `integration/test_boundaries.py` enforces that, and that Playwright, numpy, scipy, Pillow and ffmpeg stay on the render machine.

## Where to look

- Interfaces between pieces (beat spec, runtime API, markers, check reports, cue scripts, web API, preview bundle, HTTP headers): **docs/CONTRACTS.md**.
- Adding story assets, the agent runner, the backend: **docs/EXTENDING.md**.
- The agent runner (OpenRouter loop, spend caps, kill switch, preflight/selftest, hosted-operator guide): **agent/README.md**.
- What disagreed between the pieces, what was changed, what is unverified: **docs/MERGE_DECISIONS.md**.
- Each piece's own docs stay with it: `engine/docs/`, `audio/docs/` and `audio/sfx/sfx-style.md`, `motion-assets/README.md` and `docs/`, `frontend/docs/`.
