# Flicker and determinism

## Why every frame must be a pure function of the frame number
Remotion renders a video by opening several headless browser tabs and handing each one a different set of frames. Each
tab has its own WebGL context and its own copy of every JavaScript object. Anything that depends on *history* (what
this tab rendered before) makes a frame depend on which tab drew it, and the result flickers with the tab stride.

Rules:
- No `Math.random`, `Date`, `performance.now`, `useFrame` deltas or accumulated physics. Derive everything from `t =
  frame / fps`: positions, cycles, flames (`sin(t·k + seed)`), particles (`(t·rate + hash(i)) % 1`).
- Seeded hashes instead of random numbers: `h(n) = fract(sin(n·127.1 + 311.7)·43758.5453)`.
- No one-time initialization of three state that is later read as if fresh (a shadow camera projected only in the
  first frame of each tab caused a region to be brighter in one tab only).
- No caches keyed by `Object3D.id` (a global counter that differs per tab). Key caches by content, and **bound** them:
  sets remount every shot, and an unbounded per-object material cache ran the browser out of memory.
- Instanced meshes: create the mesh once, but set every instance matrix on every render from `t`.
- Python helpers (audio, plans) need deterministic seeds too: don't use Python's `hash()` of strings (randomized per
  process); use a sum of character codes or a fixed hash.

## The causes found (and their fixes)

| symptom | cause | fix |
|---|---|---|
| every 8th frame darker | GPU overload (3 renders × concurrency 8) lost GL state in one tab | one render process; stride test after each render |
| a region brighter in one tab only | a shadow box projected once per tab | set it and `updateProjectionMatrix()` every render |
| background lines shimmer on held shots | camera drift + screen-space ink/bloom + animated grain/wobble | drift 0 on long-form holds, grain 0, wobble 0 |
| "black dots" on cloth | cloth folds inked as dotted lines | flat normal for double-sided meshes in the normal pass |
| dashed lines on far thin props | sub-pixel geometry | skip ink under ~2.5 px; object-id edges |
| dotted strips at a doorway | walls ending exactly on another wall's plane | stop the walls 6 mm short |
| a full-height strip flickering in a corner | two wall boxes sharing a face | start the second wall behind the first |
| distant ground flicker | slab tops coplanar with the ground | lift slabs 1 cm |
| mirror stipple | a live reflection camera's depth precision | live reflections off unless needed |
| crawling blinds | 5 mm slats every 5 cm, each inked | no ink on slats |
| background twinkle | dust motes wrapping from bottom to top | remove them |
| a blown-out face in close-ups | a nearby colored point light | dim it; bloom only on the emitter |
| a black blob on a grid | overlapping bars inked as a mass | bars only touch, never overlap |
| tiny far shapes twinkling | sub-pixel instanced sprites animating fast | fewer, larger, slower |
| strobing / ghosted frames | ~4 Hz cycles and very fast lens moves at 30 fps (4-sample blur separates) | cycles ≤ ~2 Hz, big moves ≥ ~0.85 s |

## How to hunt the next one
1. Run `scripts/flicker.py video.mp4`. It measures each frame on a 4×3 luma grid and reports frames that differ from
   **both** neighbors while the neighbors agree (a one-frame spike). Real cuts change once and stay; a broken tab
   repeats with a fixed stride, so it also tests every stride 2–16. Exit code 3 = a stride pattern (a broken tab).
2. Spikes at whips, push-throughs, lightning or a flash are legit. For the rest, rank true "odd-one-out" frames and
   look at prev/this/next for the top few (a 3-frame strip at small scale is enough).
3. For steady shots (long form), measure the "zig" energy per second: pixels whose brightness reverses direction frame
   to frame. Hot regions in the background are bugs; hot spots on a walk cycle, steam or a UI pop are fine. (On a
   Short that never holds still this measure finds nothing; use the blip ranking instead.)
4. Locate the object: render a still with a debug pick at the pixel (log every object under it: distance, geometry
   type and size, material). Two hits at the same distance = z-fighting; a segmented plane = cloth.
5. To see whether an artifact is ink, render once with the outline off, then raise one edge threshold at a time.
