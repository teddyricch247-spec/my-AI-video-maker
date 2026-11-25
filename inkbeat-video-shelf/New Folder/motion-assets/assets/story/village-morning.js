/**
 * story/village-morning.js — 'story/village-morning'
 * Morning in a round-hut village: huts, baobab, acacia, hills, chimney smoke, birds. An elder woman with a basket walks in from the left and
 * waves; a child with balloons walks in from the right, stops, and points at the village. Built only from the people/ and environment/ libraries.
 *
 *   assets['story/village-morning'].draw(g, t, {});
 * params: at.walk (s, 0) walkers start, at.wave (3.6) elder woman waves, at.point (5.2) child points at the huts; speed (px/s, 120).
 */
import { vignette, grainOver, tiled, rng } from '../core/core.js';
import { drawSky } from '../environment/sky.js';
import { drawHills, drawGround } from '../environment/terrain.js';
import { drawBuilding } from '../environment/buildings.js';
import { drawPlant, plantRow } from '../environment/plants.js';
import { drawFurniture } from '../environment/street.js';
import { smoke, sunbeamsAndDust } from '../environment/weather-fx.js';
import { drawPerson } from '../people/rig.js';
import { character } from '../people/characters.js';
import { walkFrom, scene, pm, byY } from './_util.js';
import { withDefaults, ANC, P } from '../environment/_meta.js';

const DEF = { speed: 120, at: { walk: 0, wave: 3.6, point: 5.2 } };
function people(p) {
  const s = p.speed, stopA = 3.1 + p.at.walk, stopB = 3.3 + p.at.walk;
  return [
    { ...character('elder_woman'), x: walkFrom(470, 1, s, stopA), y: 640, dir: 1, walk: { speed: s, to: stopA, travel: true }, props: [{ kind: 'basket', hand: 'R' }], gestures: [{ name: 'wave', at: p.at.wave, dur: 2.6, hand: 'L' }], seed: 1 },
    { ...character('child'), x: walkFrom(760, -1, s * .8, stopB), y: 640, dir: -1, walk: { speed: s * .8, to: stopB, travel: true }, props: [{ kind: 'balloons', hand: 'R' }], gestures: [{ name: 'point_at', at: p.at.point, dur: 2.6, hand: 'L', target: [980, 380] }], turns: [], seed: 2, s: .95 },
  ];
}
export function draw(g, t, params) {
  const p = withDefaults(params, DEF);
  drawSky(g, t, { time: 'morning', cam: t * 20, birds: true });
  drawHills(g, t, { cam: t * 6, pal: 'green', base: 380, amp: 36 });
  plantRow(g, t, { kind: 'acacia', cam: 0, par: 0, y: 470, gap: 330, seed: 4, s: .55, jit: 1 });
  drawGround(g, t, { kind: 'grass', y: 470 });
  drawBuilding(g, 'hut_a', 190, 540, t); drawBuilding(g, 'hut_b', 1000, 530, t, {}); drawBuilding(g, 'hut_c', 1190, 545, t);
  smoke(g, t, { x: 1000, y: 418, s: .8 });
  drawPlant(g, 'baobab', t, { x: 640, y: 520, s: 1.25, seed: 2 }); drawPlant(g, 'bush', t, { x: 330, y: 560, s: 1.2, berries: true }); drawPlant(g, 'flowers', t, { x: 880, y: 600, s: 1.4 }); drawPlant(g, 'flowers', t, { x: 120, y: 640, s: 1.6, seed: 3 });
  drawPlant(g, 'tuft', t, { x: 560, y: 690, s: 1.6 }); drawPlant(g, 'tuft', t, { x: 1150, y: 680, s: 1.4, seed: 2 });
  byY(people(p)).forEach(o => drawPerson(g, t, o));
  sunbeamsAndDust(g, t, 0);
  vignette(g, .22); grainOver(g, .4);
}
const markers = p => { const q = withDefaults(p, DEF); return pm(people(q)) };
export const assets = scene('story/village-morning', {
  title: 'Village morning', description: 'Round-hut village at sunrise: baobab, acacias, chimney smoke, birds. An elder woman with a basket waves and a child with balloons points at the village. Use for rural life, community, openings of a story about a place or people.', tags: ['village', 'morning', 'rural', 'huts', 'community', 'walking', 'wave'],
  params: { speed: P('number', 120, 'walker speed px/s') }, anchors: { walk: ANC(0, 'walkers start'), wave: ANC(3.6, 'elder woman waves'), point: ANC(5.2, 'child points at the village') }, markerKinds: ['thud', 'whoosh'], duration: 9, example: "assets['story/village-morning'].draw(g,t,{at:{wave:4}})"
}, draw, markers);
