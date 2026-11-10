# motion-assets - technical half (tech/*, obj/*, fx/*)

Pure-canvas animation assets for 1280x720 beats, in one consistent "paper" look. Everything is an ES module, vanilla JS, Chromium only, no network at runtime.

## Use an asset
```js
import { fontsReady } from './assets/core/core.js';
import { assets } from './assets/technical/scenes-a.js';
await fontsReady();                                   // loads bundled Lora / Poppins / DejaVu Sans Mono
assets['tech/big-stat'].draw(ctx, t, { value: 87, suffix: '%', at: { count: 0.8 } });   // scene: fills the frame
ctx.save(); ctx.translate(640, 360); assets['obj/bulb'].draw(ctx, t, { on: true }); ctx.restore();   // icon / fx: around current origin
const hits = assets['tech/big-stat'].markers({ value: 87 });   // [{id, t, kind}] for sound design
```
Every asset exports `{ meta, draw(g,t,params), markers(params) }` inside `export const assets`. `meta` (see `assets/index.json`) tells an LLM what it is: `description`, `params` (type/default/desc), `anchors` (named start times, override via `params.at`), `markers`, `bounds`, `origin`, `example`, `duration` (when it has settled), `holds:true` (valid for t 0..15).

## Layout
```
assets/core/        palette.js core.js fonts.css fonts/        frozen foundation (owned by this half)
assets/technical/   kit.js seeds.js scenes-a.js scenes-b.js scenes-p1.js     tech/*  (24 scenes + 5 parts)
assets/objects/     objects-1.js objects-2.js                    obj/*  (44 icons)
assets/fx/          fx.js                                        fx/*   (18 effects)
assets/style-guide.md  assets/index.json  assets/manifest.json
tools/              harness.html shoot.py check.py build_index.py serve.py _common.py
demos/tech/<id>.js  demo(g,t) per scene      refs/{tech,objects,fx}/  contact sheets      refs/_catalog_*.png
qa/regression-tech.json   docs/B-decisions.md   docs/qa-B.md
```
Conventions: ids are `tech/…`, `obj/…`, `fx/…` (never outside); modules import only `../core/core.js`, `../core/palette.js` and files in their own half; scenes take `bg:false` for transparent overlays; icons are centred on (0,0) in [-100,100]; text is always a param with a short default.

## Tools (need `pip install playwright pillow numpy` and `playwright install chromium`)
| command | what it does |
|---|---|
| `python tools/build_index.py` | scans `assets/**/*.js`, writes `assets/manifest.json` + `assets/index.json` |
| `python tools/shoot.py [--only tech/big] [--ns tech,obj,fx] [--no-catalog]` | 2x2 contact sheets (t = 0.4 s, 25 %, 60 %, end) to `refs/<ns>/<id>.png`, catalogs `refs/_catalog_icons.png`, `_catalog_fx.png`; prints console errors |
| `python tools/check.py [--only tech/] [--v2 path/to/v2.html] [--quick]` | lint, meta schema, errors, determinism, coverage 0-15 s, never blank, idle motion, text bounds/min 14 px, ms budgets, demos, pixel regression vs v2.html; writes `qa-report.md` |
| `python tools/stress.py` | renders ~50 non-default param variants (empty/long lists, every chart type and app mode, 1-12 nodes…) at t=0..15 and reports exceptions and text out of bounds |
| `python tools/serve.py [port]` | serves this folder so `tools/harness.html?asset=tech/big-stat&t=2&p={"value":5}` can be opened by hand |
`--v2` is only needed if `v2.html` is not in this folder, its parent, or `qa/`. Regression compares the new assets against `v2.html`'s `draw(name,t)` (fail above 0.5 % of pixels differing by more than 8/255); lists live in `qa/regression-*.json` as `[{"id","v2scene","times"}]`.
Tools never hard-code assets: they scan `assets/**/*.js` and import every module's `assets` map, so they work unchanged after the halves are merged. Refs for other namespaces: `python tools/shoot.py --ns story,char` writes to `refs/<namespace>/`.

## Merge steps (two zips, one folder)
1. `unzip motion-assets-tech.zip` and `unzip motion-assets-story.zip` into the same directory (both have the single top-level `motion-assets/`; no file is shared, nothing is overwritten).
2. `python tools/build_index.py && python tools/check.py` (add `--v2 path/v2.html` if needed). The index will list both halves; the check flags duplicate ids, cross-half imports and anything outside the contract.
Core files (`assets/core/**`) are owned by this half; the other half must not ship its own copy.

## Where to start
`assets/style-guide.md` (look + motion rules), `assets/index.json` (what exists), `refs/` (what it looks like), `demos/tech/` (non-default params), `docs/B-decisions.md` (judgement calls).
