# QA - half B

Generated 2026-11-02 02:23 - 91 assets checked in 49s - **PASS** (0 failing items)

Command: `python tools/check.py --v2 v2.html` (headless Chromium, software canvas) after `python tools/build_index.py` and `python tools/shoot.py`.

## Inventory (assets/index.json)
- 91 assets: scenes 24, parts 5, icons (kind prop) 44, fx 18
- P0 scenes: big-stat, flow-diagram, chart-draw, checklist-reveal, timeline-roadmap, compare-split, app-window, code-window, proof-card, title-card; seeds metro-map, isotype-crowd + parts station/badge/chip/pawn/stopwatch.
- P1 scenes (12): funnel, terminal-log, phone-mock, dashboard, architecture, network-graph, kanban-board, matrix-2x2, progress-loader, calendar-gantt (Gantt variant), section-divider, quote-card.
- 44 icons (`obj/*`, 20 P0 + 24 more), 18 fx (`fx/*`). Catalogs: refs/_catalog_icons.png, refs/_catalog_fx.png. Contact sheets: refs/tech|objects|fx/<id>.png. 24 demos in demos/tech/.

## Results
| check | result |
|---|---|
| lint (forbidden APIs, JSDoc, module globals, cross-half imports, non-API core imports) | clean for all modules; a negative test with a deliberately bad module was caught (Math.random, shadowBlur, module-level T, cross-half import, non-determinism, blank frames) |
| meta schema (required fields, numeric anchors, marker kinds, unique ids, example) | all pass |
| console / page errors | none |
| determinism (same t twice; t=3 then t=0 == fresh t=0) | all pass |
| coverage t = 0..15 every 0.5 s, never blank (t >= 1) | all pass; one-shot fx (confetti, dust-puff) are tested at previewT only |
| idle motion t=8 vs 8.5 | all pass (the 2 one-shot fx are exempt) |
| text >= 14 px and inside safe margin at t=8 and 15 | all pass |
| perf (median ms/frame) | scenes max 7.1 ms (tech/isotype-crowd, 100 pawns; budget 30), icons max 0.4 ms, fx max 0.3 ms, parts max 0.1 ms (budget 8) |
| demos run at t = 0.4, 2.5, 8 | 24 / 24 |

## Pixel regression vs v2.html (threshold: 0.5 % of pixels differing by > 8/255)
| id | t | differing |
|---|---|---|
| tech/metro-map | 0.4 | 0.000% |
| tech/metro-map | 1.2 | 0.000% |
| tech/metro-map | 2.0 | 0.000% |
| tech/metro-map | 2.8 | 0.000% |
| tech/metro-map | 3.8 | 0.000% |
| tech/metro-map | 5.0 | 0.000% |
| tech/isotype-crowd | 0.3 | 0.000% |
| tech/isotype-crowd | 1.0 | 0.000% |
| tech/isotype-crowd | 1.8 | 0.000% |
| tech/isotype-crowd | 2.3 | 0.000% |
| tech/isotype-crowd | 3.5 | 0.000% |

## Known issues / not verified
- Timings are for headless software rendering.
- User strings are shrunk with `fit()` to >= 14 px, but very long strings (> ~40 chars per label) can look crowded; defaults and the 24 demos were reviewed visually, not fuzzed.
- `tech/proof-card` was verified with the placeholder, a canvas and an ImageBitmap; HTMLImageElement uses the same code path but was not tested separately.
- flow-diagram with 5-6 nodes uses a two-row snake layout.
- Contact sheets use default params; non-default params are exercised by demos/tech/*.js.
- Catalog thumbnails scale wide fx (torn-edge, speed-lines) small; see refs/fx/<id>.png for full size.
