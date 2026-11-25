---
name: inkbeat-paper
description: Mode 2 — Flat-pastel 2D paper-cutout motion videos in 9:16 (Shorts) and 16:9 (YouTube long form), from a word-timestamp transcript plus reference photos or a prompt. Offline HTML5 2D Canvas + 122 modular rigged/parallax assets (Playwright, ffmpeg; no internet; ultra-fast on CPU) with 2D beat camera (cam2d.js), per-format captions, motion blur, seamless >30s part splitting, optional SFX markers, and QA. Renders locally and never uploads or adds voice/music unless asked.
---

# inkbeat-paper: 2D paper-cutout Shorts and long-form videos (Mode 2)

**Working rules for this skill (the owner's requirements override anything below):**
1. **Both formats.** `9:16` for Shorts (default) and `16:9` for YouTube long form (`--aspect 9:16|16:9`). One scene file frames both through `ctx.landscape`.
2. **Start at once.** Input is a word-timestamp transcript (`words.txt`), plus optional reference photos and/or prompt. Do not pause for approval at gates; state defaults in one line, run `--beatcheck` first to verify `beatcheck.jpg`, then render a `draft` immediately.
3. **Render is not save.** Rendering writes only to `/tmp/inkbeat-renders/<slug>` and never uploads on its own. After a draft render, reply with `s/frame`, duration, and `"not saved to Supabase yet — say save when ready"`. Upload only when the owner asks (with `--style paper` via `scripts/upload.mjs` or `skill/inkbeat-paper/pipeline/publish.mjs`), then reply with ordered `Watch:` links, mode, `s/frame`, and file sizes.
4. **No voice-over and NO music, ever.** No TTS, no voices, no background music bed. Captions + **SFX-only** stem (`--audio` or `--auto-sfx` synthesized from scene `markers()`).
5. **Captions by format.** `9:16`: 1–2 lowercase words popping on word onsets, large at 70% height. `16:9`: small full sentence at 91.5% bottom centre, spoken word lit in `--accent`.
6. **Long videos come in parts.** Over 30 s, rendered into equal parts (<=30 s) cut on pauses between words so parts stitch seamlessly.
7. **Size limit.** Supabase free tier rejects >50 MB, so anything over 45 MB is shrunk automatically during upload (`libx264`, CRF 23).

---

## 0. Pipeline architecture & stage coordinates

Every scene in `inkbeat-paper` is built on a **1280 x 720 (`W x H`) virtual stage** using the prebuilt 2D canvas modules in `assets/`, and viewed through the 2D camera rig in `pipeline/lib/cam2d.js`:

- **Virtual stage:** `x` in `0..1280`, `y` in `0..720`. Outdoor ground lines typically sit around `y = 520..650`; indoor floors around `y = 560..640`; desk tops around `y = 735..740` with half-body seated characters at `y = 785..800`.
- **Scene module contract:**
  Export `build(ctx) -> { update(g, t), markers?() }` (and optional `words` fallback when `--transcript` is omitted).
  `ctx` provides `{ w, h, fps, landscape, aspect, stageW: 1280, stageH: 720 }`.
  Inside `update(g, t)`:
  1. Call `applyCam2d(g, cam(t), ctx)` first so the virtual `1280 x 720` set maps crisply onto the output canvas (`540x960`..`1080x1920` or `960x540`..`1920x1080`).
  2. Draw layers back-to-front: sky/interior -> far hills/buildings -> street/furniture -> mid/background crowd or characters sorted `byY` -> foreground trees/vehicles/bunting -> `vignette(g, ...)` + `grainOver(g, ...)`.
- **Built-in reference scenes** (`pipeline/scenes/`):
  - `paper_test` — 3 s smoke test (also used by `doctor.py`).
  - `city_demo` — wraps `story/city-street` with portrait tracking camera vs calm landscape cuts.
  - `office_demo` — wraps `story/office-day` (half-body seated presenters, live whiteboard writing, desk depth).
  - `explainer_demo` — modular presenter + whiteboard + classroom template to copy to `/tmp/inkbeat-work/<slug>.js`.

Modes:
- `draft`: `540x960` (`9:16`) or `960x540` (`16:9`), 1 sub-frame (`SUB=1`). Extremely fast on CPU (~0.02–0.05 s/frame).
- `fast`: `720x1280` / `1280x720`, 4 sub-frames motion blur.
- `final`: `1080x1920` / `1920x1080`, 8 sub-frames motion blur.
All modes encode upscaled H.264 MP4s at crisp full `1080x1920` or `1920x1080`.

---

## 1. Two camera grammars (`cam2d.js`)

Use **one scene file** for both aspect ratios by switching `beats` on `ctx.landscape`:

### Shorts (`9:16`, default)
- In `9:16`, at `viewH = 720` the camera sees **405 px** wide out of the 1280 px stage (`clampPoseToStage` keeps the viewport cleanly inside `0..1280 x 0..720`).
- **Keep faces in the upper 30–45% of the screen** so captions at **70%** never touch mouths or eyes:
  - A full-body standing character (`s = 1.0..1.2`, feet at `y = 600`, height ~180 px, head around `y = 460`) reads best with `viewH: 480..580` centered around `atPos: [charX, 460..510]`.
  - A seated half-body character (`half: true`, `s = 1.9..2.1`, desk top `y = 735`, head around `y = 510`) reads best with `viewH: 540..620` centered around `atPos: [charX, 430..455]`.
- **Beat cadence:** new beat every ~0.9–1.5 s (about 45–60 beats/min), anchored ~0.2 s before key words (`LEAD = 0.2` in `makeCam2d`). Gentle `drift: 0.025`, `arc: 8` keeps held beats breathing without dizzying whips. Use `{ cut: true }` when jumping across the stage (e.g., presenter -> whiteboard -> listener).
- **Show objects mentioned in the script:** if a speaker mentions a plan, bus, chart, laptop, weather, or crowd, pan or cut (`atPos`) onto the matching prop/whiteboard/vehicle on that word!

### Long form (`16:9`, `--aspect 16:9`)
- Wrap beats with `calm2d(beats, { zoom: 0.08, every: 2 })` and `{ drift: 0, arc: 0 }`:
  - `viewH: 720` at `[640, 360]` shows the **entire 1280 x 720 stage** cleanly.
  - Hold framings 3–6 s, use clean hard cuts (`cut: true`, zero roll), and reserve medium crops (`viewH: 560..620`) with a gentle slow eased `zoom: 0.08` on ~1 beat in 2–3.

---

## 2. Determinism & flicker rules (mandatory)

Every asset and custom scene **must be a pure function of time `t` (in seconds)**:
1. **NEVER use `Math.random()`, `Date.now()`, or `performance.now()`**. Use deterministic `rng(seed)` from `assets/core/core.js`.
2. **NEVER store mutable animation state across frames** (no module-level counters `frame++` or accumulating positions `x += v * dt`). Always compute positions from `t` via `travelDist(t, ...)` or closed-form math (`cl`, `lerp`, `eo`, `eio`, `Math.sin`).
3. **All text must go through `txt(g, str, x, y, opts)`** with effective pixel size `>= 14` px (`Poppins` / `Lora` / `DejaVu Sans Mono`).
4. **Short labels on vehicles & signs:** keep bus/taxi/street signs short (<= 8 chars) so text fits comfortably inside sign frames.
5. **No sliding feet:** when moving a walking/running person horizontally, compute their `x` with `walkFrom(...)` + `travelDist(...)` matching `walk.speed` so planted feet lock cleanly to the ground.
6. **Seated characters:** do NOT write custom sitting legs; use `view: 'front', half: true` with ground `y` below the desk top (`y ~ 785..800`) and draw `drawDesk(..., { y: 735..740 })` **after** (in front of) `drawPerson`.

---

## 3. Prebuilt 2D Asset Library (`assets/`) — use them, do not redraw them

**Read `assets/README.md` before writing a custom scene**, and look at `refs/` PNG sheets if helpful:
- `assets/people/characters.js` — 12 presets (`ama`, `kofi`, `child`, `elder_woman`, `elder_man`, `office_woman`, `office_man`, `developer`, `shopkeeper`, `doctor`, `student`, `rider`) with customizable palette, skin tone, hair, glasses, hats, bags.
- `assets/people/rig.js` — `drawPerson(g, t, spec)` with 2-bone IK arms, 37 gestures (`gestures.js`), 16 hand poses (`hands.js`), 8 face expressions + blinking + speech lip-sync (`talk`), 17 held props (`props-held.js`), and `personMarkers(spec)` for SFX.
- `assets/people/crowd.js` — seeded crowd silhouettes / passersby (`crowd(g, t, opts)`).
- `assets/environment/sky.js` — 7 sky moods (`dawn`, `morning`, `noon`, `golden`, `dusk`, `night`, `overcast`) with cross-fade `to` + `at:{shift,dur}`, clouds, stars, bird flocks.
- `assets/environment/terrain.js` — parallax `drawHills`, `drawMountains`, `drawDunesAsset`, `drawCropRows`, `drawWater` (river/sea ripples), `drawGround` (street/grass/sand/dirt/tile).
- `assets/environment/buildings.js` & `street.js` — `houseVariant` (8), `shopFront` (4), `drawBuilding` (apartment, office_tower, school, clinic, warehouse, kiosk, huts, water_tower), `drawFurniture` (lamp_post, bench, bus_stop, traffic_light, sign, billboard, fountain, stall, crates, fence, bunting).
- `assets/environment/interiors.js` — 5 indoor rooms (`office`, `living_room`, `shop`, `classroom`, `server_room`) + `drawDesk`, `drawChair`, `drawMonitor`, `drawWindow`, `drawShelves`, `drawWhiteboard` (animated line-by-line write-on + rising chart), `drawWallClock`, `drawPosterFrame`, `drawServerRack`.
- `assets/environment/vehicles.js` — 10 vehicles (`bus`, `car`, `taxi`, `motorbike`, `bicycle`, `handcart`, `truck`, `boat`, `train`, `plane`) whose wheels rotate strictly with ground distance.
- `assets/environment/plants.js` & `weather-fx.js` — 10 swaying plants/trees + rain, snow, mist, sparkles, dust motes, ripples.
- `assets/story/` — 9 complete multi-layer scenes (`city-street`, `office-day`, `village-morning`, `market-street`, `desert-dunes`, `bus-stop-wait`, `home-evening`, `river-crossing`, `farm-field`) ready to compose or customize!

---

## 4. Audio (SFX-only, never voice or music)

- **Never generate voice-over or music.**
- When SFX audio is requested:
  - Pass `--auto-sfx` to `make_video.py` so `make_sfx.py` synthesizes a subtle, deterministic 48 kHz SFX stem directly from your scene's `markers()` (`pop`, `tick`, `whoosh`, `thud`, `slide`, `rustle`, `chime`), leveled cleanly underneath future narration.
  - Or pass a custom SFX-only `.wav` stem with `--audio /tmp/inkbeat-work/sfx.wav`.

---

## 5. Checklist before delivering a draft

1. Ran `python3 skill/inkbeat-paper/pipeline/doctor.py` -> `ALL GOOD`.
2. Checked `--beatcheck` (`beatcheck.jpg`) — zero empty margins, zero cropped faces, captions at 70% never overlap eyes/mouths, readable whiteboards/signs.
3. Rendered `--mode draft` to `/tmp/inkbeat-renders/<slug>`, inspected `sheet*.jpg`.
4. Left zero temp files inside the repo; nothing uploaded to Supabase unless explicitly asked.
