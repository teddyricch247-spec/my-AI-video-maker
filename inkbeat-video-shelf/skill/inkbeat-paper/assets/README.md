# Mode 2 Asset Catalog (`assets/`) — 122 Modular 2D Paper-Cutout Parts

All assets draw into Canvas 2D context `g` on the **1280 x 720 virtual stage** as pure functions of time `t` (seconds).
Coordinate origin `(0, 0)` is top-left; positive `y` points down.

> **Previews:** Browse visual contact sheets in `refs/people/`, `refs/environment/`, and `refs/story/`.

---

## 1. Core utilities (`assets/core/`)

- `palette.js`: `W=1280`, `H=720`, `INK='#221E1A'`, `PAPER='#EFE7D6'`, `CREAM='#FBF3E2'`, `TOMATO='#E8452C'`, `MUSTARD='#F2B531'`, `GREEN='#3F8A5C'`, `PINK='#F2A3B5'`, `SHADOW`, `AQUA`, `LEAF`, `SANS`, `SERIF`, `MONO`.
- `core.js`:
  - `cl(x, a=0, b=1)`, `lerp(a, b, k)`, `eo(x)` (ease-out cubic), `eio(x)` (ease-in-out cubic)
  - `shade(color, k)` (`k < 0` darkens, `k > 0` lightens)
  - `rrect(g, x, y, w, h, r)` (builds path; follow with `g.fill()` / `g.stroke()` / `g.clip()`)
  - `rng(seed)` (deterministic PRNG — never use `Math.random()`)
  - `tiled(period, off, fn, pad=0)` (infinite parallax tiling)
  - `txt(g, str, x, y, { s, f, al, c, base, w })` (min 14 px)
  - `vignette(g, alpha=0.25, rgb='34,30,26')` and `grainOver(g, alpha=0.4)`

---

## 2. People (`assets/people/`)

### Presets (`characters.js`)
```js
import { character } from '../../assets/people/characters.js';
import { drawPerson, personMarkers } from '../../assets/people/rig.js';
```
12 presets (`CHARACTER_KINDS`):
`ama`, `kofi`, `child`, `elder_woman`, `elder_man`, `office_woman`, `office_man`, `developer`, `shopkeeper`, `doctor`, `student`, `rider`.

8 skin tones (`SKIN_TONES`) + optional overrides (`shirt`, `pants`, `hair`, `hat`, `glasses`, `bag`, `backpack`).

### Rig & Animation (`rig.js`)
```js
const spec = {
  ...character('office_woman'),
  x: 640,
  y: 590,        // ground contact y (for half:true behind desk, set y ~ 785..800)
  s: 1.2,        // scale (for presenter close-ups stay <= 2.2)
  dir: 1,        // +1 faces right, -1 faces left (side view)
  view: 'front', // 'side' | 'front'
  half: false,   // true crops cleanly at hips behind desks
  talk: [[0.2, 4.5]], // or { from: 0.2, to: 4.5 }
  walk: { speed: 120, from: 0.5, to: 3.5, travel: true, run: false },
  gestures: [
    { name: 'wave', at: 0.5, dur: 1.5, hand: 'R' },
    { name: 'point_at', at: 2.2, dur: 1.6, hand: 'L', target: [900, 320] },
  ],
  seed: 3,
};
drawPerson(g, t, spec);
```

### 37 Gestures (`gestures.js`)
- **Single-hand / directional:** `wave`, `wave_goodbye`, `point_up`, `point_at` (`target:[x,y]`), `thumbs_up`, `ok`, `stop`, `hold_phone`, `hold_mug`, `hold_flag`, `hold_umbrella`, `hold_sign`, `present`, `beckon`, `fist_pump`, `facepalm`, `scratch_head`, `salute`, `count_fingers` (`n:1..5`), `draw_in_air` (`path:[[x,y],...]`), `hand_over` (`target:[x,y], give:'paper'|'mug'|...`), `high_five` (`target:[x,y]`).
- **Two-hand:** `shrug`, `clap`, `think_chin`, `type_on_laptop`, `write_with_pen`, `hold_paper`, `carry_box`, `cross_arms`, `hands_on_hips`, `rub_hands`, `spread_hands`, `measure` (`gap`), `pinch_zoom` (`gap`), `push`, `pull`, `lift`.
- **Head-only:** `nod`, `shake_head`, `look_at` (`target:[x,y]`), `tilt_head`.

### 8 Face Expressions (`faces.js`)
`neutral`, `smile`, `big_smile`, `surprise`, `worried`, `focused`, `tired`, `proud`.

### 17 Held Props (`props-held.js`)
`phone`, `laptop`, `tablet`, `paper`, `clipboard`, `box`, `bag`, `basket`, `balloons`, `umbrella`, `mug`, `pen`, `magnifier`, `megaphone`, `key`, `flag`, `signboard`.

### Walk Sync (`story/_util.js` + `people/locomotion.js`)
To make a character arrive at `toX` cleanly at time `stop` without sliding feet:
```js
import { walkFrom } from '../../assets/story/_util.js';
const x0 = walkFrom(toX, dir, speed, stop, startOrNull);
```

### Crowd (`people/crowd.js`)
`crowd(g, t, { seed: 4, count: 24, area: [0, 540, 1280, 32], scale: [0.45, 0.62], speed: [45, 85] })`

---

## 3. Environments (`assets/environment/`)

### Sky (`sky.js`)
`drawSky(g, t, { time, to, cam, clouds, birds, horizon, at: { shift, dur } })`
Times: `'dawn' | 'morning' | 'noon' | 'golden' | 'dusk' | 'night' | 'overcast'`.

### Terrain (`terrain.js`)
- `drawHills(g, t, { cam, pal: 'warm'|'green'|'dry'|'cool'|'night', base, amp })`
- `drawMountains(g, t, { cam, base, col, snow, h })`
- `drawDunesAsset(g, t, { cam, arches, tufts })`
- `drawCropRows(g, t, { cam, y0, rows, kind, soil })`
- `drawWater(g, t, { y, h, kind: 'river'|'sea', cam, col })`
- `drawGround(g, t, { kind: 'street'|'grass'|'sand'|'dirt'|'tile', y, cam })`

### Buildings, Shops & Street Props (`buildings.js`, `street.js`)
- `houseVariant(g, variant0to7, x, groundY, t, opts)`
- `shopFront(g, variant0to3, x, groundY, t, { text })` (variants: bakery, cafe, books, market)
- `drawBuilding(g, kind, x, groundY, t, opts)`: `apartment`, `office_tower`, `school`, `clinic`, `warehouse`, `kiosk`, `hut_a`, `hut_b`, `hut_c`, `water_tower`.
- `drawFurniture(g, kind, t, { x, y, s, text, night })`: `lamp_post`, `bench`, `bus_stop`, `traffic_light`, `sign`, `billboard`, `fountain`, `stall`, `crates`, `fence`, `flagpole`, `hydrant`, `trash_bin`, `mailbox`, `cone`.

### Interiors & Office Furniture (`interiors.js`)
- `drawInterior(g, t, { kind: 'office'|'living_room'|'shop'|'classroom'|'server_room', floor: 560, time: 'day'|'golden'|'night' })`
- `drawDesk(g, t, { x, y, w, monitor, laptop, mug, papers })` (`y` = desk top edge!)
- `drawWhiteboard(g, t, { x, y, w, h, lines, speed, chart, at: { write } })` (writes line-by-line cleanly!)
- `drawChair`, `drawMonitor`, `drawWindow`, `drawShelves`, `drawWallClock`, `drawPosterFrame`, `drawServerRack`.

### Vehicles (`vehicles.js`)
`drawVehicle(g, kind, t, { x, y, s, dir, speed, at: { start, stop }, col, text, doors })`
Kinds: `bus`, `car`, `taxi`, `motorbike`, `bicycle`, `handcart`, `truck`, `boat`, `train`, `plane`.
Wheels rotate strictly with ground distance (`distance / radius`).

### Plants & Weather FX (`plants.js`, `weather-fx.js`)
- `drawPlant(g, kind, t, { x, y, s, wind, seed, col })`: `round_tree`, `acacia`, `palm`, `baobab`, `pine`, `bush`, `flowers`, `tuft`, `crop`, `potted`.
- `drawWeather(g, kind, t, opts)`: `rain`, `snow`, `mist`, `sparkles`, `dust`, `ripple`.

---

## 4. Complete Reference Story Scenes (`assets/story/`)
- `city-street` (noon/golden/night, crowd, bus, taxi, waving rider)
- `office-day` (windows, whiteboard write-on, seated presenter + typing developer)
- `village-morning` (huts, palm/baobab trees, children & villagers)
- `market-street` (scrolling pastel stalls, bunting, walkers with basket & balloons)
- `desert-dunes` (5 parallax dunes, long cast shadows, footprints)
- `bus-stop-wait` (waiting commuters, bus drives in & opens doors)
- `home-evening` (warm living room, window dusk, talking family)
- `river-crossing` (flowing river ripples, boat bobbing, walkers)
- `farm-field` (perspective maize crop rows, hills, farmers)
