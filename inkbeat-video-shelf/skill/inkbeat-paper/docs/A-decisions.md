# Agent A — decisions

Decisions made without asking the user, in the order they came up. Each says what was chosen and why, so a later agent can overrule it knowingly.

## Scope and layout
1. **Namespaces.** Everything I own is `people/*`, `env/*`, `story/*`. Folders: `assets/people`, `assets/environment`, `assets/story`, `demos/story`, `refs/{people,environment,story}`, `qa/regression-story.json`, `docs/`.
2. **Private files.** `assets/core/` (a dev copy of the frozen core API), `_dev/` (harness, QA, generators) and the seed files are not in the zip. Nothing delivered imports anything outside `core`, `environment`, `people`, `story`.
3. **Internal helper modules** (`environment/_meta.js`, `environment/_bounds.js`, `story/_util.js`) are not asset modules: they have a JSDoc header but no `assets` export. `people/gestures.js` and `people/locomotion.js` are library modules and export an explicit empty `assets = {}`.
4. **Cycle avoidance.** `people/gesture` and `people/walk` are registered in `people/rig.js`, not in `gestures.js` / `locomotion.js`, because those two are imported by the rig and importing it back would create a new import cycle that can throw (TDZ) depending on which module a host loads first. The one remaining cycle (`characters.js` <-> `rig.js`) only uses the other module's functions at call time, so it is safe in any load order.

## Seeds
5. **Pixel-exact seeds.** `story/market-street` and `story/desert-dunes` are ports of `v2.html` and are regression-tested against it (mean abs diff 0.000). To make that possible the original `person()` is kept verbatim as `legacyPerson` with the `AMA` / `KOFI` legacy presets, used only by the two seed scenes. New work uses the new rig.
6. Seed helper functions (house row, bunting, dunes, sunbeams…) stay exported by their modules for exact reuse.

## People
7. **Rig.** Own skeleton solver with two-bone IK and pole vectors; scale constant K = .955 so presets match the seed figure height. Hips lower with a damped compass-gait bob, so legs never over-extend.
8. **No foot sliding.** Leg phase = ground distance / stride, so planted feet are exactly stationary on the ground. Walks ease in/out with a .4 s smoothstep ramp; max measured slide 0.12 px per frame.
9. **Views.** `side` (facing +x, flipped by `dir`) and `front`. Right = near arm in side view / screen right in front view. `half:true` crops at the hips for presenter shots.
10. **Seated people** are not a separate rig: a half-body front-view person drawn behind `env/furniture-desk` reads as seated. Cheaper, always consistent, and good for 2–10 s beats. There is no dedicated sit gesture.
11. **Gestures** are timeline entries `{name, at, dur, hand, target, n, gap, path}` layered over locomotion. 37 built (P0 set, P1: pinch_zoom, high_five, push, pull, lift, and four head-only: nod, shake_head, look_at, tilt_head). Every start time is a named anchor in `params.at` or the entry's `at`; `gestureMarkers` emits pop / tick / whoosh / thud / slide / rustle hits.
12. **Hands**: five curl values + spread + thumb-out, blendable poses (relaxed, open, flat_up, flat_out, point, fist, thumbs_up, ok, peace, grip, pinch, count_1–5). `ok` and `pinch` fingertips were solved numerically so they actually meet.
13. **Faces**: dot eyes, blush, simple mouth, 8 expressions (neutral, smile, big_smile, surprise, worried, focused, tired, proud) with crossfades, deterministic blinking and a talking mouth. "focused" brows were softened because they read as angry.
14. **Characters**: 12 presets (the two seed ones plus child, elder_woman, elder_man, office_woman, office_man, developer, shopkeeper, doctor, student, rider) and 8 skin tones (brief asked for 6). Rider has a helmet and backpack; accessories (hair, hats, glasses, lanyards, aprons) are drawn procedurally.
15. **Held props**: 17 (phone, laptop, tablet, paper, clipboard, box, bag, basket, balloons, umbrella, mug, pen, magnifier, megaphone, key, flag, signboard); each declares how the hand grips it.
16. **Crowd**: seeded population with LOD 0/1/2 (full / simple / silhouette); 60 people draw in about 11–16 ms in software rendering (budget 25).
17. **Convenience assets** added for LLM composers: `people/gesture` (one preset, one gesture), `people/walk` (entrance/exit with start/stop anchors), `people/person` (full spec).

## Environment
18. **Bounds convention** (applies to every asset in my half): `meta.bounds` is an absolute canvas rect measured from real pixels with default params (+4 px); `meta.origin` is the default anchor point (x,y). Originally my authored bounds were relative to the anchor; a measuring script (`_dev/fit_bounds.py`) now generates `environment/_bounds.js` and `defMeta()` applies it. The QA fails if anything is drawn outside the declared bounds.
19. **Anchors.** Parts take `x,y,s` with y = ground line (for the desk, y = its top edge; stated in its description).
20. **Vehicles** move by distance and the wheels turn exactly with it (angle = distance / radius). Added `train` and `plane` (P1). The plane has no shadow and y is its belly line.
21. **Weather fx** are particle fields computed from `t` and a seed only, so they loop and any t is valid. Ripple draws a minimum-radius ring so it is never blank at its start.
22. **Idle motion for inanimate assets** (the brief wants every asset to keep idle motion): implemented once in `environment/_meta.js` (`idled`) by asset id — thin posts sway a fraction of a degree, parked motor vehicles shake with the engine, held props float and tilt, terrain gets slow cloud shadows, solid objects (buildings, furniture, bench…) get a faint drifting shade and an occasional light sheen masked to their silhouette using a core layer. Deliberately subtle. Seed scenes call the draw functions directly, so this never touches the pixel-exact regression.
23. **Interiors** (P1) built: office, living_room, shop, classroom, server_room, plus separate furniture parts (desk, chair, monitor, window, shelves, whiteboard with write-on lines at `at.write`, wall clock, poster).

## Story scenes
24. Seven new compositions: `village-morning`, `city-street`, `office-day`, `home-evening`, `farm-field`, `river-crossing`, `bus-stop-wait`, each 9–10 s with at least a 6 s gesture sequence, named anchors in `params.at`, and markers. Each has a demo module and a 2x2 contact sheet.
25. **Layout fixes made after review**: office-day moved the whiteboard and developer apart so they no longer overlap; bus-stop-wait moved the people left, the bus lower in its lane and its stopping point to the right of the shelter, so a parked bus no longer covers anyone (it still passes in front of them while driving in). My first fix of this scene was incomplete — the bus still hid the third person's legs — and was only caught on a second visual review of the final sheets.

## Limitations I know about
- The idle layer for buildings / furniture / terrain composites through a core layer of 1280x720 device pixels, so it assumes the canvas is 1280x720 pixels (the contract). A host that draws onto a larger or device-pixel-ratio-scaled canvas would see those wrapped assets cropped; the unwrapped drawing code is unaffected.

## Text and rules
26. **All text goes through `txt()`** and is at least 14 px effective. Ten places that drew text directly (shop signs, bus / taxi / truck signs, billboard, classroom board, held sign, whiteboard lines) were converted; bus and taxi signs were enlarged so a 14 px label fits, and vehicle text scales up when a vehicle is drawn below scale 1.
27. **Fonts.** Lora, Poppins and DejaVu Sans Mono are present in the sandbox; the code uses the contract's font stacks with generic fallbacks.
28. **Core copy.** `assets/core/` in the working tree is only my dev copy of the frozen API for running things; it is intentionally excluded from the zip.

## QA decisions
29. **Determinism test caveat.** Chromium batches unflushed recorded canvas draws and can differ by +-1 colour level in a few gradient pixels from a flushed draw. The harness therefore flushes after every draw; the assets themselves are pure.
30. Perf is measured in software-rendered headless Chromium (pessimistic).
31. Text-bounds are enforced only once things have settled (t >= 10 s), since vehicles legitimately drive in and out of frame.

## Cut / not done
- No dedicated seated rig or sit gesture (see 10).
- Interiors beyond five rooms, passengers in vehicles, and animals were not attempted.
- `env/vehicle-train` and `env/vehicle-plane` are simple silhouettes.
