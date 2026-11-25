# objects/: prebuilt, ready-to-import objects (use these FIRST)

Contract for every object: `makeX(opts) -> { group, parts, update(t), meta }`. Metres, origin = ground contact, faces +z,
pose = PURE function of t (no Math.random/Date), toon materials + ink only. Never rebuild a character in a scene: import one.

Look at the sheets before using: `objects/previews/cast.png`, `turnaround.png`, `faces.png`, `acts.png` (regenerate: `node objects/preview.js`).
Check the code still works: `node objects/selftest.js` (must print SELFTEST OK). Worked example: `pipeline/scenes/char_demo.js`.

## Characters (`objects/character.js`)
Cast (one shared body, only look/height differ): `sam` (adult, jacket), `ada` (adult, sweater, puff hair), `kid` (1.25 m), `elder` (grey hair).
```js
import { makeCast, makeSam } from '../../objects/character.js';   // path from pipeline/scenes/
const sam = makeCast('sam');            // or makeSam(), makeAda(), makeKid(), makeElder()
scene.add(sam.group);                   // feet at y=0, faces +z, ~1.8 m with hair
// in update(t), EVERY frame, as a pure function of t:
sam.group.position.set(x, 0, z); sam.group.rotation.y = yaw;
sam.act({ walk: 1, wave: 0.7 }, t);     // weights 0..1; idle is always the base
```
**Acts** (blendable, name -> weight, or `{w, t0}`): `idle walk run wave point talk react sit plant hold dig`.
- `t0` = start time for one-shots (`wave`, `react`): `{ react: { w: 1, t0: 5.5 } }`. Ramp `w` with a smoothstep over ~0.3 s to blend in/out.
- `walk`/`run`: move the group at `sam.speed('walk', rate)` m/s along its facing direction or the feet slide. Face +x with `rotation.y = Math.PI/2`.
- `point`: `{ point: { w:1, target:[x,y,z] } }` (root space). `sit`: `{ sit: { w:1, seat:0.45 } }` (seat height m; put your own chair there).
- `hold` / `dig` need a prop (below). `dig` loops at 0.62 Hz. `plant` kneels and presses.

**Face**: `sam.expression('happy')` (`neutral happy shocked sad angry worried`) or a pure function `(t) => name`.
Mouth: `sam.talk(sam.talkFromWords([[0.6,1.1],[1.9,2.1]]))` (word start/end seconds from the transcript), or `sam.talk(t => 0..1)`.
Eyes/head: `sam.lookAt([x,y,z])` (world point; `null` to stop). Blinks are automatic and deterministic.

**IK / props**: `sam.reach('R', [x,y,z], 1)` puts the right palm on a WORLD point (keep it within ~0.4 m of the shoulder; `null` clears).
`sam.attach(obj, 'HandR'|'HandL'|'Head'|'Back')` parents a prop to a socket (hat on 'Head'). For two-hand tools:
```js
import { makeShovel } from '../../objects/shovel.js';
const sv = makeShovel(); sv.group.scale.setScalar(sam.K / 1.65);   // scale props to the character
sam.carry(sv.group, sv.grips.A, sv.grips.B);   // rides in the right hand; blends into the grip when hold/dig weight rises
```
**Look**: `makeCharacter({ name, height, build:{headScale,torsoWidth,limb,...}, look:{ skin, hair:{style:'swoop'|'puff',color,accent}, face:{eyeColor,freckles,lash,...}, outfit:{style:'jacket'|'sweater',top,inner,bottom,shoes,sole,trim} } })`.
Copy a `CAST` entry and change colours/height to make a new cast member. Keep the same body family (see `STANDARDS` rules below).

## Car (`objects/car.js`) and tree (`objects/tree.js`)
Previews: `objects/previews/car.png`, `tree.png`. Worked example: `pipeline/scenes/tree_road.js` (a car veers into a tree, twice).
```js
import { makeCar, crashPath } from '../../objects/car.js';  import { makeTree } from '../../objects/tree.js';
const tree = makeTree({ style: 'round' });                       // 'round' | 'autumn' | 'tall'; opts.height rescales (default 3.9 m)
tree.group.position.set(-4.7, 0, -8.4); scene.add(tree.group);
tree.grow(t => 0.2 + 0.8 * backOut((t - 1) / 0.7))              // sapling -> full tree (number or t => scale)
    .hits([3.96, 10.78], [0, 1]);                                // impact times + push direction: sways and sheds 12 leaves per hit
const car = makeCar({ color: 'red' });                           // red yellow blue green white orange purple, or 0xRRGGBB
const cp = crashPath({ target: [-4.7, -8.4], hit: 3.96, lane: 1.7, speed: 18, veer: 1.15, heading: -0.4 });   // drive, veer in, bounce, reverse away
car.path(cp.path).crash(3.96); scene.add(car.group);             // or car.path(t => ({ x, z, yaw, dist })) for your own driving (dist = metres rolled, spins the wheels)
// in update(t), every frame: tree.update(t); car.update(t);
```
Car faces +z (drives toward +z), 4.2 m long; `crashPath` gives `.contact` (point on the trunk) and `.dir` for dust/stars. Crash = hood pops, nose bobs, smoke rises. Camera shake, dust and the comic star are scene code (see tree_road.js).

## Rules & practical clearances (do not break)
1. Characters are ink-heavier than set pieces (hull multipliers inside `character.js`); do not add your own outlines.
2. Everything is a pure function of t: never `Math.random`, `Date`, `performance.now`; no state that depends on call order (except `lookAt/reach/expression/talk`, which you set once).
3. Camera: a 9:16 frame at 3.3 m is ~2 m wide; keep a pair within +-0.6 m, push in for close-ups; big moves >= 0.85 s. In 16:9 (`ctx.landscape`) the same distance shows ~5 m of width, so pairs fit side by side; use calm cuts (`calm()` in `lib/rig.js`), see `scenes/char_demo.js`.
4. Wrong or missing object? Build it in the scene by the same contract: chunky rounded shapes, `toon()` colours from the palettes in `character.js`, ink via `inkMesh`, 5-15 primitives, real scale, own preview. Reused in 2+ scenes: move it to `objects/` and add it to `manifest.json`.
5. Geometry & attachment tips (verified on existing objects):
   - **`makeTree` clearance**: `meta.canopyBottom` is `~1.7 m` (at default `height: 3.9`). Keep trunk-mounted signs or boards centered below `~1.5 m` world height or offset outward so wide corners never poke into foliage.
   - **`makeCar` cabin**: the prebuilt car cabin is solid opaque geometry. If a story needs visible driver faces, eye-lines, or hands gripping a wheel, build a lightweight scene-local open-cab variant matching `toon()` / `inkMesh`.
   - **`Head` socket**: `swoop` hair extends slightly up and forward—shift custom caps/hats slightly forward (`+z`) and verify with `--beatcheck` so the quiff doesn't clip through the brim.
6. Known limits: no fingers (mitten hands), hair styles swoop/puff only, ink = silhouettes only, `reach` accurate to ~4 cm.
