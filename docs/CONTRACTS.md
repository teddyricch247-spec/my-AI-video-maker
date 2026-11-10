# vbeat contracts

The one document later agents read first. It states every interface that crosses a piece boundary and says which file is the
authority for the detail. Where two pieces disagreed, the winner is stated here and the reasoning is in
[MERGE_DECISIONS.md](MERGE_DECISIONS.md) (decision numbers D1, D2, ... are referenced below). Tests that fail when a statement here
stops being true live in `integration/` (named per section).

Paths are relative to the repo root. Python 3.11+. Times are seconds unless a name ends in `_ms`.

## 1. Layout, layering, boundaries

| directory | what | runs on | may import |
|---|---|---|---|
| `shared/` (`vbeat_shared`) | time model, transcript ingest, marker kinds, JSON envelope and check-report rules, asset manifest/index rules, preview bundle and headers | **web server and render machine**; standard library only | nothing |
| `engine/` (`vbeat_sprite`, `runtime/`) | Playwright/Chromium renderer, scene runtime (JS), checks, silent video | render machine | `vbeat_shared` |
| `audio/` (`vbeat_audio`) | synthesis toolkit, sandboxed cue-script runner, checks, preview image, mux | render machine (numpy, scipy, Pillow, ffmpeg) | stdlib + numpy/scipy/Pillow only; **no vbeat package** (D6) |
| `pipeline/` (`vbeat_pipeline`) | the documented render command; runs the two tools above as child processes | render machine | `vbeat_shared` |
| `motion-assets/` | asset library (`assets/`), its tools (`tools/`), demos, refs, QA | modules: browser; tools: render machine | tools: `vbeat_shared` |
| `frontend/` | web UI (`web/`, no build step, no external resources), mock server, e2e tests | browser; mock: anywhere | UI: nothing but itself |
| `devserver/` | stand-in for the missing backend: mock API + real beats through the real runtime | anywhere (stdlib) | `vbeat_shared`, `frontend/mock` |
| `examples/` | an example transcript and beat (scene + cue) on the real library | - | - |
| `integration/` | tests for the seams | render machine | everything |

Enforced by `integration/test_boundaries.py`: `shared` imports only the standard library (also under an import-blocking hook); Playwright,
numpy, scipy, Pillow, ffmpeg appear only in render-machine code; the web UI has no build step and loads nothing external; no module
of `shared` is copied elsewhere; there is exactly one `core.js`, `palette.js`, `fonts.css` and browser `runtime.js` outside test fixtures
and the mock; package layering matches the table. The 512 MB / 0.1 CPU web server needs only `shared/src` on `PYTHONPATH`.

Single sources of truth: core helpers, palette, fonts → `motion-assets/assets/core/`; time model → `vbeat_shared.timeline`; envelope and
check-report shapes → `vbeat_shared.envelope`; marker kinds → `vbeat_shared.markers`; manifest/index rules → `vbeat_shared.assets`;
bundle and headers → `vbeat_shared.preview`; browser runtime → `engine/runtime/runtime.js`. Pieces that cannot import `vbeat_shared`
(audio, the JS runtime, `motion-assets/tools/check.py`) keep a literal copy that `integration/test_seams.py` pins to the shared value.

## 2. Commands and the JSON envelope

Every command of every tool prints **exactly one line of JSON** on stdout (progress goes to stderr):

```
{"ok": bool, "command": str, "artifacts": {name: path}, "report": obj|null, "timing_ms": {...}, "error": null | {"type", "message", ...}}
```

`ok` = the tool ran and produced what was asked. `report.ok` = the thing checked passed. Validate with `vbeat_shared.envelope.validate_envelope`.

**Exit codes differ per tool (D3), so callers must read the envelope, never the exit code alone.** `vbeat_shared.envelope.classify(env)` returns
`PASS | REPORT_FAILED | CONTENT_FAULT | TOOL_FAILED`.

| tool | 0 | 1 | 2 |
|---|---|---|---|
| `vbeat_sprite` | ok, **or** a scene fault (`ok:false`, `error.type` in SceneError, LoadError, MarkerError, SceneTooLarge, RenderTimeout) | tool error (SpecError, ValueError, TimelineError, FfmpegError, VerificationError, ...) | UsageError |
| `vbeat_audio` | report passed | report failed (an error finding) | tool failure or usage |
| `vbeat_pipeline` | every stage passed | a stage found the beat broken, or the final file failed verification | tool failure or usage |

Commands: `vbeat_sprite` → `ingest`, `spec`, `strip`, `frames`, `check`, `markers`, `video`, `bench` (flags: `engine/docs/INTERFACES.md`);
`vbeat_audio` → `spec`, `render`, `mux`, `catalog`, `docs`, `selftest` (flags: `audio/docs/AUDIO_INTERFACES.md`); `vbeat_pipeline` → `render-beat` (section 11).
Python callers may use `vbeat_sprite.api` / `vbeat_audio.api` instead of a subprocess; results are identical.

## 3. Time model, transcript, beat spec

- fps ∈ {24, 25, 30, 60}; sample clock 48000 Hz (`samples = frames * 48000 // fps`, exact); export sizes 1280x720, 1920x1080, 2560x1440, 3840x2160
  (16:9 only). The logical canvas is always 1280x720 and is scaled at render time.
- Milliseconds are the source of truth for words; the frame grid is derived: `frame = (ms*fps + 500) // 1000` (half-up). Ranges are half-open `[f0, f1)`.
  Beats are contiguous; cuts sit at the integer midpoint of the pause between words; the first beat starts at 0; the last ends `tail_ms` (600) after its last word.
- **Beat-local time = `(frame - beat.f0) / fps`.** Every downstream consumer (runtime `rt.words`, audio `ctx.words`, the preview) uses the word's frames,
  not its milliseconds (D6). `BeatDetail.words[].f0` in the web API is *project-absolute*.
- Transcript input (`ingest`, `vbeat_shared.ingest`): JSON with a top-level `words` list (`{"text","start_ms","end_ms"}`; a bare list and Whisper-style `segments` are accepted too; the exact key spellings are in `shared/src/vbeat_shared/ingest.py`), cue-like segments
  (interpolated per word, and reported as such), SRT and VTT. Word ids are assigned `w0001...` in order and are stable for the project.
- Beat spec (`spec.json`, written by `vbeat_sprite spec`; relative paths resolve against the spec's directory):

```
{"project": {"fps": 30, "width": 1920, "height": 1080},
 "beat": {"idx": 3, "f0": 300, "f1": 450, "title": "", "direction": "", "mode": "technical|story|either", "allow_blank_start": false},
 "words": [{"id": "w0101", "text": "The", "start_ms": 10000, "end_ms": 10180, "f0": 300, "f1": 305}],   // this beat's words only, project-absolute frames
 "scene": "scene.js", "assets_dir": "assets", "media": {"img1": "file.png"}, "params": {}}
```

`scene`, `assets_dir`, `media` values are **render-machine paths**. They never leave the server: the preview receives `vbeat_shared.preview.public_spec` (D1).
Tests: `shared` and `engine` suites (time, ingest, spec), `integration/test_seams.py` (audio and frontend agree with the time model).

## 4. Marker format

A marker is `{"id": str, "t": float, "kind": str}`: `t` in beat-local seconds within `0..dur`, ids unique within a beat, **kind ∈ `pop`, `tick`, `whoosh`,
`thud`, `stamp`, `slide`, `chime`, `rustle`** (`vbeat_shared.markers.MARKER_KINDS`). A scene exports `markers(rt)`; asset modules export
`markers(params)` per asset; `rt.lib.markers(id, params)` returns an asset's markers on the beat clock. Invalid markers raise `MarkerError` (loud).
`vbeat_sprite markers` writes `markers.json` (`[{...}]`); `vbeat_audio spec --markers` reads that file (an object `{"markers":[...]}` also works) and
clamps markers to the beat. Marker ids come from the asset library (e.g. `tech/big-stat` emits `kicker`, `count-0..`, `done` (thud), `label` (pop)); cue scripts address them by id.
Tests: `integration/test_seams.py` (the literal copies of the kind list), `integration/test_pipeline.py` (a cue on the real library's `done` marker lands on its frame).

## 5. Scene runtime API (what scene authors and agents write against)

A scene is an ES module with no imports that exports `draw(rt, t)` (required, pure in `t`), `markers(rt)` (optional), `meta` (optional). Frame `n` is drawn at `t = n/fps`;
the runtime fills the paper colour first.

`rt.g, W, H (1280x720), fps, frames, dur, t`; `rt.words` = `[{id,text,start,end,i}]` (beat-local seconds); `rt.at(id, edge='start'|'end', offset=0)`; `rt.range(idA, idB)`;
`rt.param(name, dflt)`; `rt.rng(seed)`; `rt.ease={cl,lerp,eo,eio,eb}`; `rt.A(delay, dur)`; `rt.layer(key,w,h)`; `rt.media(id)`; `rt.core`, `rt.palette`;
`rt.lib.get(id) | list() | draw(id, t, params) | markers(id, params)`. Unknown ids throw with the five nearest ids. Forbidden in scenes (lint C1): Math.random, Date,
timers, rAF, network, eval/Function, dynamic import, web storage, `document`, shadowBlur. Authority: `engine/docs/INTERFACES.md`.

**Browser entry** (`engine/runtime/runtime.js`, loaded by the render page and by the web preview alike):

```js
const mod = await import(runtimeUrl);
const eng = await mod.createRuntime({ canvas, spec, baseUrl, sceneUrl });   // sceneUrl optional; default baseUrl + 'scene.js' (D1)
eng.drawFrame(t, scale)   // synchronous; canvas becomes 1280*scale x 720*scale; throws SceneError{t, message}
eng.markers()             // [{id, t, kind}]
eng.info                  // {fps, frames, dur, words, assets, modules, source}
```

It fetches `<baseUrl>_index.json` (module list), imports `<baseUrl>assets/core/palette.js`, `core.js`, every listed module, loads `core/fonts.css` when the index says so,
and imports the scene from `sceneUrl`. `spec.media` must map ids to URLs. The runtime never compiles code at run time (no `unsafe-eval`).
Render-page-only API (`window.vb`, lint, page checks, contact sheet) stays in `engine/runtime/harness.*` and is not served to browsers.
Tests: `integration/test_preview_seam.py` (real runtime, real library, real scene, in the sandboxed frame; pixels equal `vbeat_sprite frames`).

## 6. Check-report format

```
{"ok": bool, "counts": {"error": n, "warn": n}, "findings": [{"id", "severity", "t", "message", "data"}], "text": "..."}
```

`severity` ∈ error | warn | info (info is not counted); `ok` is true exactly when there is no error; `counts` equals the findings; `text` has one line per finding
(`C4 error @1.20s: ...`, no findings → `OK: no findings`). The engine adds `level`, `sampling`, `timing_ms`. **Finding ids are a letter plus digits and the letter names the tool**:
`C` = `vbeat_sprite` (C1 lint, C2 load/console/network, C3 draw throws, C4 text bounds, C5 text overlap, C6 blank first/last frame, C7 static for ≥2.5 s, C8 determinism, C9 media),
`A` = `vbeat_audio` (A0 script failed, A1 length, A2 NaN/silent, A3 clipping run, A4 density, A5 cut/long cue, A6 spectrum, A7 levels (info), A8 uncovered marker (info), A9 anchor, A10 DC offset).
A new tool takes a new letter in `vbeat_shared.envelope.CHECK_ID_PREFIXES`. `validate_check_report` enforces all of this; the pipeline validates every report it receives.
The web API's `Check` object `{ok, counts, text}` is a projection: `vbeat_shared.envelope.check_projection(report)`. Authority for the ids: `engine/docs/INTERFACES.md` and `audio/docs/AUDIO_INTERFACES.md`.

## 7. Cue scripts, ctx API, SFX spec

`vbeat_audio spec --beat spec.json [--markers markers.json] --out sfx/spec.json [--seed N] [--peak-dbfs X]` writes
`{"fps","frames","samples","dur","words":[{"id","start","end"}],"markers":[{"id","t","kind"}],"peak_dbfs","seed"}` (beat-local seconds; words on the frame grid, section 3).
A cue script is a Python file that imports only numpy, scipy (signal, ndimage, fft), the standard-library maths modules and the injected `synth`, and defines `render(ctx)` returning a mono float array:

```python
from synth import *
def render(ctx):
    m = ctx.mix()
    m.add(ctx.marker('done'), wood_thunk(pitch=125), gain_db=0, name='thunk', anchor='done', align='peak')
    return m.render()
```

`ctx.sr, fps, samples, dur, words, markers`; `ctx.at(word_id, edge, offset)`; `ctx.marker(id)`; `ctx.marker_times(kind)`; `ctx.rng(label)`; `ctx.mix()`. `Mix.add(t, x, gain_db, name, anchor, align)`,
`Mix.add_group(name, [(t, x), ...], gain_db=..., anchor=...)`, `Mix.render()`. Refused statically (finding A0): other imports, `open exec eval compile ...`, dunders, `os sys subprocess ...`, `.format`, `numpy.random`, `random`.
It runs in a resource-limited child process. Output: 16-bit mono 48 kHz wav of exactly `ctx.samples` samples, normalised to `peak_dbfs` (default -6). `render` writes `sfx.wav`, `sfx_preview.jpg`, `cues.json`, `metrics.json`;
`mux --video v.mp4 --wav sfx.wav --out final.mp4` writes AAC 192k / 48 kHz stereo (or `--codec pcm_mov`), copies the video stream and verifies with ffprobe. Style rules: `audio/sfx/sfx-style.md`; details and the full finding list: `audio/docs/AUDIO_INTERFACES.md`.
Tests: `audio` suite; `integration/test_seams.py` (audio spec from a real engine spec), `integration/test_pipeline.py`.

## 8. Asset library

- **Ids** are `<namespace>/<name>` in lower case. Registered namespaces (`vbeat_shared.assets.NAMESPACES`): `tech/*`, `obj/*`, `fx/*` (this library), `people/*`, `env/*`, `story/*` (the story zip, not yet present).
  An unregistered namespace is an error until one line is added there.
- **Core API (frozen)**: `assets/core/core.js` (helpers: `A cl eb eio eo fontsReady getLayer grainOver halftoneDisc lerp poly polyAt resetG rng rrect shade strokePoly tiled txt vignette`),
  `assets/core/palette.js` (`W H INK PAPER TOMATO MUSTARD GREEN PINK AQUA CREAM LEAF SHADOW SERIF MONO SANS`), `assets/core/fonts.css`. They exist once; a second copy is an error (`DUPLICATE_CORE`).
  The engine's `tests/fixtures/assets/core` is a *stub* for the engine's own tests; `integration/test_seams.py` fails if it exposes a name the real core lacks. Stub values (e.g. ink colour) differ from the real ones; never render a delivered beat against it.
- **Module**: a `.js` file under `assets/` (not in `core/`, `_dev/` or a dot-directory) with `export const assets = { '<id>': { meta, draw(g, t, params), markers?(params) } }`; `meta` per `motion-assets/README.md`.
- **Manifest** `assets/manifest.json` = `{"modules": [...]}` lists the modules the page imports; **index** `assets/index.json` = `{"version":1,"count","modules","assets":[{id, kind, mode, description, params, anchors, markers, module, ...}]}` is evaluated from the modules in a browser.
  Both are generated: `make index` (= `motion-assets/tools/build_index.py`, then `scripts/check_assets.py`). The rule "which files are modules" and the file formats live in `vbeat_shared.assets`.
- **Loud failures**: `build_index.py` exits 1 and prints `DUPLICATE id ...` on a collision (the runtime throws too); `scripts/check_assets.py` (no browser) reports `STALE_MANIFEST`, `STALE_INDEX`, `NO_INDEX`, `ID_COLLISION`
  (found statically in sources and in the index), `UNKNOWN_NAMESPACE`, `BAD_ID`, `BAD_MARKER_KIND`, `MISSING_CORE`, `DUPLICATE_CORE`. A module dropped in without re-indexing is *reported*, never silently ignored.
- Drop-in procedure for a new asset zip: `docs/EXTENDING.md`. Tests: `integration/test_assets_tree.py`, `shared/tests/test_assets.py`.

## 9. Web API contract, preview bundle, URL space

- **Web API**: `frontend/docs/API_CONTRACT.md` is the frozen v1 contract (auth by cookie, projects, beats, sessions, scene/sfx versions, exports, settings, status polling with `rev`, errors as `{error:{code,message}}`);
  `frontend/mock/server.py` implements all of it in memory and `devserver/server.py` reuses the mock. A real backend implements the same document. `frontend/docs/BACKEND_NEEDS.md` lists what the UI needs beyond the endpoints
  (Range requests on audio, multipart uploads, the `rev` parameter, headers). Check objects use `check_projection` (section 6).
- **`GET /api/beats/{id}/preview` → PreviewBundle**, built by `vbeat_shared.preview.build_preview_bundle` and validated by `validate_bundle`:

```
{"fps": 30, "frames": 121, "dur": 4.0333, "width": 960, "height": 540,
 "runtime_url": "/preview/runtime/runtime.js", "assets_base_url": "/preview/", "scene_url": "/preview/scene/<beat>/<n>.js",
 "spec": <engine beat spec WITHOUT scene/assets_dir, media = id -> URL>, "media": {id: url}, "wav_url": "/files/sfx/<beat>/<n>.wav" | null}
```

  `width` is the preview canvas width (multiple of 16, ≤ 1280, 16:9); the player draws at `scale = width / 1280`. `frames = beat.f1 - beat.f0`; `dur = frames / fps`. `spec.media` equals `media`. All URLs are root-relative.
- **URL space** (the render machine's local server space, under a prefix; the backend may choose the prefix, the dev server uses `/preview/engine/`):
  `<prefix>runtime/runtime.js` (the only runtime file served), `<prefix>_index.json` (`vbeat_shared.assets.list_asset_modules`), `<prefix>assets/**` (the library; traversal-safe `safe_join`), `scene_url` (versioned, immutable cache),
  media URLs (declared media only). Nothing else.
- **Player**: `frontend/web/js/preview-adapter.js` is the only frontend file that touches the engine; it implements section 5's entry exactly. Beat-local time of a word = `(word.f0 - beat.f0) / fps`.
  Tests: `integration/test_preview_seam.py`, `integration/test_seams.py` (bundle and URL space over HTTP), `frontend/tests/e2e.py` (UI against the mock runtime, which mirrors the real return shape).

## 10. HTTP headers the sandboxed preview needs

The player embeds `/preview-frame.html` as `<iframe sandbox="allow-scripts">` (never `allow-same-origin`): the frame has an opaque origin, no cookies, no storage, no access to the parent.
Constants: `vbeat_shared.preview` (`PREVIEW_CORS`, `FRAME_CSP`, `RENDER_CSP`, `IMMUTABLE`, `REVALIDATE`, `MIME`).

| where | header | value |
|---|---|---|
| every URL the frame loads (frame html, runtime, `_index.json`, asset modules, `fonts.css`, font files, scene, media, wav) | `Access-Control-Allow-Origin` | `*` (fonts and `fetch` are CORS requests from an opaque origin) |
| same | `Cross-Origin-Resource-Policy` | `cross-origin` |
| same | `Access-Control-Expose-Headers` | `Content-Length, Content-Range, Accept-Ranges` |
| same | `X-Content-Type-Options` | `nosniff` (so correct `Content-Type`s matter: `text/javascript` for modules, `font/ttf` etc. in `MIME`) |
| `/preview-frame.html` only | `Content-Security-Policy` | `sandbox allow-scripts; default-src 'none'; script-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; frame-ancestors 'self'` |
| wav | `Accept-Ranges` | `bytes`, and `206` + `Content-Range` for `Range:` requests (seeking and the audio clock need it) |
| scene URL, media | `Cache-Control` | `public, max-age=31536000, immutable` (URLs change with the version) |
| runtime, `_index.json`, assets | `Cache-Control` | `no-cache` |
| the render machine's local page (not the browser preview) | `Content-Security-Policy` | `RENDER_CSP` (`default-src 'none'; script-src 'self'; ...`) plus `Cache-Control: no-store` |

Tests: `integration/test_seams.py` (headers over HTTP, mock pinned to the shared constants), `integration/test_preview_seam.py` (the frame really loads under them).

## 11. Rendering a beat: the documented sequence

```
make example      # = python -m vbeat_pipeline render-beat --transcript examples/transcript.json --from-word 0 --to-word 8 \
                  #     --scene examples/beats/big_number/scene.js --cue examples/beats/big_number/cue.py --out out/big_number --size 1280x720
```

Stages, in order; each is one command and is verified from its envelope before the next starts; the first failure stops the run and is named in `pipeline.json`:
`ingest` → `spec` → `strip` (preview image) → `check` (visual checks; any error stops) → `markers` (kinds validated) → `video` (silent H.264, ffprobe-verified) → `sfx_spec` → `sfx_render` (audio checks; any error stops) → `mux` → `verify`.
`verify` (independent of the tools): one H.264 video stream with the spec's size, fps and exactly `f1 - f0` frames; one AAC stream at 48 kHz whose duration is within about a frame of the video; the file decodes without errors; the audio is not silent.
With `--no-sfx` the sequence ends after `video` and `verify` asserts there is no audio stream. `--assets` defaults to `motion-assets/assets`.

Beat directory (`--out`) is a self-contained snapshot: `transcript.json spec.json scene.js cue.py strip.jpg report.json markers.json video.mp4 sfx/{spec.json,sfx.wav,sfx_preview.jpg,cues.json,metrics.json} final.mp4 pipeline.json`.
`pipeline.json` = `{"ok","failed_stage","failure","stage_order","stages":{name:{ok,outcome,command,artifacts,report,timing_ms,error,wall_ms}},"final"}`. `devserver/server.py --beat <dir>` plays such a directory in the web UI.
Sequence without the pipeline: the same commands with the flags in `engine/docs/INTERFACES.md` and section 7. Tests: `integration/test_pipeline.py`.

## 12. Resolved disagreements and open items

Resolved directions (details and reasons in MERGE_DECISIONS.md): D1 the frontend adapter conforms to the engine's runtime (the engine only gains the optional `sceneUrl`); D2 one real core, the engine's stub is a test fixture pinned to the real API surface;
D3 exit codes stay per tool, the envelope is authoritative; D4 the check report is the superset of both tools, `Check` is a projection; D5 one marker-kind list; D6 frames are the shared grid, audio stays import-independent and is pinned by tests;
D7 the manifest rule is one function and a stale manifest is an error; D8 namespaces are registered in one place.
Not verified by the builders and not verified here: see "Open items" in MERGE_DECISIONS.md. Extension points for story assets, the agent runner and the backend: `docs/EXTENDING.md`.

## 13. Agent runner (`agent/`, package `vbeat_agent`)

| directory | what | runs on | may import |
|---|---|---|---|
| `agent/` | an LLM (via OpenRouter) authors one beat's `scene.js` + `cue.py` with tools; many beats in parallel | render machine | `vbeat_shared` and the standard library (Pillow optionally, lazily). The engine, audio and pipeline are driven **only as subprocesses** and read through the envelope (`classify`). Enforced by `integration/test_boundaries.py`. |

Public interface (`from vbeat_agent import ...`; async unless noted; details in `agent/README.md`, events in `agent/docs/EVENTS.md`):

- `BeatRequest(beat_dir, transcript, from_word, to_word, fps, width, height, idx, title, direction, mode, media, sfx_enabled, bible, neighbours, model, caps, params)` → `BeatResult(status, status_reason, summary, question, scene_n, sfx_n, final_video, steps, cost_usd, wall_s, last_report, explanation, run_steps, run_cost_usd, run_wall_s, unknown_cost_calls)`.
  `status` is `waiting_user | needs_attention | failed | cancelled`; `explanation` is `{code, what, why, fix}` in plain language (None after a normal finish).
- `run_beat(req, sink, cancel, *, llm, settings, budget)`, `continue_beat(beat_dir, message, sink, cancel, caps_override)` (also resumes after a kill), `revert_beat(beat_dir, scene_n, sfx_n)` (sync), `run_beats(requests, sink, cancel, *, concurrency, total_max_usd)` (results in request order).
  Nothing raises for what happens *during* a run; `BeatBusy` means another process holds the beat.
- `EventSink` / `FileEventSink` / `CallbackSink`, `events_to_messages(events, url_for, start_seq)` → the frozen API's `Message` objects.
- Operations (sync, JSON-able, plain-language what/why/fix): `preflight()`, `selftest()`, `diagnose(beat_dir)`; the kill switch (`kill_switch_engage/release/engaged`, `<state_dir>/KILL`, `VBEAT_KILL=1`) and the spend ledger (`SpendLedger`, default caps $0.50 per beat, $5 per run, $10 per day).
- Secrets: the OpenRouter key is read only from `OPENROUTER_API_KEY`; it is never logged, persisted or passed to tool subprocesses.

Files it writes in a beat directory, besides the section 11 files: `versions/scene_NNN.js`, `versions/cue_NNN.py` (+ `.check.json`, `.report.json`, `.wav`, previews) and `agent/{request.json, state.json, conversation.jsonl, events.jsonl, llm_calls.jsonl, transcript.md}`. `scene.js` / `cue.py` are plain copies of the current version. Tests: `agent/tests/` (scripted model, local fake OpenRouter) and the boundary rules in `integration/test_boundaries.py`.
