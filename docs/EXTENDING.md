# Extending vbeat: where the missing pieces go

Three pieces are not built. Each has a home, a list of what it may import, and a rule that nothing already in the repo needs editing
(the only registrations are named explicitly: a namespace line if the story zip invents a new one, a layering line when a new package is added, and the files `manifest.json`/`index.json`, which the index tool regenerates). Contracts referenced here: [CONTRACTS.md](CONTRACTS.md).

## 1. Story assets (people, environment, story scenes)

**Arrives as** a zip with the same shape as `motion-assets`: top-level `motion-assets/` containing `assets/{people,env,story}/*.js` (and optionally `demos/`, `refs/`, `qa/`, `docs/`), built to the core API
(`assets/core/*` is **not** shipped again; a second `core.js` is an error). Ids use the namespaces `people/*`, `env/*`, `story/*`, which are already registered.

**Drop-in** (from the repo root):

```
unzip motion-assets-story.zip            # merges into ./motion-assets; no existing file is overwritten
make index                               # rebuilds assets/manifest.json + index.json (browser), then runs scripts/check_assets.py
make check-assets                        # at any time, no browser: stale manifest/index, id collisions, namespaces, duplicate core
```

What happens if a step is skipped or the zip misbehaves: unindexed modules are reported as `STALE_MANIFEST`/`STALE_INDEX` (not ignored); an id declared twice fails `build_index.py` with exit 1 (`DUPLICATE id ...`) and `ID_COLLISION` in the check;
an unregistered namespace is `UNKNOWN_NAMESPACE`; a marker kind outside the contract is `BAD_MARKER_KIND`. `integration/test_assets_tree.py` exercises each of these on a copy of the library.
Generated files `manifest.json` and `index.json` are the only existing files that change, and only by the tool. Nothing else needs to know: the render page imports whatever `manifest.json` lists, the dev server and the (future) backend serve the same list through `vbeat_shared.assets.list_asset_modules`.

**May import**: `../core/*.js` only (and its own siblings). Cross-half imports (`story` → `technical/kit.js`) are flagged by `motion-assets/tools/check.py`; if the story zip needs a new namespace, add one line to `NAMESPACES` in `shared/src/vbeat_shared/assets.py`.
If the story half has characters that need media (images), they are declared per beat in the spec's `media` map and served by the preview URL space; no engine change is needed.

## 2. Agent runner (OpenRouter client and the ReAct loop)

**Home**: `agent/` (a new top-level directory, package `vbeat_agent`, its own `pyproject.toml`, tests in `agent/tests/`). Runs on the render machine side or wherever the loop lives; it does the LLM calls (HTTP client of its choice), the backend does not.

**It drives the tools through their commands**, exactly as `vbeat_pipeline` does, and reads results through the envelope:

- may import: `vbeat_shared` (envelope `classify`, `validate_check_report`, time model, `assets` for the index), `vbeat_sprite.api` and `vbeat_audio.api` (same results as the CLIs), `vbeat_pipeline.run` for whole-beat renders.
- must not import: `vbeat_backend`, `devserver`, anything in `frontend/`.
- LLM-visible catalogue: `motion-assets/assets/index.json` (ids, params, anchors, markers, examples) and `audio/sfx/sfx-style.md` + `python -m vbeat_audio docs`. Scene and cue text are written by the model, validated by `check` (C1 lint) and the cue's static check (A0) before anything runs.
- feedback loop: the `report.text` of `check` and `sfx_render` is written to be read by a model (one line per finding); `classify(env)` says whether a failure is the model's (`CONTENT_FAULT`, `REPORT_FAILED`) or the tool's (`TOOL_FAILED`).
- must keep: scene and cue files are saved as `scene.js` / `cue.py` in the beat directory (section 11 of the contracts), which is what the dev server and the preview play.
- the string `openrouter` and model names live only here (the engine's own test forbids them inside `engine/`).

## 3. Backend (database, job queue, scheduler, Director, HTTP server)

**Home**: `backend/` (package `vbeat_backend`, own `pyproject.toml`, tests in `backend/tests/`). Two parts with different machines:

- **web server** (512 MB, 0.1 CPU): the HTTP server implementing `frontend/docs/API_CONTRACT.md`, the database, the job queue's API side, the scheduler. **May import only `vbeat_shared` and the standard library** (plus its own database driver if it needs one; add that dependency to `backend/pyproject.toml`, never to `shared/`). It serves `frontend/web/` as static files, builds `PreviewBundle`s with `vbeat_shared.preview`, serves the engine URL space (`runtime/runtime.js` from `engine/runtime/`, the asset library, scenes, media) with the headers in `PREVIEW_CORS`/`FRAME_CSP`, answers wav Range requests, and maps check reports with `check_projection`.
  `devserver/server.py` is a working example of every one of those routes; read it and replace it, keep the URLs.
- **render worker** (render machine): pulls jobs, runs `vbeat_pipeline`/the agent runner, writes beat directories (section 11) and uploads or exposes them to the web server. **May import** everything the agent runner may.
- Director (plans beats from the transcript, approves/redoes): decisions live in the backend; it calls the agent runner for the model work and uses `vbeat_shared.timeline` to cut beats (never its own rounding: the mock server's `round()` is a mock-only deviation, MERGE_DECISIONS D6).

**What the backend must not change**: the envelope, check-report, marker, spec and bundle shapes, the endpoint shapes of the frozen API, and the headers of section 10. A change to any of them is a change to `docs/CONTRACTS.md`, the shared module and the test that pins them, together.

## Adding anything else
Put it in its own top-level directory, give it its own tests, list it in the layering table of `integration/test_boundaries.py` (`ALLOWED`/`PKG_DIR`) with the packages it may import, and add its row to section 1 of the contracts. If a new tool emits check findings, take a new id letter in `CHECK_ID_PREFIXES`.
