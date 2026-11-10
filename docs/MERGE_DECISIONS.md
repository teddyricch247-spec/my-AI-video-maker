# Merge decisions

The four pieces were built in isolation from frozen briefs, so they never saw each other. This records every place where they disagreed or overlapped, the direction chosen, the edits made to builders' code, and what is still unverified.
Builders' own records stay where they were written: `engine/docs/DECISIONS.md`, `audio/docs/DECISIONS.md`, `motion-assets/docs/B-decisions.md`, `frontend/docs/DECISIONS.md`.
Working rule used: each piece's internals were taken as correct; the merge changed seams, not internals.

## Disagreements and overlaps

**D1. Preview engine interface (frontend ↔ engine).** The frontend had to guess the engine's browser API. Differences found by reading both: the frontend expected `dur/fps/frames` on the runtime object (the engine puts them in `info`);
it passed `sceneUrl` (the engine always imported `baseUrl + 'scene.js'`); it kept `bundle.media` apart from `spec` (the engine loads images from `spec.media`); it treated `spec` as opaque and set the canvas to the bundle's width (the engine sizes the canvas itself: `1280 * scale`).
*Decision: the frontend adapter conforms to the engine* (`frontend/web/js/preview-adapter.js`: reads `eng.info`, passes `spec = {...bundle.spec, media: bundle.media}`, draws at `scale = width/1280`). The engine gains one backward-compatible option, `sceneUrl`, because scene URLs are versioned per beat and the browser cannot serve them at `/scene.js`.
`PreviewBundle.spec` is now defined as the engine spec without server paths (`vbeat_shared.preview.public_spec`). The mock runtime (`frontend/mock/mock-runtime/runtime.js`) was changed to return the same shape (`info`), so the UI's own e2e still exercises the adapter. Pinned by: `integration/test_preview_seam.py` (breaking either side was tried: the test fails), `integration/test_seams.py`.

**D2. Two cores.** The engine's tests use a stub core and palette (`engine/tests/fixtures/assets`); the asset library ships the real ones; their values differ (e.g. ink `#1B1A17` vs `#221E1A`, different `rng`). *Decision: the real files in `motion-assets/assets/core/` are the only core; the stub stays solely as the engine's test fixture* (replacing it would change what the engine's tests assert).
Pinned by: no other `core.js`/`palette.js`/`fonts.css` anywhere (`test_boundaries`), and the stub's export names must be a subset of the real ones (`test_seams`). The engine's `bench` command defaults to a built-in scene over whichever assets it finds first; pass `--assets motion-assets/assets` for numbers on the real library.

**D3. Exit codes.** Engine: 0 for a scene fault (`ok:false`), 1 tool error, 2 usage. Audio: 0 pass, 1 report failed, 2 tool failure. Both were frozen with tests of their own, so neither could be changed without weakening them.
*Decision: exit codes stay per tool and are documented side by side; the envelope is authoritative* (`vbeat_shared.envelope.classify`). The pipeline (new) follows the audio convention. Pinned by `shared/tests/test_envelope.py` and `integration/test_seams.py`.

**D4. Check reports.** Engine: `{ok, level, counts, findings, text, sampling, timing_ms}`, severities error|warn. Audio: `{ok, counts, findings, text}`, severities error|warn|info. Frontend `Check`: `{ok, counts, text}`.
*Decision: the shared definition is the common core (`ok, counts, findings, text`) with `info` allowed and extra keys tolerated; id letters name the tool (C, A); `Check` is a projection* (`check_projection`). The pipeline validates every report it receives, so drift fails a run.

**D5. Marker kinds** existed as four literal copies (engine runtime, audio constants, the asset checker, the asset index). They agree today. *Decision: `vbeat_shared.markers.MARKER_KINDS` is the source; the copies that cannot import it are pinned by test* (`test_seams`; the index is validated by `check_tree`).

**D6. Time model.** `vbeat_shared.timeline` is the source (ms are truth for words; `(ms*fps+500)//1000` half-up; half-open ranges). Audio cannot import it (its own test forbids any other vbeat import), so it keeps `SR`, `ALLOWED_FPS`, `samples_for`, and derives word times from the words' frames, never from milliseconds. *Decision: audio stays independent; its constants are pinned to the shared module by test.*
The frontend's fps/size menus are pinned to the shared lists. Known mock-only deviation: `frontend/mock/server.py` converts ms to frames with Python `round()` (banker's rounding), not half-up; the dev server avoids it by taking `f0/f1` and word frames from the real spec, and the backend must use `vbeat_shared.timeline`.

**D7. Which files are asset modules, and the manifest.** Three implementations: the asset tools (every `.js` outside `core/` with `export const assets`), the engine server (manifest if present, else every `.js` outside `core/`, `_dev/`), and the engine's page. *Decision: one implementation in `vbeat_shared.assets`* (`discover_modules`, `write_manifest`, `list_asset_modules`, `safe_join`), used by the engine server, the dev server and (through `tools/_common.py`) the asset tools.
Because a manifest that is out of date silently hides new modules, staleness is an error (`check_tree`, `make check-assets`, `integration/test_assets_tree.py`).

**D8. Id namespaces** were implicit (a mapping inside the asset tools). *Decision: registered in `vbeat_shared.assets.NAMESPACES`* (`tech obj fx people env story`); unknown namespaces are errors.

**D9. Two CSPs.** The engine's render page and the frontend's sandboxed frame each defined a CSP for their own purpose; both are right for their purpose and are not unified. Both now live in `vbeat_shared.preview` (`RENDER_CSP`, `FRAME_CSP`); the engine server imports its CSP from there, and the mock's copies are pinned to it.

**D10. Test layout.** Engine, audio and the asset tools reuse module names (`tests/helpers.py`, `conftest.py`), so one pytest process cannot hold them. *Decision: each suite runs in its own process* (`scripts/run_tests.py`, `make test`); `integration/` is a suite of its own. `test_timeline.py` and `test_ingest.py` (tests of `vbeat_shared`) stayed in `engine/tests/` because they share transcript fixtures with the CLI tests; `shared/tests/` has the new modules' tests.

## Edits to builders' code (complete list)

- `engine/`: `vbeat_shared` moved out to `shared/`; `server.py` imports `safe_join`, `list_asset_modules`, `RENDER_CSP` from it (definitions removed, same behaviour); `runtime/runtime.js` accepts optional `sceneUrl`; `pyproject.toml` (name `vbeat-sprite`, depends on `vbeat-shared`, pytest `pythonpath`); `assets/README.md` text; `docs/INTERFACES.md` gains a "Browser entry" section (97 lines, under its 150-line limit).
- `engine/tests/` (paths only, no assertion changed): `test_scope.py` finds `vbeat_shared` in `../shared/src` (three path constants/lookups); `test_cli.py` adds `../shared/src` to the child `PYTHONPATH`.
- `motion-assets/tools/_common.py`: `scan_modules` and `write_manifest` call `vbeat_shared.assets` (finds `../shared/src` itself). Generated `manifest.json` is byte-identical to before. The empty directory tree named `{assets` (a shell brace-expansion accident inside the builder's zip) was removed.
- `frontend/`: `web/js/preview-adapter.js` (D1); `mock/mock-runtime/runtime.js` (return shape); `docs/BACKEND_NEEDS.md` section 5 (now describes the verified interface).
- `audio/`: untouched.
- New: `shared/` modules `markers, envelope, assets, preview` and tests; `pipeline/`; `devserver/`; `examples/`; `integration/`; `scripts/`; `docs/`; `Makefile`; `pytest.ini`; `requirements-dev.txt`.
- Constraints that carry over: nothing inside `engine/` may mention the words its scope test bans (audio, sound, LLM, OpenRouter, ...), and `audio/` may not import any other vbeat package. New documents for those directories must respect that.

## Open items (not verified; read before relying on them)

- **pytest was not available** (no network in the build environment); the builders' notes say the same. All suites (shared 24, engine 104, audio 208, integration, frontend e2e, asset `check.py`) were run with a minimal stand-in runner supporting `raises`, `mark.parametrize`, `tmp_path`. They are written for real pytest (`pytest.ini`, per-suite config); the first run on a machine with pytest is the real confirmation (`make test`).
- `audio/tests/test_runner.py::test_cpu_limit_kills_a_busy_loop` is timing-sensitive: it failed once on a loaded machine in the untouched original and in one merged run, and passed on rerun.
- The asset tool's pixel regression against `v2.html` could not run: `v2.html` is not part of the zip (the tool prints a WARN and skips). The other 91 per-asset checks pass on the merged tree.
- **Story assets are not present.** The drop-in procedure was exercised with a synthetic `people/*` module on a copy of the library, not with the real zip.
- The preview was verified in Chromium 141 (same flags as the render machine) only: pixels at scale 0.75 equal `vbeat_sprite frames` output exactly (mean difference 0.0). Safari/iOS/Firefox behaviour of the sandboxed frame, and the real library's frame time on a phone, were not measured (the engine's `bench` measures the render machine, not a phone).
- The dev server is the mock plus real beats; approvals, retries and the chat in the UI still run on the mock's simulated engine. Real beats show real checks only if the beat directory came from the pipeline (`pipeline.json`).
- The pipeline is not tuned for speed (a 4 s beat took about 45 s with `--check-level full` on the build machine) and runs one beat at a time.
- Audio quality (does the thunk sound right) is not something any test can judge; `sfx_preview.jpg` and the wav are in each beat directory for a person or model to look at.
- Carried over from the builders: everything listed in their DECISIONS files that they could not verify, and `frontend/docs/BACKEND_NEEDS.md` (Range requests, multipart uploads, `rev`, headers) is a to-do list for the backend, not something this repo implements.
