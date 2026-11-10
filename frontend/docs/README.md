# vbeat frontend

Vanilla HTML/CSS/ES modules. No framework, bundler, npm, CDN or external fonts; no build step. Files are served as they are.

```
web/        the app (served at "/")
mock/       server.py: whole contract v1 in memory + fake engine (mock-runtime/)
tests/      e2e.py (Playwright for Python)
docs/       API_CONTRACT.md  BACKEND_NEEDS.md  DECISIONS.md  screens/  experiments/
```

## Run the mock

```
python mock/server.py                 # http://127.0.0.1:8000, password: demo
python mock/server.py --port 8765 --speed 3     # simulated timers 3x faster
python mock/server.py --cold-start 20           # every request answers 503 for the first 20 s
```

Python standard library only (developed and tested on Python 3.13). Seeded projects: Orbit Explainer (setup), Podcast Clip (setup with an interpolated transcript and images),
Cooking Intro (planning), History Lesson (plan ready), Product Launch (building, beats in every status), Wedding Speech (done, with an expired export).
Create a new project and use any `.txt` / `.srt` / `.json` file (or paste text) to walk the whole lifecycle.

## Run the tests

```
pip install playwright && playwright install chromium     # once (or have Chrome installed: VBEAT_CHROME_CHANNEL=chrome)
python tests/e2e.py                    # static scan, mobile (390x844), desktop (1280x800) and cold start, in parallel
python tests/e2e.py --only mobile      # also: desktop, cold, static;  --headed to watch
```

Each pass starts its own mock server on a free port, asserts no console errors and no horizontal scroll at both sizes, checks 44 px tap targets,
and writes a screenshot of every screen to `docs/screens/`. About 75 seconds in total on the build machine.

`python docs/experiments/run.py` reproduces the browser experiments behind BACKEND_NEEDS.md (sandboxed iframe headers, audio seeking, multipart).

## Point the UI at the real backend

Nothing to configure. The UI calls `/api/...` on its own origin, so serve `web/` and the API from the same host (for example the same small Python server
serves `web/` at `/` and the API under `/api`). Then read **docs/BACKEND_NEEDS.md**: the preview iframe needs specific headers, cookie-less self-authorising URLs for
the runtime, scene and media, and Range support for the WAV files. The only file that touches the rendering engine is `web/js/preview-adapter.js`.
