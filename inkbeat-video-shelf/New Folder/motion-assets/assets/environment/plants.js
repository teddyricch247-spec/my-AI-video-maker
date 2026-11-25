/**
 * environment/plants.js — trees, bushes, flowers, crops, pot plants. All anchored at the ground point (x,y), sway in the wind.
 *
 * drawPlant(g, kind, t, o): kind = round_tree acacia palm baobab pine bush flowers tuft crop potted ; o = {x,y,s,seed,wind (0..2), col (override leaf colour), dir}
 * plantRow(g,t,{kind,cam,par,y,gap,seed,s,jit}) draws a parallax row of the same kind along a ground line (cam = world scroll in px).
 * Heights at s=1: round_tree 190, acacia 150, palm 230, baobab 170, pine 220, bush 55, flowers 40, tuft 36, crop 90, potted 90.
 * Registered: 'env/plant-<kind>' for each kind.
 *
 *   drawPlant(g,t,'acacia',{x:400,y:560,s:1.2});
 *   plantRow(g,t,{kind:'round_tree',cam:t*80,par:.6,y:520,gap:260,seed:3});
 *   assets['env/plant-palm'].draw(g,t,{x:900,y:600,wind:1.2});
 */
import { lerp, rng, shade, tiled } from '../core/core.js';
import { INK, TOMATO, MUSTARD, GREEN, PINK, CREAM, LEAF } from '../core/palette.js';
import { mk, P, XY, withDefaults } from './_meta.js';

const disc = (g, x, y, r, c) => { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill() };
const KINDS = {
  round_tree(g, t, o) {
    const c = o.col || '#4E8A5E', sw = Math.sin(t * 1.1 + o.seed) * 2 * o.wind;
    g.fillStyle = '#7A5238'; g.beginPath(); g.moveTo(-9, 0); g.lineTo(-5, -95); g.lineTo(5, -95); g.lineTo(9, 0); g.closePath(); g.fill(); g.fillStyle = shade('#7A5238', -.2); g.beginPath(); g.moveTo(2, 0); g.lineTo(3, -95); g.lineTo(5, -95); g.lineTo(9, 0); g.closePath(); g.fill();
    g.strokeStyle = '#7A5238'; g.lineWidth = 6; g.lineCap = 'round'; g.beginPath(); g.moveTo(0, -70); g.lineTo(-22 + sw * .4, -110); g.moveTo(0, -80); g.lineTo(24 + sw * .4, -116); g.stroke();
    [[-30, -128, 38, shade(c, -.12)], [32, -126, 36, shade(c, -.12)], [0, -150, 46, c], [-18, -158, 30, shade(c, .12)], [24, -160, 28, shade(c, .08)]].forEach(([x, y, r, col], i) => disc(g, x + sw * (.4 + i * .12), y, r, col));
    g.fillStyle = shade(c, -.22); g.beginPath(); g.arc(8 + sw, -138, 36, -.2, 1.5); g.arc(8 + sw, -138, 22, 1.5, -.2, true); g.fill();
  },
  acacia(g, t, o) {
    const c = o.col || '#7D9A4E', sw = Math.sin(t * .9 + o.seed) * 1.6 * o.wind;
    g.strokeStyle = '#6B4A34'; g.lineCap = 'round'; g.lineWidth = 9; g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(-6, -50, 4, -84); g.stroke();
    g.lineWidth = 6; g.beginPath(); g.moveTo(4, -80); g.lineTo(-40, -112); g.moveTo(4, -80); g.lineTo(50, -118); g.moveTo(3, -84); g.lineTo(6, -118); g.stroke();
    [[-44, -116, 52, 17], [50, -122, 56, 18], [4, -128, 66, 21], [-14, -140, 46, 15]].forEach(([x, y, rx, ry], i) => { g.fillStyle = i < 3 ? c : shade(c, .12); g.beginPath(); g.ellipse(x + sw * (1 + i * .15), y, rx, ry, 0, 0, 7); g.fill() });
    g.fillStyle = shade(c, -.2); g.beginPath(); g.ellipse(4 + sw, -118, 60, 9, 0, 0, Math.PI); g.fill();
  },
  palm(g, t, o) {
    const c = o.col || '#3F8A5C', sw = Math.sin(t * 1.3 + o.seed) * 3 * o.wind, topx = 18 + sw * .5;
    g.strokeStyle = '#A07448'; g.lineCap = 'round'; g.lineWidth = 12; g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(-4, -110, topx, -190); g.stroke();
    g.strokeStyle = shade('#A07448', -.25); g.lineWidth = 3; for (let i = 1; i < 8; i++) { const u = i / 8, x = lerp(0, topx, u * u) - 4 * u * (1 - u) * 2, y = -190 * u; g.beginPath(); g.moveTo(x - 5, y); g.lineTo(x + 5, y - 3); g.stroke() }
    const fr = [[-2.5, 70], [-2.0, 78], [-1.4, 62], [-.55, 62], [.15, 78], [.7, 72], [-1.0, 50]];
    fr.forEach(([a, L], i) => {
      const w = Math.sin(t * 1.7 + i * 1.1 + o.seed) * .06 * o.wind, aa = a + w, ex = topx + Math.cos(aa) * L, ey = -190 + Math.sin(aa) * L * .55 + L * .32;
      g.fillStyle = i % 2 ? c : shade(c, -.14); g.beginPath(); g.moveTo(topx, -190); g.quadraticCurveTo(topx + Math.cos(aa) * L * .5, -190 - 22 + Math.sin(aa) * 10, ex, ey); g.quadraticCurveTo(topx + Math.cos(aa) * L * .5, -190 - 4 + Math.sin(aa) * 12, topx, -186); g.fill()
    });
    disc(g, topx - 3, -184, 5, '#7A5238'); disc(g, topx + 4, -183, 5, '#7A5238');
  },
  baobab(g, t, o) {
    const c = o.col || '#6E9A5B', sw = Math.sin(t * .8 + o.seed) * 1.5 * o.wind;
    g.fillStyle = '#9A7653'; g.beginPath(); g.moveTo(-34, 0); g.quadraticCurveTo(-30, -60, -20, -100); g.lineTo(20, -100); g.quadraticCurveTo(32, -60, 36, 0); g.closePath(); g.fill();
    g.fillStyle = shade('#9A7653', -.18); g.beginPath(); g.moveTo(10, 0); g.quadraticCurveTo(18, -60, 14, -100); g.lineTo(20, -100); g.quadraticCurveTo(32, -60, 36, 0); g.closePath(); g.fill();
    g.strokeStyle = '#9A7653'; g.lineCap = 'round'; g.lineWidth = 9; [[-12, -98, -46, -138], [0, -100, 0, -150], [12, -98, 48, -134], [-6, -100, -22, -148], [8, -100, 28, -150]].forEach(([a, b, x, y]) => { g.beginPath(); g.moveTo(a, b); g.lineTo(x, y); g.stroke() });
    [[-48, -144, 20], [-22, -154, 18], [0, -158, 20], [28, -156, 18], [50, -140, 20]].forEach(([x, y, r], i) => disc(g, x + sw * (1 + i * .1), y, r, i % 2 ? c : shade(c, -.12)));
  },
  pine(g, t, o) {
    const c = o.col || '#35704E', sw = Math.sin(t * 1.2 + o.seed) * 1.2 * o.wind; g.fillStyle = '#6B4A34'; g.fillRect(-5, -28, 10, 28);
    for (let i = 0; i < 4; i++) { const y = -24 - i * 40, w = 50 - i * 9, x = sw * (i + 1) * .3; g.fillStyle = shade(c, i * .07 - .05); g.beginPath(); g.moveTo(x - w, y); g.lineTo(x, y - 62); g.lineTo(x + w, y); g.closePath(); g.fill(); g.fillStyle = shade(c, -.2); g.beginPath(); g.moveTo(x, y - 62); g.lineTo(x + w, y); g.lineTo(x + w * .35, y); g.closePath(); g.fill() }
  },
  bush(g, t, o) { const c = o.col || '#5B9A5E', sw = Math.sin(t * 1.4 + o.seed) * 1.2 * o.wind; [[-22, -16, 18], [0, -24, 24], [24, -15, 17], [-6, -14, 20]].forEach(([x, y, r], i) => disc(g, x + sw * .5, y, r, i === 1 ? shade(c, .1) : c)); g.fillStyle = shade(c, -.2); g.beginPath(); g.ellipse(2, -4, 44, 6, 0, 0, Math.PI); g.fill(); [[-14, -26, TOMATO], [10, -34, MUSTARD], [20, -18, PINK]].forEach(([x, y, cc]) => { if (o.berries) disc(g, x, y, 3, cc) }) },
  flowers(g, t, o) {
    const cols = o.cols || [TOMATO, MUSTARD, PINK, CREAM], r = rng(o.seed * 5 + 1);
    for (let i = 0; i < 7; i++) { const x = (i - 3) * 8 + r() * 4, h = 18 + r() * 20, sw = Math.sin(t * 1.6 + i + o.seed) * 2.2 * o.wind; g.strokeStyle = '#4E8A5E'; g.lineWidth = 2.4; g.lineCap = 'round'; g.beginPath(); g.moveTo(x, 0); g.quadraticCurveTo(x + sw * .3, -h * .5, x + sw, -h); g.stroke(); const cc = cols[i % cols.length]; for (let k = 0; k < 5; k++) { const a = k * 1.2566; disc(g, x + sw + Math.cos(a) * 4, -h + Math.sin(a) * 4, 3, cc) } disc(g, x + sw, -h, 2.6, MUSTARD) }
  },
  tuft(g, t, o) { const c = o.col || '#8E9A4A', r = rng(o.seed * 3 + 2); g.strokeStyle = c; g.lineWidth = 3.4; g.lineCap = 'round'; for (let b = 0; b < 8; b++) { const bx = (b - 4) * 4 + r() * 3, hh = 22 + r() * 16, sw = Math.sin(t * 1.8 + b + o.seed) * 3 * o.wind; g.beginPath(); g.moveTo(bx, 0); g.quadraticCurveTo(bx + (b - 4) * 1.8 + sw * .3, -hh * .6, bx + (b - 4) * 2.4 + sw, -hh); g.stroke() } },
  crop(g, t, o) { const c = o.col || '#8CB04E'; for (let k = 0; k < 3; k++) { const x = (k - 1) * 16, sw = Math.sin(t * 1.5 + k + o.seed) * 2 * o.wind; g.strokeStyle = shade(c, -.25); g.lineWidth = 3.4; g.lineCap = 'round'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + sw * .5, -64); g.stroke(); for (let i = 0; i < 4; i++) { const y = -14 - i * 14, d = i % 2 ? 1 : -1; g.fillStyle = i % 2 ? c : shade(c, .1); g.beginPath(); g.moveTo(x + sw * .3, y); g.quadraticCurveTo(x + d * 18 + sw, y - 14, x + d * 28 + sw, y + 4); g.quadraticCurveTo(x + d * 12 + sw * .6, y - 3, x + sw * .3, y); g.fill() } if (o.cob !== false) { g.fillStyle = MUSTARD; g.beginPath(); g.ellipse(x + 5 + sw * .6, -44, 3.6, 9, .2, 0, 7); g.fill() } } },
  potted(g, t, o) {
    const c = o.col || '#4E8A5E', pot = o.pot || '#C4653F'; g.fillStyle = pot; g.beginPath(); g.moveTo(-17, -32); g.lineTo(17, -32); g.lineTo(12, 0); g.lineTo(-12, 0); g.closePath(); g.fill(); g.fillStyle = shade(pot, -.18); g.fillRect(-19, -38, 38, 8); g.fillStyle = shade(pot, -.28); g.beginPath(); g.moveTo(5, -32); g.lineTo(17, -32); g.lineTo(12, 0); g.lineTo(4, 0); g.closePath(); g.fill();
    [[-1.0, 40], [-.5, 56], [0, 62], [.5, 54], [1.0, 42], [-.2, 38]].forEach(([a, L], i) => { const sw = Math.sin(t * 1.3 + i + o.seed) * .05 * o.wind, aa = a + sw; g.save(); g.translate(0, -38); g.rotate(aa); g.fillStyle = i % 2 ? c : shade(c, -.14); g.beginPath(); g.ellipse(0, -L / 2, 10, L / 2, 0, 0, 7); g.fill(); g.restore() });
  },
};
export const PLANT_KINDS = Object.keys(KINDS);
export function drawPlant(g, kind, t, o = {}) {
  const f = KINDS[kind]; if (!f) return; const q = { seed: 0, wind: 1, ...o };
  g.save(); g.translate(q.x || 0, q.y || 0); g.scale((q.s ?? 1) * (q.dir || 1), q.s ?? 1); f(g, t, q); g.restore();
}
/** parallax row of one plant kind: o={kind,cam,par (parallax factor),y,gap,seed,s,jit (0..1 spacing jitter),sj (size jitter)} */
export function plantRow(g, t, o) {
  const gap = o.gap ?? 260; tiled(gap, (o.cam || 0) * (o.par ?? 1), (ox, k) => { const r = rng(k * 131 + (o.seed || 0) * 17 + 3), jit = (o.jit ?? .6) * gap * .5; drawPlant(g, o.kind || 'round_tree', t, { x: ox + gap / 2 + (r() - .5) * jit, y: o.y ?? 520, s: (o.s ?? 1) * (1 + ((o.sj ?? .3) * (r() - .5))), seed: k, wind: o.wind ?? 1, col: o.col }) }, o.pad ?? 200);
}
const H = { round_tree: 190, acacia: 150, palm: 230, baobab: 170, pine: 220, bush: 55, flowers: 40, tuft: 36, crop: 90, potted: 90 };
const NICE = { round_tree: 'Round tree', acacia: 'Acacia tree', palm: 'Palm tree', baobab: 'Baobab tree', pine: 'Pine tree', bush: 'Bush', flowers: 'Flowers', tuft: 'Grass tuft', crop: 'Maize crop plant', potted: 'Potted plant' };
export const assets = Object.fromEntries(PLANT_KINDS.map(k => ['env/plant-' + k, mk('env/plant-' + k, {
  title: NICE[k], description: `${NICE[k]} drawn at its ground point, swaying gently in the wind; scale with s. Use for scenery (village, farm, street, savanna, garden).`, tags: ['plant', 'nature', k, 'scenery'], params: { ...XY, wind: P('number', 1, 'wind strength 0..2'), seed: P('number', 0, 'variation'), col: P('color', null, 'leaf colour override') },
  bounds: [-80, -H[k] - 40, 160, H[k] + 60], origin: [0, 0], example: `assets['env/plant-${k}'].draw(g,t,{x:640,y:560})`
}, (g, t, p) => drawPlant(g, k, t, withDefaults(p, { x: 640, y: 560, s: 1 })))]));
