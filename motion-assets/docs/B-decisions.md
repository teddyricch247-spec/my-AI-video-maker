# Decisions (half B: technical)
No questions were asked; every judgement call is recorded here.

## Foundation
1. **Fonts.** No download needed: the files were already installed locally and are bundled in `assets/core/fonts/` (Lora variable roman + italic, Poppins Regular/Medium/Bold/Italic, DejaVu Sans Mono + Bold; all free/open licences). `fonts.css` declares them under the exact family names `v2.html` uses, and `fontsReady()` (core.js) calls `document.fonts.load` for every face before the first draw; the harness awaits it. Weights 500 and 600 both map to Poppins Medium; Poppins Light/SemiBold are not bundled.
2. **core.js** is v2.html's code with `g`/`T` explicit. `A(t,delay,dur)` is the contract's *linear* clamp, whereas v2.html's own `A(d,dur)` was eased - seeds therefore use a local `eo(A(...))`. The 512 px grain tile is built once from `rng(7)` (same as v2.html) and cached module-side; this is deterministic and treated as part of core (the only DOM element created outside `getLayer`). `getLayer` clears and resets the layer on every call.
3. **Extra shared code** lives in `assets/technical/kit.js` (not core, so the frozen API is untouched): `defAsset` (builds `{meta,draw,markers}`, merges defaults and `params.at`, wraps each draw in save/restore, clamps t >= 0), scene `frame()`/`finish()`, widgets, `defObj`, `defFx`. The other half may not import it; it can write its own.
4. **`meta` additions** (backwards-compatible): scenes carry `bg` (false = transparent overlay) and `deco` params; fx may carry `oneShot` and `previewT`.

## Conventions I chose where the brief was silent
- Scenes draw the full 1280x720 frame. Parts/icons/fx draw around the **current origin** (caller translates/scales), `bounds`/`origin` are relative to it; icons fit [-100,100]^2.
- Icon/fx anchor `in` (start); extra anchors per asset (e.g. `bulb.on`, `lock.unlock`, `bell.ring`).
- `at` is merged key by key, so `{at:{click:1.5}}` only changes that anchor.
- Typing speed, step delays, counts are *params* (not anchors); start times are anchors.
- Scenes that depend on typing length (app-window form) derive the click time as `max(at.click, type end + .9)` and `markers()` uses the same function, so sound cues stay in sync.
- Kicker position/size is shared by all scenes (80, 78; mono 17 px, 4 px tracking) like metro-map.
- Ground-ink decoration ('a','b','c','none') is kept off the top-left so it never touches kicker/headline; seeds keep their own original ground.
- Seed extras: helpers registered as parts `tech/station|badge|chip|pawn|stopwatch`. The stopwatch wedge becomes a full disc after 3 s (verbatim v2.html behaviour); its hand keeps sweeping as the idle motion.
- Metro-map and isotype-crowd defaults reproduce v2.html **exactly** (0.000 % differing pixels at every tested time, see qa-B.md); extra params (labels, counts) default to the original strings.
- Terminal window uses INK as its fill (a warm near-black, not navy); the only dark panel in the set.
- Arrow glyph in funnel conversion pills uses a Unicode arrow from DejaVu Sans Mono (bundled).

## Known deviation from contract rule 7 (text only via txt())
`txt()` cannot draw outlined, multiply-plated numerals, so these call `fillText`/`strokeText` directly (as the v2.html seeds do): the big numerals in big-stat, checklist-reveal (n/N counter), compare-split, section-divider, isotype-crowd, and the verbatim seed helpers station labels/badge/chip/flag. Everything else, including `pill()`, goes through `txt()`. Sizes still >= 14 px and are covered by the bounds check.
- `params.deco` ('auto' | 'a' | 'b' | 'c' | 'none') picks the ground-ink decoration; 'auto' keeps each scene's own variant. (An earlier build ignored it; fixed.)

## Check definitions (tools/check.py)
- *Blank*: fewer than ~37 pixels differ strongly from the dominant frame colour, tested at every 0.5 s step from t = 1.0 (t < 1 may show only ground art). One-shot fx (`oneShot`) are tested only at `previewT`.
- *Idle*: pixels differing by > 6/255 between t = 8 and 8.5 must be > 0 and < 25 % of the frame.
- *Text bounds*: every `fillText`/`strokeText` is recorded (patched in the harness only), transformed to device space, must be >= 14 px effective size and inside a 20 px margin (scenes) or the canvas (parts); checked at t = 8 and 15 (settled).
- *Perf*: median of 14 frames at t = 1.5 and 6, forced to flush with `getImageData`; budgets scene 30 ms, others 8 ms (the brief's 25 ms crowd-of-60 budget belongs to the other half; `tech/isotype-crowd`, 100 pawns, is held to the 30 ms scene budget).
- *Lint* strips comments and string literals before matching; `createElement` is allowed only in `core/core.js` (`getLayer`, grain). `new Image` and `OffscreenCanvas` are forbidden everywhere.
- *Cross-half imports*: modules in `technical|objects|fx` may import only `core/core.js`, `core/palette.js` or each other.

## Cuts / not done
- P2 nothing planned; all P0 and P1 items in the brief were built (see qa-B.md). Arrow variants built: right, up, curve, loop, double (five); no left/down variants (rotate right/up).
- No audio synthesis (out of scope); markers only.
