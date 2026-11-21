---
name: inkbeat-shorts
description: Toon-shaded 3D cartoon videos in 9:16 (Shorts) and 16:9 (YouTube long form), from a word-timestamp transcript plus reference photos or a prompt. Offline plain-three.js pipeline (vendored three.js, Playwright, ffmpeg; no Remotion, no internet; fast on CPU) with beat-driven camera, ink outlines, per-format captions (1-2 words for Shorts, small full sentences with the spoken word lit for 16:9), motion blur, long videos split into seamless parts, QA, plus an optional Remotion + R3F starter. Renders immediately and never uploads or makes a voice-over unless told. Use it to make a 3D cartoon video, or when a render flickers, shows broken outlines or changes between runs.
---

# inkbeat-shorts: toon-shaded 3D Shorts and long-form videos

**Working rules for this skill (the owner's requirements, they override anything below):**
1. **Both formats.** 9:16 for Shorts (default) and 16:9 for YouTube long form: `--aspect 9:16|16:9`. One scene file frames both through `ctx.landscape`.
2. **Start at once.** The input is a transcript with a timestamp on every word, plus reference photos and/or a prompt. Do not ask for approval at gates; state your defaults in one line, run a fast `--beatcheck` first to verify framing/clipping in `beatcheck.jpg`, then render a `draft` immediately.
3. **Render is not save — reply with the right link.** Rendering writes locally (surfacing automatically in the Next.js **Draft previews** section) and never uploads on its own. After a draft render, reply with the **Next.js Preview link** (`#drafts` on the dev app URL), `s/frame`, and `"not saved to the shelf yet"`. Upload to Supabase only when the owner asks (via `scripts/upload.mjs` or the web **Save to shelf** button), and reply with the ordered **Watch:** links, mode, `s/frame`, and file sizes.
4. **No voice-over and NO music, ever.** The owner records voice-over in their own editor and does not want music beds. No TTS, no music. Captions + **sound effects (SFX) only** via optional `--audio` stem.
5. **Captions by format.** 9:16: 1-2 words popping on each word, large. 16:9: the full sentence, small, bottom centre, only the spoken word lit.
6. **Long videos come in parts.** Over 30 s the render is cut into equal parts (cuts on pauses) that stitch seamlessly in an editor.
7. **Size.** Supabase's free tier rejects files over 50 MB, so a file over 45 MB is re-encoded when saved (libx264, CRF 23, same resolution, audio untouched).

A field guide distilled from building 3D cartoon Shorts and long-form films with three.js (plain, or in Remotion + R3F). Every rule below came from a render that was rejected. Deeper notes live in `references/`:

- [camera-and-editing.md](references/camera-and-editing.md): the beat rig, transitions, long-form vs Short grammar,
  vertical reframing
- [look-and-ink.md](references/look-and-ink.md): grade, lights, the post-process ink outline, materials, numbers that
  worked
- [flicker-and-determinism.md](references/flicker-and-determinism.md): every flicker cause found, its fix, how to hunt
  the next one
- [render-and-qa.md](references/render-and-qa.md): render recipe (Remotion), motion blur, the GPU lock, QA tools and thresholds
- [remotion-route.md](references/remotion-route.md): the optional Remotion + R3F starter route
- [shorts.md](references/shorts.md): Shorts from scratch and Shorts cut from a long form, captions, sound-off
  readability
- [audio-and-voice.md](references/audio-and-voice.md): voice-over workflow, music, SFX levels, loudness
- [production.md](references/production.md): plan-first workflow, gates, contracts, working with sub-agents and
  budgets, privacy
- [objects/README.md](objects/README.md): PREBUILT characters (sam, ada, kid, elder), acts, faces, props: use first
- [characters.md](references/characters.md): one character family, form shading, 3/4 heads, character ink, acting
- [sets-and-materials.md](references/sets-and-materials.md): painted textures, per-material recipes, set dressing,
  real scale, sky, sea and weather

`pipeline/` (offline renderer: `doctor.py`, `make_video.py`, `render.js`, `lib/`, `scenes/`). `scripts/` (Python 3 + numpy + ffmpeg, paths as arguments): `flicker.py` (one-frame spikes + broken-tab stride test),
`analyze_pacing.py` (beats/min, % still, % fast, hard cuts, mean L*), `gpu_lock.py` (one render on the GPU at a time).

## 0. Pick a route (read START_HERE.md first, run `python3 pipeline/doctor.py`)
**Route A, the default: the offline pipeline in `pipeline/`.** Plain three.js (vendored in `vendor/`, no npm install of
three) + Playwright + Python + ffmpeg. No Remotion, no internet needed, built for CPU-only sandboxes: about
0.1–0.2 s/frame in `draft`/`fast`. Run `--beatcheck` first (~3–5 s) to inspect `beatcheck.jpg`, then render the full video:
`python3 pipeline/make_video.py --scene <name> --transcript words.txt [--aspect 16:9] --mode draft|fast|final --out <folder>`.
Modes (9:16 / 16:9): `draft` 540x960 / 960x540 no blur (iterate here), `fast` 720x1280 / 1280x720 4-sub-frame blur, `final` 1080x1920 / 1920x1080 8-sub-frame blur.
Output is `<out>/video.mp4` (or `part-01.mp4 ...` for a video over 30 s), auto-generated `sheet*.jpg` contact sheets (unless `--no-sheet`), `parts.json`, and `report.json`. It never uploads.
It gives: toon shading with an inverted-hull ink outline, **prebuilt rigged characters (`objects/`, see section 11)**, the word-anchored beat camera
(`lib/rig.js`: moving beats for 9:16, `calm()` cuts and zooms for 16:9), per-format captions, chunked resumable rendering (stale frames are wiped automatically when the scene, transcript, settings or renderer change), ffmpeg encode (always 1080x1920 or 1920x1080) and QA. Objects follow one
contract: `makeX(opts) -> {group, parts, update(t)}`, metres, origin at ground contact, facing +z, pure function of t.
Route A trades screen-space ink (inner creases), bloom, DOF and the grade for speed; add them only for a final.

**Route B: Remotion + R3F starter in `templates/`** (full post chain, finished `Character3D`). Needs `npm install`, and
is slow without a GPU. Steps in [references/remotion-route.md](references/remotion-route.md). Use it only when the
machine has network and a GPU and the full look matters.

Rules in sections 1-4 and 7-9 apply to both routes. For a target look, give 5-10 frames from videos you like, for
private analysis only (measure light, colour, pacing; never copy characters or designs); keep them out of the project.

## 1. Two grammars: pick the right one
**Shorts (vertical), the viral 3D cartoon cadence** (measured on a sample of popular 3D cartoon Shorts):
- **Camera beats & cuts:** About **56 beats/min** (range 45–66), a new framing every ~0.86 s. Use moving beats (`dolly`, `orbit`, `crane`) within a scene, and use **clean hard cuts (`{ cut: true }`)** freely whenever jumping to a completely different camera framing or another set/location.
- **The camera is never still:** ~5% still frames, ~34% fast-motion frames. Between moves the camera keeps drifting at
  about a third of peak speed. Moves last ~19 frames with a symmetric ease-in-out and start ~6 frames before their
  word.
- Pushes in outnumber pulls out about 2:1. Small rolls inside orbits. Shake only on a comic impact.
- The key object is on screen in the first 2 s. The pace is fastest in the first 40% and ~25% calmer for the payoff;
  the explanation gets the longest, calmest holds.
- **Sentence starts land on a beat** (~68%). Moves follow clauses, not every word.

**Long form (16:9), a calm film:** the Shorts cadence on a long film reads as cheap and tiring. In the pipeline: `makeRig(calm(beats), { drift: 0, arc: 0 })` from `lib/rig.js`.
- **Hold each framing ~3–6 s** (inserts such as a clock, phone or calendar ≥ 2 s), cut with classic coverage (master →
  medium → close, reverses, keep the 180° line). No orbits, swings, whips, hand-held drift, decorative moves, or
  inserts that cut away and straight back.
- **A few zooms:** a slow eased push across a whole hold on about 1 framing in 3, 0.06–0.14 of the lens-to-subject
  distance.
- **Captions in 16:9 are small full sentences** (bottom centre, at most 2 lines, about 4.6% of the frame height, the whole sentence on screen with only the spoken word lit, no pop). Turn them off with `--caps 0` if you ship an SRT instead. Held frames are perfectly still (drift 0): see section 5.

## 2. Plan first, never type a time
- Get word timings: in the video-shelf workflow the owner supplies a transcript with a start and end time on every word (from their own voice-over); never make a voice-over. Write a small `plan_src.py` that
  anchors every setup and beat to `(turn, "phrase", occurrence)` and generates `plan.json` + the TS module your
  composition imports (the starter `plan/plan_src.py` does this for shots, captions and tags; add beats and a readable
  `PLAN.md` as you grow it). To move a beat, edit the source and re-run.
- Print the stats every run: beats/min, longest holds and where, hard cuts, sentence starts on a beat, an estimate of
  fast-motion share. **Targets for Shorts: 56 ± 4 beats/min, ≤ 35% fast frames, ≈ 0 hard cuts.** Planning ~10% more
  beats than the target helps: small moves on flat frames don't register on the analyzer.
- Light follows the acts: give every act its own light and palette (dusk, night, a cold interior, or a golden payoff).
- Put sound-off tags in the plan (section 7). Work in gates, but show pictures not prose: plan → look-dev stills (a contact sheet) →
  `draft` pilot → `final`. In the video-shelf workflow do not stop at gates: render the `draft` immediately and show it; `final` only when asked.

## 3. Look: crisp, not milky
Haze, wide bloom, heavy depth of field, grain and lifted blacks read as cheap. Target:
- a clear key light with definite shadows; heads with a lit and a shadow side (never flat white);
- a saturated clean palette per act; bloom only on practical light cores; mild DOF; **no grain**;
- bright day frames, **mean L\* ≈ 50–54**; slightly lifted, tinted blacks are fine for a Short, true black ink on top;
- **premium pass**: stronger key and rim, less ambient, a fresnel rim term in the toon material, soft halation on
  highlights; outdoors, aerial haze and sun rays **in the distance only** (haze on the subject washed the opening
  out). Eye-check the first second after every light change.
- Unlit colors > 1.0 burn to cream in the grade: keep emissive cores ≤ 1.0–1.2 and saturated.
- **Ink outlines**: route A uses the cheap inverted hull (silhouettes only). The premium look (route B, or a final-only upgrade) is ink in post, not hulls on everything: depth + normal + object-id edges; ink ≥ 2.5% of the
  frame, colored per mood, never neutral black. Characters get heavier ink than the set. Settings in look-and-ink.md.
- Warm against cool in every frame, no monochrome washes, no stacked shade tints; shadows colored, never gray; night
  is luminous ultramarine, not murky (numbers in look-and-ink.md).
- Painted textures (texture energy ≥ 0.45, but flat surfaces quiet so they don't read as dirt), ≥ 12 props in every
  framing, real scale, toy-like props (sets-and-materials.md).
- Characters: one written-down character family, lit and shadow side, 3/4 heads, always acting, never a real person's
  likeness (characters.md).

## 4. Physical plausibility (check every framing)
- Hands and arms vs blankets, tables, laptops, books, mugs; doors vs heads; bodies vs beds, walls, chairs; walks go
  through open doorways. If a pose can't avoid it, change the pose, blocking, prop size or framing.
- Props at real scale (a book ≈ 0.6 × head width), held IN the hand with two-bone IK to a world target, never
  floating.
- A floating UI panel is anchored to something (a desk, a wall, a prop); never alone in the air.
- Named actions are shown and readable: if the voice says someone lifts, opens or climbs something, show the whole
  action.
- The camera is never inside geometry (check the whole move, not only the keys), never above a missing ceiling, never
  beyond a set edge (an interior must never show sky). Nothing sits where a character's head overhangs its shoulders.
- Moves between distant framings must stay framed the whole way (no empty sky mid-move): pan from one position or
  route the move past something.

## 5. Flicker: the causes found, and the rule behind each fix
1. **Per-tab state.** Remotion renders with several browser tabs (route A uses one, so it cannot split, but keep the rule); any three.js state initialized once per tab differs
   between tabs. **Every frame must be a pure function of the frame number**: no `Math.random`, `Date`,
   `performance.now`, no one-time-initialized objects whose state changes later, no caches keyed by `Object3D.id`,
   nothing mutated only on some frames. Example: a shadow camera whose projection was computed once → recompute and
   call `updateProjectionMatrix()` every render.
2. **GPU overload** (Remotion route; route A runs one tab and `--jobs 1`). Three renders in parallel × concurrency 8 lost GL state: every 8th frame went dark. **One render
   on the GPU at a time** (a lock, see render-and-qa.md); concurrency ≤ 8 for finals, ≤ 3 for tests.
3. **Camera drift** makes screen-space ink and bloom crawl on fine detail → long-form held frames are perfectly still;
   Shorts move but use motion blur.
4. **Dotted ink**: double-sided wavy planes (curtains) → one flat normal per double-sided mesh in the normal pass;
   object boundaries → object-id edges; sub-pixel sticks → skip ink below a projected thickness; grazing planes → turn
   off the one-sided depth-jump test; animated grain or ink wobble → 0.
5. **Z-fighting**: coplanar overlapping boxes (wall corners from two boxes sharing a face, ground slabs whose tops
   meet) → offset ≥ 1 cm, start the second wall behind the first; decals ≥ 3–4 mm proud; live mirrors off when unused.
   Bars and frames must only touch, never overlap (overlaps inked a flickering black blob).
6. **Shadow crawl**: snap the shadow box to whole shadow texels and quantize its size; patch three's screen-locked PCF
   dither (it crawls under any camera move).
7. **Memory**: a per-object material cache grew every shot → the browser ran out of memory. Bound every cache.
8. **Strobing**: fast periodic motion (anything cycling at ~4 Hz) and very fast lens moves read as flicker even with
   motion blur: cycles ≤ ~2 Hz, big moves ≥ ~0.85 s.
Hunt the next one with `scripts/flicker.py`, then crop the region over 3 frames (flicker-and-determinism.md).

## 6. Render and QA (summary; recipe in render-and-qa.md)
- WebGL in headless Chrome: `--gl=angle`, a long `--timeout` (240 s), one render process, one bundle per project
  (bundles copy `public/`: clean up old ones you created, watch the disk).
- **Motion blur on every Short:** render 4 sub-frames per frame across a 180° shutter at 4× fps, average with ffmpeg
  `tmix`, keep every 4th frame. Captions are keyed to the output frame, so they stay sharp.
- QA on every render: `flicker.py` (spikes from whips or lightning are fine; trace the rest), `analyze_pacing.py`
  (beats/min, % still, % fast, cuts, L\*), a 2 fps contact sheet eye-checked for interpenetration and empty frames,
  loudness, and a **muted** read of the sheet: does the story read without sound?

## 7. Shorts specifics (more in shorts.md)
- **Captions (9:16 only; 16:9 uses small full-sentence captions, section 1):** 1–2 lowercase words, swapped exactly on word onsets (2 frames early), no pop or scale, centered at
  **70% height**, a heavy geometric sans, **~86 px at 1080 wide** (kept compact so it never crowds the frame), a heavy dark outline, every word white (an accent
  color is optional). Spoken punctuation kept.
- **Sound-off readability:** viewers scroll muted. Put the story in the picture with 1–3 word tags painted on the key
  objects (a year, a price, a label), bold, large, high contrast, **unlit** so the light can't wash them out.
- **Vertical framing:** subject in the upper part (faces at 30–45% height) so captions at 70% never cover faces.
- **Zoom levels:** the push inside a hold ~3%/s, on a set change ~12% (7% or 30% read as too busy).
- The picture ends ~0.7 s after the last word.

## 8. Audio (more in audio-and-voice.md)
In the video-shelf workflow **no voice-over AND no music are ever made**: skip everything about TTS, voice loudness, and music beds. When audio is requested (`--audio`), generate **sound effects (SFX) only** — never add music. Keep SFX levels modest so they sit cleanly under the voice-over the owner adds later:
- Story SFX on the exact word/action, 6–10 per 20 s, **each leveled modestly** (peaks around −16 to −10 dBFS, well under a −14 LUFS voice; short fades at both ends, 48 kHz).
- Deterministic synthesized SFX (no music loops or melodic beds) are great for offline renders.

## 9. Production habits that saved the most time
- A contract file + plan JSON per sequence + one owner per area (core, sets, cast, sequences, UI, audio).
- A pilot (~80 s or the first 15 s of a Short) under the new rules, shown before rolling out.
- Shared sets change only additively: a new variant flag that defaults to the old behavior.
- A typecheck gate before every bundle (one syntax error in an auto-loaded module breaks everyone's bundle).
- Sub-agents burn budget fast (many in parallel can use up a usage window in well under an hour): default to none, at
  most 2–3; at most 3 images per step.
- If asked to work autonomously, don't stop for gates. Confirm a defect still exists before fixing it.
- Nothing from the maker's computer or identity in anything published (paths, user names, emails, dates); no real
  brands or logos (production.md).

## 10. Route A details (offline pipeline)
- Preflight: `python3 pipeline/doctor.py` (works from any folder; checks node, ffmpeg+libx264, vendored three, playwright module, numpy, and a real
  WebGL2 render, with the exact fix for anything missing). Missing Playwright: `bun add -d playwright-core` if `bun.lock` exists, else `npm i -D playwright-core` (Chrome/headless
  shell is auto-found in /ms-playwright, /opt/pw-browsers, ~/.cache/ms-playwright, or set `CHROME_PATH`).
- `vendor/` = three@0.186.1: original `.tgz`, unpacked ES build, addons (see `vendor/README.md`). Import through the
  importmap in `pipeline/page.html`; never download three.
- Scenes live in `pipeline/scenes/<name>.js` and export `build(ctx) -> {scene, camera, update(t)}`; optional `words`
  (captions). `ctx = {w, h, fps, landscape, aspect}`: `ctx.landscape` is true for 16:9, so one scene file builds a moving-beat rig for 9:16 and
  `makeRig(calm(beats), {drift:0, arc:0})` for 16:9 (see `scenes/char_demo.js`). Beat fovs are written for 9:16; `applyPose` divides them by 1.4 in a
  landscape frame (`{exact:true}` to opt out). A beat can be `{cut:true}` (hard cut on its word) and carry `zoom: 0.06-0.14`.
  `--transcript` overrides captions from word timestamps (`0.112 - 0.176  If` lines; `[a --> b] w`, `a b w`, `w,a,b`, `hh:mm:ss.mmm - ... w` and JSON lists also work).
- Preview & sheet flags: `--beatcheck` (renders ~16-20 key beat/timeline frames into `beatcheck.jpg` in seconds for fast pre-render QA); `--no-sheet` skips auto-generating `sheet*.jpg` after full renders.
- Caption options: `--caps word|sentence|0`, `--capscale 1`, `--accent '#ffd23f'`. Parts: `--part-seconds 30`. Optional **SFX-only** stem: `--audio` (no voice, no music). `--fresh` forces a re-render.
- Resource limits (2 vCPU, 4 GB): `--jobs 1` (2 only if RAM is free), chunks of 120 frames, re-run to resume. If a shader
  fails to compile the renderer stops with FATAL (three.js otherwise skips the object silently).
- Known limits: ink only on silhouettes; QA scripts need numpy (skipped cleanly with `--no-qa` or note if missing); `analyze_pacing.py` undercounts
  small moves on flat backgrounds, so plan ~10% extra beats.

## 11. Prebuilt characters (`objects/`): use them, do not rebuild them
Whenever a scene needs a person, import a prebuilt character instead of making one from capsules.
1. Look at `objects/previews/cast.png` and `acts.png` to see what exists (cast: sam, ada, kid, elder; also `previews/car.png`, `previews/tree.png`; acts: idle walk run wave point talk react sit plant hold dig; faces: neutral happy shocked sad angry worried).
2. Copy `pipeline/scenes/char_demo.js` to a new scene and edit it. Pattern: `const c = makeCast('sam'); scene.add(c.group);` then in `update(t)` set position/rotation as a pure function of t and call `c.act({walk:1}, t)`.
3. Full API, props (`makeShovel`, `carry`, sockets), IK `reach`, `expression`, `talkFromWords`: `objects/README.md`.
4. Walk/run: move at `c.speed('walk')` m/s or feet slide. Scale props to `c.K/1.65`. Mouth: feed `talkFromWords` the transcript word times.
5. Run `node objects/selftest.js` after any change to `objects/` (must print SELFTEST OK) and `node objects/preview.js` then LOOK at the sheets.
6. Cars and trees are prebuilt too: `objects/car.js` (`makeCar`, `crashPath`) and `objects/tree.js` (`makeTree`); see `objects/README.md` and `pipeline/scenes/tree_road.js`.
7. Missing object (chair, house...)? Build it in the scene by the object contract and the standards in `objects/README.md` rule 4, matching the characters' proportions, palette and ink; promote to `objects/` if reused.
`lib/char.js` is the old first-pass stand-in; do not use it for real scenes.
