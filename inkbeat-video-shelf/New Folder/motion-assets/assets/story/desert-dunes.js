/**
 * story/desert-dunes.js — 'story/desert-dunes' (port of the v2.html "dunes" seed).
 * Golden-hour dunes, a camel-less caravan of tiny silhouettes, an arch, two walkers with long shadows and footprints.
 *
 *   import { assets } from './story/desert-dunes.js';
 *   assets['story/desert-dunes'].draw(g, t, { speed: 120 });
 *
 * params: speed (camera px/s, 120), walkers (null = Ama in green + Kofi waving), at.start / at.stop as in market-street.
 */
import { vignette, grainOver, tiled, getLayer, shade } from '../core/core.js';
import { W, H, GREEN, CREAM, TOMATO, MUSTARD } from '../core/palette.js';
import { skyGrad, sunRings, birdsSeed } from '../environment/sky.js';
import { DUNES, FGN, drawDune, duneArches, foregroundSand, dryTufts } from '../environment/terrain.js';
import { legacyPerson, AMA, KOFI } from '../people/rig.js';
import { travelDist, timeAtDist } from '../people/locomotion.js';
import { defMeta, P, ANC, withDefaults } from '../environment/_meta.js';

const DEF = { speed: 120, walkers: null, at: { start: null, stop: null } };

export function drawDunes(g, t, params) {
  const p = withDefaults(params, DEF);
  const D = travelDist(t, { speed: p.speed, from: p.at.start, to: p.at.stop });
  const cam = D, k5 = p.speed ? D / p.speed : 0, feetY = wx => FGN(wx) + 44;
  skyGrad(g, [[0, '#E9907E'], [.55, '#F6B98E'], [1, '#FBDDB0']], 430);
  sunRings(g, 900, 292, [[190, 'rgba(255,225,176,.20)'], [132, 'rgba(255,225,176,.30)']], 82, '#FFF3CF');
  birdsSeed(g, t);
  DUNES.forEach((Dn, i) => {
    drawDune(g, Dn, cam);
    if (i === 1) duneArches(g, Dn, cam);
    if (i === 2) tiled(1900, cam * Dn.d, (ox) => { for (let k = 0; k < 5; k++) { const sx = ox + 500 + k * 32, sy = Dn.fn(sx + cam * Dn.d); legacyPerson(g, { x: sx, y: sy + 3, s: .15, ph: k5 * 5 + k * .9, sil: '#7C3A33', t }) } }, 300);
  });
  foregroundSand(g, cam);
  const wA = cam + 520, wK = cam + 735;
  [[wA, 0, 76], [wK, 31, 86]].forEach(([wc, o0, st]) => {
    for (let n = Math.floor((cam - 60 - o0) / st); n <= Math.ceil((wc - 30 - o0) / st); n++) {
      const wx = n * st + o0; if (wx > wc - 34) continue;
      const x = wx - cam, y = feetY(wx) + (n % 2 ? 7 : -5); g.fillStyle = 'rgba(190,128,84,.75)'; g.beginPath(); g.ellipse(x, y, 12, 4.5, 0, 0, 7); g.fill()
    }
  });
  const L = getLayer('story:shadow', W, H), sg = L.g; sg.setTransform(1, 0, 0, 1, 0, 0); sg.clearRect(0, 0, W, H);
  const ph = k5 * 5.6;
  const chars = p.walkers || [AMA({ coat: GREEN, acc: CREAM, x: 520, y: feetY(wA), ph, t, prop: null }), KOFI({ coat: CREAM, cap: TOMATO, pants: '#7A3B34', acc: MUSTARD, x: 735, y: feetY(wK), ph: ph + 1.4, t, pose: 'wave' })];
  chars.forEach(c => { sg.setTransform(1, 0, 1.15, -.26, c.x, c.y); legacyPerson(sg, { ...c, t, x: 0, y: 0, sil: '#7A3B34', noShadow: 1 }) }); sg.setTransform(1, 0, 0, 1, 0, 0);
  g.save(); g.globalAlpha = .4; g.globalCompositeOperation = 'multiply'; g.drawImage(L.canvas, 0, 0); g.restore();
  chars.forEach(c => legacyPerson(g, { ...c, t }));
  dryTufts(g, t, cam);
  vignette(g, .24, '120,45,30'); grainOver(g, .4);
}
export function dunesMarkers(params) {
  const p = withDefaults(params, DEF), out = [], dist = t => travelDist(t, { speed: p.speed, from: p.at.start, to: p.at.stop });
  for (let k = 1; k < 80; k++) { const t = timeAtDist(dist, k * Math.PI / 5.6 * p.speed, 8); if (t == null) break; out.push({ id: 'step-' + k, t, kind: 'thud' }) }
  return out;
}
const meta = defMeta({
  id: 'story/desert-dunes', kind: 'scene', mode: 'story', title: 'Desert dunes walk', duration: 8,
  description: 'Golden-hour desert dunes in five parallax layers with long cast shadows and footprints, two walkers (one waving) and a distant caravan. Use for journeys, travel, exploration, perseverance, endings.',
  params: { speed: P('number', 120, 'camera scroll speed px/s'), walkers: P('array', null, 'override character specs') },
  anchors: { start: ANC(null, 'seconds when walking begins (null = already walking)'), stop: ANC(null, 'seconds when scene comes to rest (null = never)') },
  markers: ['thud'], tags: ['desert', 'dunes', 'journey', 'sunset', 'walking', 'travel', 'shadow', 'parallax'], example: "assets['story/desert-dunes'].draw(g,t,{})"
});
export const assets = { 'story/desert-dunes': { meta, draw: drawDunes, markers: dunesMarkers } };
