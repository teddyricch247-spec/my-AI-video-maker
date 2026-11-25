/**
 * people/crowd.js — crowds built on the same walk solver, with simplified figures.
 *
 * crowd(g, t, o): o = { seed:1, count:24, area:[x,y,w,h] (ground band: y..y+h is where feet stand), mix:{right:.45,left:.45,stand:.1},
 *   speed:[70,150] (px/s at scale 1), presets:[names] (default: all except ama/kofi), scale:[.55,1.0] (far..near, by depth), silhouette:null|colour,
 *   lod:null|0|1 (null = auto: 1 when count>12), phase:0, at:{ start:null } }
 * Figures keep wrapping across the area horizontally; far ones are smaller and drawn first (painter's order).
 * Registered asset: 'people/crowd'.
 *
 *   import { crowd } from './people/crowd.js';
 *   crowd(g, t, {seed:4, count:40, area:[0,560,1280,120], silhouette:null});
 *   assets['people/crowd'].draw(g,t,{count:60,area:[0,520,1280,170]});
 */
import { rng, lerp } from '../core/core.js';
import { INK, TOMATO, MUSTARD, GREEN, PINK, CREAM } from '../core/palette.js';
import { SKINS, PRESETS, character, characterNames } from './characters.js';
import { drawPerson } from './rig.js';
import { defMeta, P, ANC, withDefaults } from '../environment/_meta.js';

const TOPS = [TOMATO, MUSTARD, GREEN, PINK, '#5E8C8A', '#9DB8C9', '#6C5B7B', '#E9B4A0', CREAM, '#7A8F6A'];
const PANTS = ['#4A3A33', '#3A3F4A', '#3F5E52', '#5A4A3E', '#2E2A26', '#6B5B4B'];
const DEF = { seed: 1, count: 24, area: [0, 560, 1280, 120], mix: { right: .45, left: .45, stand: .1 }, speed: [70, 150], presets: null, scale: [.55, 1], silhouette: null, lod: null, phase: 0 };

/** build the (deterministic) population for given params */
export function population(p) {
  const r = rng(p.seed * 7919 + 13), names = p.presets || characterNames().filter(n => n !== 'ama' && n !== 'kofi'), list = [];
  for (let i = 0; i < p.count; i++) {
    const m = r(), dir = m < p.mix.right ? 1 : m < p.mix.right + p.mix.left ? -1 : 0, depth = r(), name = names[(r() * names.length) | 0];
    const base = PRESETS[name]({}); const sp = lerp(p.speed[0], p.speed[1], r());
    const top = { ...base.top, col: r() < .55 ? TOPS[(r() * TOPS.length) | 0] : base.top.col, accent: TOPS[(r() * TOPS.length) | 0] };
    list.push({ name, base, dir: dir || (r() < .5 ? 1 : -1), standing: dir === 0, depth, sp, x0: r(), ph: r(), skin: SKINS[(r() * SKINS.length) | 0], top, pants: PANTS[(r() * PANTS.length) | 0], seed: i + p.seed * 100 });
  }
  list.sort((a, b) => a.depth - b.depth); return list;
}
export function crowd(g, t, params) {
  const p = withDefaults(params, DEF), [ax, ay, aw, ah] = p.area, pop = population(p), lod = p.silhouette ? 2 : (p.lod ?? (p.count > 12 ? 1 : 0)), M = 120;
  pop.forEach(q => {
    const s = (q.base.s / 1.25) * lerp(p.scale[0], p.scale[1], q.depth), y = ay + q.depth * ah, speed = q.sp * (s / 1) * 1.0;
    const span = aw + 2 * M; let x;
    if (q.standing) x = ax + q.x0 * aw; else x = ax - M + (((q.x0 * span + q.dir * speed * t) % span) + span) % span;
    const spec = { ...q.base, skin: q.skin, top: q.top, pants: q.pants, x, y, s, dir: q.dir, lod, sil: p.silhouette, seed: q.seed, noShadow: false, walk: q.standing ? null : { speed, phase: q.ph }, face: 'smile', blink: lod < 1 };
    drawPerson(g, t, spec);
  });
}
const meta = defMeta({
  id: 'people/crowd', kind: 'part', mode: 'story', title: 'Crowd of walking people', duration: 10,
  description: 'A crowd of up to 60+ people walking left and right (and some standing) in a depth band; smaller when further away. Use behind or around the main characters for city streets, markets, stations, events; set silhouette for a distant background crowd.',
  params: { seed: P('number', 1, 'random seed'), count: P('number', 24, 'number of people'), area: P('array', [0, 560, 1280, 120], '[x,y,w,h] band where feet stand'), mix: P('object', { right: .45, left: .45, stand: .1 }, 'share walking right / left / standing'), speed: P('array', [70, 150], 'px/s range'), presets: P('array', null, 'character names to use'), scale: P('array', [.55, 1], 'scale far..near'), silhouette: P('color', null, 'flat colour for silhouettes'), lod: P('number', null, '0 full, 1 simple') },
  anchors: {}, markers: [], tags: ['crowd', 'people', 'street', 'walking', 'background'], bounds: [0, 400, 1280, 320], origin: [0, 560], example: "assets['people/crowd'].draw(g,t,{seed:3,count:40,area:[0,540,1280,150]})"
});
export const assets = { 'people/crowd': { meta, draw: (g, t, p) => crowd(g, t, p), markers: () => [] } };
