# QA report — Agent A (story half)

Run by `_dev/qa.py` (private) in headless Chromium 1280x720 against **122 registered assets** (9 scenes, 35 people assets, 78 environment assets), `56.1 s` of runtime checks. All checks below passed on the final build.

## Summary

| Check | Result |
|---|---|
| Console / page errors during every run | none |
| Modules load (no import errors) | all 25+ modules load |
| Static contract scan (forbidden APIs, imports, JSDoc header, `export const assets`, no module-level g/T) | clean |
| Meta schema + markers audit (all fields, namespaces, marker kinds declared, unique marker ids) | 0 issues |
| Coverage: no exception for t = 0, 0.5 … 15 | 122/122 assets |
| Coverage: never blank at any of those 31 times | 122/122 |
| Determinism: same t twice identical; draw t=3 then t=0 equals t=0 | 122/122 |
| Idle motion after settling (frames differ between t = 12 and 15) | 122/122 |
| Text: every glyph run >= 14 px effective, inside the frame once settled (t >= 10 s) | 122/122 (text drawn only via `txt()`) |
| Declared `bounds` contain what is actually drawn (14 px tolerance) | 122/122 |
| Demos (`demos/story/*.js`): export `demo(g,t)`, never blank/throw t = 0–15 | 9/9 |
| Seed regression vs `v2.html` (market 0.4/1.6/2.8/3.0/4.0 s, dunes 5.0 s) | ALL OK — mean abs difference 0.000, max pixel difference 0 |

## Performance (p95 of 48 frames, forced readback, software-rendered headless Chromium)

Budgets: part <= 8 ms, scene <= 30 ms, crowd of 60 <= 25 ms. Headless software raster is slower than a GPU browser, so real margins are larger.

| Asset | mean ms | p95 ms | max ms | budget |
|---|---|---|---|---|
| story/village-morning | 13.1 | 19.1 | 20.8 | 30 |
| story/city-street | 14.3 | 18.8 | 22.8 | 30 |
| story/river-crossing | 13.4 | 16.7 | 17.5 | 30 |
| story/market-street | 11.3 | 16.6 | 16.8 | 30 |
| story/bus-stop-wait | 10.2 | 15.2 | 18.1 | 30 |
| story/farm-field | 13.4 | 15.0 | 15.2 | 30 |
| story/desert-dunes | 12.0 | 13.2 | 14.8 | 30 |
| story/home-evening | 7.5 | 9.6 | 9.9 | 30 |
| story/office-day | 7.2 | 8.6 | 10.1 | 30 |
| people/crowd (count 60) | 10.5 | 13.2 | 14.0 | 25 |

Slowest parts: env/crops 4.1 ms, env/sky 3.5 ms, env/house-1 3.2 ms, env/dunes 3.1 ms, env/interior-server_room 2.0 ms, env/mountains 1.9 ms (budget 8 ms). Median part p95: 0.80 ms.

## How the checks work

- **Determinism** hashes the full canvas after each draw. The harness reads a pixel after every draw: without that, two back-to-back draws differed by +-1 colour level in a few dozen gradient pixels. Identical draw calls give identical results once flushed, which is consistent with Chromium's batched rasterization rather than impure assets, but I did not prove that inside Chromium.
- **Coverage / blank**: each asset is drawn with default params on a flat grey backdrop; blank means fewer than 60 pixels differ from the backdrop.
- **Idle**: 25 frames between t = 12 and 15 must not all hash the same.
- **Text**: `fillText` is hooked in the harness only; effective size = declared px x transform scale (>= 13.5 px accepted for rounding), bounds are checked for text that is at least partly on screen at t >= 10 s (vehicles that have driven out of frame are not text errors).
- **Bounds**: `meta.bounds` are measured from real pixels (`_dev/fit_bounds.py` writes `environment/_bounds.js`), 4 px padding; the QA fails if drawn pixels leave them by more than 14 px.
- **Markers**: `markers({})` for every asset returns `{id,t,kind}` with a declared kind, unique ids.

## Visual review done by hand

Contact sheets of all 9 scenes (`refs/story/`; a second pass over the final sheets caught a bus still covering a person in bus-stop-wait, since fixed), every gesture at its peak (`refs/people/gesture_sheet.png`, 37 gestures), hand poses, walk/run cycle, all 12 characters side and front, the four catalogs and the environment sheets were each opened and looked at; defects found were fixed and the sheets regenerated from the final code.

## Known issues (not blocking)

- The idle effect on buildings / furniture / terrain assumes a 1280x720-pixel canvas (it uses a core layer of that size).
- `env/crops` is the closest part to its 8 ms budget (about 4–7 ms p95 in software rendering, with occasional spikes); plant spacing was widened to give it headroom.

- Relaxed hands read slightly busy when a character is scaled above about 2.4x (presenter close-ups); use `s` <= 2.2 or a gesture pose for hero shots.
- Bus sign (`text`) fits about 8 characters; truck and street-sign text should stay short. There is no auto-fit.
- `env/vehicle-train` and `env/vehicle-plane` are simple side-view silhouettes (P1); no interior or passengers.
- Idle motion on buildings, furniture and parked vehicles is intentionally subtle (faint drifting shade, an occasional light sheen, engine shake); it is meant to keep a held frame alive, not to be a feature.
- Perf figures come from software rendering; Chromium with a GPU should be faster.
