/**
 * story/market-street.js — 'story/market-street' (port of the v2.html "market" seed).
 * A camera tracks two walkers (Ama with a basket, Kofi with balloons) down a bunting-draped market street, parallax layers.
 *
 *   import { assets } from './story/market-street.js';
 *   assets['story/market-street'].draw(g, t, { speed: 200 });          // identical to v2 at defaults
 *   assets['story/market-street'].markers({});                         // footsteps -> 'thud'
 *
 * params: speed (camera px/s, 200), rig ('legacy'|'new'), walkers (array of person specs, null = Ama+Kofi),
 *         at.start (s, null = full speed from t=0), at.stop (s, null = never stops; eases to rest over .4 s).
 */
import { lerp, vignette, grainOver, tiled } from '../core/core.js';
import { H } from '../core/palette.js';
import { skyGrad, sunRings, cloudsTiled } from '../environment/sky.js';
import { hillLayer, hillVillage } from '../environment/terrain.js';
import { houseRow } from '../environment/buildings.js';
import { stall, cobbleStreet, bunting } from '../environment/street.js';
import { sunbeamsAndDust } from '../environment/weather-fx.js';
import { legacyPerson, AMA, KOFI } from '../people/rig.js';
import { travelDist, timeAtDist } from '../people/locomotion.js';
import { defMeta, P, ANC, withDefaults } from '../environment/_meta.js';

const DEF = { speed: 200, rig: 'legacy', walkers: null, at: { start: null, stop: null } };

export function drawMarket(g, t, params) {
  const p = withDefaults(params, DEF);
  const D = travelDist(t, { speed: p.speed, from: p.at.start, to: p.at.stop });
  const cam = D, ph = p.speed ? D / p.speed * 7.5 : 0;
  skyGrad(g, [[0, '#F2AFA0'], [.5, '#F8CDA8'], [1, '#FDE9C8']], 520);
  sunRings(g, 980, 170, [[150, 'rgba(255,243,207,.35)'], [105, 'rgba(255,243,207,.5)']], 66, '#FFF1C4');
  cloudsTiled(g, cam * .04 + t * 7, 540);
  hillLayer(g, cam * .08, 400, 40, '#EBB3A0', .0042);
  hillVillage(g, cam);
  hillLayer(g, cam * .15, 440, 36, '#DD9C8C', .0053);
  houseRow(g, t, cam * .5, 520);
  tiled(760, cam * .8, (ox) => stall(g, ox + 80, 566), 400);
  cobbleStreet(g, cam);
  const chars = p.walkers || [AMA({ x: 520, y: 650, ph, prop: 'basket', t }), KOFI({ x: 735, y: 650, ph: ph + 1.4, prop: 'balloons', t })];
  chars.forEach(c => legacyPerson(g, { ...c, t }));
  bunting(g, t, cam * 1.25, 44, 46, 640, 0); bunting(g, t, cam * 1.25 + 300, 96, 38, 640, 2);
  sunbeamsAndDust(g, t, cam);
  vignette(g, .26); grainOver(g, .4);
}
export function marketMarkers(params) {
  const p = withDefaults(params, DEF), out = [];
  const dist = t => travelDist(t, { speed: p.speed, from: p.at.start, to: p.at.stop });
  for (let k = 1; k < 80; k++) {
    const d = k * Math.PI / 7.5 * p.speed; const t = timeAtDist(dist, d, 8); if (t == null) break;
    out.push({ id: 'step-ama-' + k, t, kind: 'thud' });
  }
  return out;
}
const meta = defMeta({
  id: 'story/market-street', kind: 'scene', mode: 'story', title: 'Market street walk', duration: 8,
  description: 'Warm pastel market street with bunting, striped stalls and terraced houses scrolling in parallax while two characters (basket and balloons) walk through. Use for establishing shots about community, commerce, shopping, local life.',
  params: { speed: P('number', 200, 'camera scroll speed px/s'), rig: P('string', 'legacy', "'legacy' = v2 characters"), walkers: P('array', null, 'override character specs (see people/characters)') },
  anchors: { start: ANC(null, 'seconds when walking begins (null = already walking at t=0)'), stop: ANC(null, 'seconds when the camera comes to rest (null = never)') },
  markers: ['thud'], tags: ['market', 'street', 'village', 'walking', 'parallax', 'shopping', 'community', 'warm'], example: "assets['story/market-street'].draw(g,t,{speed:200})"
});
export const assets = { 'story/market-street': { meta, draw: drawMarket, markers: marketMarkers } };
