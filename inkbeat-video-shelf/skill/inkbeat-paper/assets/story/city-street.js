/**
 * story/city-street.js — 'story/city-street'
 * A busy daytime city street: office tower, apartments, shops, lamp posts, traffic light, a bus and a taxi driving through, a crowd on the pavement,
 * and a delivery rider in front who stops, waves and then gives a thumbs-up.
 *
 *   assets['story/city-street'].draw(g, t, {});
 * params: time ('noon'|'golden'|'night'), at.bus (s, 0.5) bus drives in, at.wave (4.2), at.thumbs (6.6), crowd (count, 26)
 */
import { vignette, grainOver, tiled } from '../core/core.js';
import { drawSky } from '../environment/sky.js';
import { drawBuilding, shopFront, houseVariant } from '../environment/buildings.js';
import { drawFurniture } from '../environment/street.js';
import { drawGround } from '../environment/terrain.js';
import { drawVehicle } from '../environment/vehicles.js';
import { drawPlant } from '../environment/plants.js';
import { crowd } from '../people/crowd.js';
import { drawPerson } from '../people/rig.js';
import { character } from '../people/characters.js';
import { walkFrom, scene, pm } from './_util.js';
import { withDefaults, ANC, P } from '../environment/_meta.js';

const DEF = { time: 'noon', crowd: 26, at: { bus: .5, wave: 4.2, thumbs: 6.6 } };
const rider = p => ({ ...character('rider'), x: walkFrom(760, -1, 150, 3.4), y: 660, dir: -1, walk: { speed: 150, to: 3.4, travel: true }, gestures: [{ name: 'wave', at: p.at.wave, dur: 2.0, hand: 'R' }, { name: 'thumbs_up', at: p.at.thumbs, dur: 2.2, hand: 'R' }], seed: 5 });
export function draw(g, t, params) {
  const p = withDefaults(params, DEF), night = p.time === 'night';
  drawSky(g, t, { time: p.time, cam: t * 20 });
  drawBuilding(g, 'office_tower', 260, 470, t); drawBuilding(g, 'apartment', 560, 470, t); drawBuilding(g, 'office_tower', 1050, 470, t, { wall: '#C9B7A0' });
  tiled(300, 0, () => { }, 0);
  shopFront(g, 0, 150, 520, t); shopFront(g, 3, 440, 520, t); houseVariant(g, 2, 760, 520, t); shopFront(g, 1, 1010, 520, t); shopFront(g, 2, 1240, 520, t);
  g.fillStyle = '#D9C3A3'; g.fillRect(0, 520, 1280, 46); g.fillStyle = '#C2A987'; g.fillRect(0, 560, 1280, 8);
  drawGround(g, t, { kind: 'dirt', y: 566 }); g.fillStyle = '#6E6A66'; g.fillRect(0, 566, 1280, 154); g.fillStyle = '#F3EAD7'; for (let i = 0; i < 10; i++) g.fillRect(i * 140 + 20, 650, 70, 8);
  [160, 700, 1180].forEach((x, i) => drawFurniture(g, 'lamp_post', t, { x, y: 566, night, s: 1.1 }));
  drawFurniture(g, 'traffic_light', t, { x: 880, y: 566, s: 1.2 }); drawFurniture(g, 'bench', t, { x: 520, y: 566, s: 1.1 });
  drawPlant(g, 'round_tree', t, { x: 340, y: 566, s: .8, seed: 3 }); drawPlant(g, 'potted', t, { x: 620, y: 566, s: .9 });
  crowd(g, t, { seed: 6, count: p.crowd, area: [0, 548, 1280, 28], scale: [.5, .62], speed: [50, 90] });
  drawVehicle(g, 'bus', t, { x: -240, y: 640, speed: 300, at: { start: p.at.bus, stop: null }, s: 1 });
  drawVehicle(g, 'taxi', t, { x: 1500, y: 696, dir: -1, speed: 210, at: { start: 1.2, stop: null }, s: .9 });
  drawPerson(g, t, rider(p));
  vignette(g, .2); grainOver(g, .4);
}
export const assets = scene('story/city-street', {
  title: 'City street', description: 'Daytime city street with an office tower, apartments, shopfronts, lamp posts, a traffic light, a crowd on the pavement, a bus and taxi driving through, and a delivery rider who waves and gives a thumbs-up. Use for urban life, commuting, delivery and city-scale topics.', tags: ['city', 'street', 'urban', 'traffic', 'crowd', 'bus', 'rider', 'delivery'],
  params: { time: P('string', 'noon', 'noon|golden|night'), crowd: P('number', 26, 'people on the pavement') }, anchors: { bus: ANC(.5, 'bus drives in'), wave: ANC(4.2, 'rider waves'), thumbs: ANC(6.6, 'rider thumbs-up') }, markerKinds: ['thud', 'whoosh', 'pop'], duration: 9, example: "assets['story/city-street'].draw(g,t,{time:'golden'})"
}, draw, p => { const q = withDefaults(p, DEF); return [{ id: 'bus', t: q.at.bus, kind: 'whoosh' }, { id: 'taxi', t: 1.2, kind: 'whoosh' }, ...pm([rider(q)])] });
