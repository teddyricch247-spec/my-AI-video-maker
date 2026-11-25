/**
 * story/bus-stop-wait.js — 'story/bus-stop-wait'
 * Evening bus stop: shelter, bench and sign under a dusk sky. Three people wait looking at their phones (scrolling and tapping); a bus pulls in,
 * stops with a thud and opens its doors, and they look up, one waves at the driver.
 *
 *   assets['story/bus-stop-wait'].draw(g, t, {});
 * params: at.bus (3.2) bus starts rolling in, at.look (6.0) people stop scrolling and look up, time ('dusk'|'noon'|'night')
 */
import { vignette, grainOver, eio, cl } from '../core/core.js';
import { drawSky } from '../environment/sky.js';
import { drawBuilding, houseVariant } from '../environment/buildings.js';
import { drawGround } from '../environment/terrain.js';
import { drawFurniture } from '../environment/street.js';
import { drawVehicle } from '../environment/vehicles.js';
import { drawPlant } from '../environment/plants.js';
import { drawPerson } from '../people/rig.js';
import { character } from '../people/characters.js';
import { travelDist } from '../people/locomotion.js';
import { scene, pm } from './_util.js';
import { withDefaults, ANC, P } from '../environment/_meta.js';

const DEF = { time: 'dusk', at: { bus: 3.2, look: 6 } };
const STOP = 2.8;                         // travel time of the bus
const people = p => [
  { ...character('office_man'), x: 250, y: 660, dir: 1, s: 1.25, props: [{ kind: 'phone', hand: 'R', at: 0, to: p.at.look }], gestures: [{ name: 'hold_phone', at: .3, dur: p.at.look - .3, hand: 'R' }], seed: 1 },
  { ...character('developer'), x: 360, y: 668, dir: 1, s: 1.25, gestures: [{ name: 'hold_phone', at: .8, dur: p.at.look - .8, hand: 'R' }, { name: 'wave', at: p.at.look + 1.4, dur: 2, hand: 'R' }], seed: 2 },
  { ...character('student'), x: 470, y: 664, dir: 1, s: 1.15, gestures: [{ name: 'hold_phone', at: 1.2, dur: p.at.look - 1.2, hand: 'L' }], seed: 3 },
];
export function draw(g, t, params) {
  const p = withDefaults(params, DEF);
  drawSky(g, t, { time: p.time, cam: t * 10 });
  houseVariant(g, 5, 120, 540, t); houseVariant(g, 7, 840, 540, t); houseVariant(g, 3, 1120, 540, t); drawBuilding(g, 'kiosk', 640, 548, t);
  g.fillStyle = '#D9C3A3'; g.fillRect(0, 540, 1280, 60); g.fillStyle = '#C2A987'; g.fillRect(0, 590, 1280, 8);
  g.fillStyle = '#6E6A66'; g.fillRect(0, 598, 1280, 122); g.fillStyle = '#F3EAD7'; for (let i = 0; i < 10; i++) g.fillRect(i * 140 + 30, 700, 80, 8);
  drawPlant(g, 'round_tree', t, { x: 80, y: 560, s: .8 }); drawPlant(g, 'bush', t, { x: 1220, y: 580, s: 1 });
  drawFurniture(g, 'bus_stop', t, { x: 360, y: 600, s: 1.25, w: 220, text: 'BUS 42' }); drawFurniture(g, 'lamp_post', t, { x: 580, y: 600, night: p.time !== 'noon', s: 1.15 });
  people(p).forEach(o => drawPerson(g, t, o));
  const b = p.at.bus; drawVehicle(g, 'bus', t, { x: -20, y: 716, speed: 360, at: { start: b, stop: b + STOP }, s: 1.05, doors: eio(cl((t - (b + STOP + .5)) / .5)), text: '42 CITY' });
  vignette(g, .26, '70,30,60'); grainOver(g, .4);
}
export const assets = scene('story/bus-stop-wait', {
  title: 'Bus stop wait', description: 'Dusk at a bus stop: three people wait absorbed in their phones (scrolling, tapping) until a bus arrives, stops and opens its doors; they look up and one waves. Use for commuting, waiting, phones and attention, public transport, evening.', tags: ['bus', 'bus stop', 'waiting', 'phones', 'commute', 'dusk', 'city', 'transport'],
  params: { time: P('string', 'dusk', 'dusk|noon|night') }, anchors: { bus: ANC(3.2, 'bus starts rolling in'), look: ANC(6, 'people stop scrolling and look up') }, markerKinds: ['tick', 'whoosh', 'thud', 'slide'], duration: 10, example: "assets['story/bus-stop-wait'].draw(g,t,{at:{bus:2}})"
}, draw, p => { const q = withDefaults(p, DEF); return [{ id: 'bus', t: q.at.bus, kind: 'whoosh' }, { id: 'bus-stop', t: q.at.bus + STOP, kind: 'thud' }, { id: 'doors', t: q.at.bus + STOP + .5, kind: 'slide' }, ...pm(people(q))] });
