/**
 * story/river-crossing.js — 'story/river-crossing'
 * A river between two banks under an overcast-then-clearing sky. A boat crosses from left to right while a doctor on the near bank waves it in;
 * once it reaches the middle ripples spread, the doctor then points across the water and a rider on the far bank answers with a wave.
 *
 *   assets['story/river-crossing'].draw(g, t, {});
 * params: at.boat (0.4), at.wave (1.2), at.point (5.0), at.reply (6.4), time ('noon'|'golden')
 */
import { vignette, grainOver } from '../core/core.js';
import { drawSky } from '../environment/sky.js';
import { drawHills, drawWater, drawGround, drawMountains } from '../environment/terrain.js';
import { drawPlant, plantRow } from '../environment/plants.js';
import { drawVehicle } from '../environment/vehicles.js';
import { ripple } from '../environment/weather-fx.js';
import { drawBuilding } from '../environment/buildings.js';
import { drawPerson } from '../people/rig.js';
import { character } from '../people/characters.js';
import { scene, pm } from './_util.js';
import { withDefaults, ANC, P } from '../environment/_meta.js';

const DEF = { time: 'noon', at: { boat: .4, wave: 1.2, point: 5, reply: 6.4 } };
const people = p => [
  { ...character('doctor'), x: 220, y: 690, dir: 1, s: 1.25, gestures: [{ name: 'wave', at: p.at.wave, dur: 2.4, hand: 'R' }, { name: 'point_at', at: p.at.point, dur: 2.6, hand: 'R', target: [1040, 400] }], seed: 6 },
  { ...character('rider'), x: 1110, y: 440, dir: -1, s: .62, gestures: [{ name: 'wave', at: p.at.reply, dur: 2.6, hand: 'R' }], seed: 7 },
];
export function draw(g, t, params) {
  const p = withDefaults(params, DEF);
  drawSky(g, t, { time: p.time, to: null, cam: t * 15 });
  drawMountains(g, t, { cam: t * 3, base: 360, h: 150, col: '#B9C9D1' });
  drawHills(g, t, { cam: t * 4, pal: 'cool', base: 360, amp: 28 });
  drawGround(g, t, { kind: 'grass', y: 420 });                 // far bank
  plantRow(g, t, { kind: 'palm', cam: 0, par: 0, y: 430, gap: 240, seed: 3, s: .45, jit: 1 });
  drawBuilding(g, 'hut_c', 760, 430, t, {}); drawBuilding(g, 'hut_a', 940, 432, t);
  drawWater(g, t, { y: 450, h: 260, kind: 'river', col: '#7FB8AE' });
  // near bank
  g.fillStyle = '#9DB86C'; g.beginPath(); g.moveTo(0, 640); g.quadraticCurveTo(300, 600, 560, 650); g.quadraticCurveTo(800, 690, 1280, 700); g.lineTo(1280, 720); g.lineTo(0, 720); g.closePath(); g.fill();
  g.fillStyle = '#C4A06A'; g.beginPath(); g.moveTo(0, 668); g.quadraticCurveTo(300, 628, 560, 676); g.quadraticCurveTo(800, 716, 1280, 720); g.lineTo(0, 720); g.closePath(); g.fill();
  drawPlant(g, 'bush', t, { x: 80, y: 690, s: 1.5 }); drawPlant(g, 'tuft', t, { x: 420, y: 700, s: 1.6 }); drawPlant(g, 'flowers', t, { x: 360, y: 706, s: 1.5, seed: 2 });
  const b0 = p.at.boat; drawVehicle(g, 'boat', t, { x: 80, y: 556, speed: 140, at: { start: b0, stop: b0 + 4.5 }, s: .9 });
  ripple(g, t, { x: 520, y: 590, w: 120, at: { start: b0 + 4.6 } });
  p && people(p).forEach(o => drawPerson(g, t, o));
  vignette(g, .18, '70,90,90'); grainOver(g, .4);
}
export const assets = scene('story/river-crossing', {
  title: 'River crossing', description: 'A river with two banks and mountains behind: a boat crosses and stops mid-stream with ripples while a doctor on the near bank waves, then points across to a rider on the far bank who waves back. Use for journeys, distance, connection, healthcare access, delivery over barriers.', tags: ['river', 'water', 'boat', 'crossing', 'journey', 'connection', 'doctor', 'landscape'],
  params: { time: P('string', 'noon', 'sky') }, anchors: { boat: ANC(.4, 'boat departs'), wave: ANC(1.2, 'doctor waves'), point: ANC(5, 'doctor points across'), reply: ANC(6.4, 'far-bank rider waves back') }, markerKinds: ['whoosh', 'thud', 'pop'], duration: 10, example: "assets['story/river-crossing'].draw(g,t,{})"
}, draw, p => { const q = withDefaults(p, DEF); return [{ id: 'boat-start', t: q.at.boat, kind: 'whoosh' }, { id: 'boat-stop', t: q.at.boat + 4.5, kind: 'thud' }, { id: 'plop', t: q.at.boat + 4.6, kind: 'pop' }, ...pm(people(q))] });
