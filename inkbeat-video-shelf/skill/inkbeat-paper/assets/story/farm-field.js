/**
 * story/farm-field.js — 'story/farm-field'
 * Golden-hour maize field with receding crop rows, hills, an acacia and a handcart of fruit. A farmer (elder man with glasses) walks down the
 * row, stops, points at the crops, then counts three fingers; a student at the fence thumbs-up.
 *
 *   assets['story/farm-field'].draw(g, t, {});
 * params: at.point (3.4), at.count (6.0), at.thumbs (8.0), time ('golden'|'noon'|'morning')
 */
import { vignette, grainOver } from '../core/core.js';
import { drawSky } from '../environment/sky.js';
import { drawHills } from '../environment/terrain.js';
import { drawCropRows } from '../environment/terrain.js';
import { drawPlant } from '../environment/plants.js';
import { drawFurniture } from '../environment/street.js';
import { drawVehicle } from '../environment/vehicles.js';
import { dustTrail } from '../environment/weather-fx.js';
import { drawPerson } from '../people/rig.js';
import { character } from '../people/characters.js';
import { walkFrom, scene, pm, byY } from './_util.js';
import { withDefaults, ANC, P } from '../environment/_meta.js';

const DEF = { time: 'golden', at: { point: 3.4, count: 6, thumbs: 8 } };
const people = p => [
  { ...character('elder_man', { acc: { glasses: true, hat: '#D9B88A' } }), x: walkFrom(520, 1, 110, 2.8), y: 610, dir: 1, walk: { speed: 110, to: 2.8, travel: true }, gestures: [{ name: 'point_at', at: p.at.point, dur: 2.4, hand: 'R', target: [900, 470] }, { name: 'count_fingers', at: p.at.count, dur: 3.2, hand: 'R', n: 3 }], seed: 4, s: 1.15 },
  { ...character('student'), x: 960, y: 690, dir: -1, s: 1.15, gestures: [{ name: 'thumbs_up', at: p.at.thumbs, dur: 2.4, hand: 'R' }], seed: 9 },
];
export function draw(g, t, params) {
  const p = withDefaults(params, DEF);
  drawSky(g, t, { time: p.time, cam: t * 12, birds: true });
  drawHills(g, t, { cam: t * 4, pal: p.time === 'golden' ? 'dry' : 'green', base: 400, amp: 34 });
  drawPlant(g, 'acacia', t, { x: 180, y: 470, s: .9 }); drawPlant(g, 'acacia', t, { x: 1120, y: 462, s: .6, seed: 3 });
  drawCropRows(g, t, { cam: 0, y0: 470, rows: 6, soil: '#B98B62' });
  drawFurniture(g, 'fence', t, { x: 640, y: 480, w: 1400, col: '#D9B88A', s: .7 });
  drawVehicle(g, 'handcart', t, { x: 1010, y: 640, dir: -1, speed: 0, s: 1 });
  drawFurniture(g, 'crates', t, { x: 150, y: 660, s: 1.1 });
  byY(people(p)).forEach(o => drawPerson(g, t, o));
  drawPlant(g, 'tuft', t, { x: 60, y: 715, s: 2 }); drawPlant(g, 'tuft', t, { x: 1230, y: 712, s: 2, seed: 4 });
  dustTrail(g, t, { x: 560, y: 640, dir: 1, s: .6 });
  vignette(g, .24, '120,60,30'); grainOver(g, .4);
}
export const assets = scene('story/farm-field', {
  title: 'Farm field', description: 'Maize field in golden light with receding crop rows, fence, handcart and acacia. A farmer walks in, points at the crops and counts three fingers; a student thumbs-up. Use for farming, food, growth, seasons, rural economics.', tags: ['farm', 'field', 'crops', 'agriculture', 'rural', 'golden', 'counting', 'pointing'],
  params: { time: P('string', 'golden', 'golden|noon|morning') }, anchors: { point: ANC(3.4, 'farmer points at the crops'), count: ANC(6, 'farmer counts three fingers'), thumbs: ANC(8, 'student thumbs-up') }, markerKinds: ['thud', 'whoosh', 'tick', 'pop'], duration: 10, example: "assets['story/farm-field'].draw(g,t,{time:'morning'})"
}, draw, p => { const q = withDefaults(p, DEF); return pm(people(q)) });
