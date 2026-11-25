/**
 * environment/weather-fx.js — sunbeams, dust motes, rain, falling leaves, smoke, dust trails, ripples.
 *
 * All effects are particle fields computed from t and a seed only (nothing accumulates), so any t is valid and loops forever.
 * sunbeams / dustMotes / sunbeamsAndDust are exact market ports. rain, leaves, smoke, dustTrail, ripple take an options object.
 * Registered: 'env/fx-sunbeams', 'env/fx-rain', 'env/fx-leaves', 'env/fx-smoke', 'env/fx-dust', 'env/fx-ripple' (ripple has anchor at.start and a 'pop' marker).
 *
 *   assets['env/fx-rain'].draw(g,t,{n:200,angle:.25});
 */
import { rng, shade } from '../core/core.js';
import { W, H, CREAM, TOMATO, MUSTARD, GREEN } from '../core/palette.js';
import { mk, P, withDefaults } from './_meta.js';

/** screen-blended sun rays (exact market port) from (x,y) at the given angles */
export function sunbeams(g, x = 980, y = 170, angles = [2.45, 2.62, 2.8], alpha = .10) {
  g.save(); g.globalCompositeOperation = 'screen'; g.fillStyle = `rgba(255,236,190,${alpha})`;
  angles.forEach((a, i) => { const sp = .045 + i * .01, L = 1700; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a - sp) * L, y + Math.sin(a - sp) * L); g.lineTo(x + Math.cos(a + sp) * L, y + Math.sin(a + sp) * L); g.closePath(); g.fill() });
  g.restore();
}
/** drifting dust motes (exact market port; call inside a 'screen' save if you want identical blending) */
export function dustMotes(g, t, cam = 0, count = 30) {
  const r = rng(5);
  for (let i = 0; i < count; i++) {
    const x0 = r() * W, y0 = r() * H * .8, sp = 8 + r() * 14; const x = ((x0 - cam * 1.1 + t * sp) % W + W) % W, y = y0 + Math.sin(t * .8 + i) * 10;
    g.fillStyle = 'rgba(255,246,225,.7)'; g.beginPath(); g.arc(x, y, 1.5 + r() * 2, 0, 7); g.fill()
  }
}
/** exact market combo: sunbeams + dust inside one screen-blended group */
export function sunbeamsAndDust(g, t, cam) {
  g.save(); g.globalCompositeOperation = 'screen'; g.fillStyle = 'rgba(255,236,190,.10)';
  [2.45, 2.62, 2.8].forEach((a, i) => { const sp = .045 + i * .01, L = 1700; g.beginPath(); g.moveTo(980, 170); g.lineTo(980 + Math.cos(a - sp) * L, 170 + Math.sin(a - sp) * L); g.lineTo(980 + Math.cos(a + sp) * L, 170 + Math.sin(a + sp) * L); g.closePath(); g.fill() });
  dustMotes(g, t, cam, 30);
  g.restore();
}

/** rain streaks. o={n:140,angle:.18,speed:900,col,len:26,seed} — falls forever, wraps; deterministic */
export function rain(g, t, o0) {
  const o = withDefaults(o0, { n: 140, angle: .18, speed: 900, col: 'rgba(240,248,255,.55)', len: 26, seed: 3, splash: true }), r = rng(o.seed); g.save(); g.strokeStyle = o.col; g.lineWidth = 2; g.lineCap = 'round';
  for (let i = 0; i < o.n; i++) { const x0 = r() * (W + 200) - 100, y0 = r() * H, sp = o.speed * (.8 + r() * .5), d = r() < .3 ? 1.4 : 1, y = (y0 + t * sp) % (H + 60) - 30, x = x0 - Math.tan(o.angle) * (y - 0) * 0 + Math.sin(o.angle) * (y); g.globalAlpha = .5 + .5 * r(); g.beginPath(); g.moveTo(x, y); g.lineTo(x - Math.sin(o.angle) * o.len * d, y - Math.cos(o.angle) * o.len * d); g.stroke() }
  g.restore();
}
/** falling leaves, swirling. o={n:18,cols:[TOMATO,MUSTARD,'#C4653F',GREEN],seed,speed:60} */
export function leaves(g, t, o0) {
  const o = withDefaults(o0, { n: 18, cols: [TOMATO, MUSTARD, '#C4653F', '#8DBB4C'], seed: 9, speed: 60 }), r = rng(o.seed);
  for (let i = 0; i < o.n; i++) { const x0 = r() * W, y0 = r() * H, sp = o.speed * (.6 + r()), ph = r() * 6, y = (y0 + t * sp) % (H + 40) - 20, x = x0 + Math.sin(t * 1.3 + ph) * 40 + t * 12 * (r() - .3), rot = Math.sin(t * 2 + ph) * 1.2 + ph; g.save(); g.translate(((x % W) + W) % W, y); g.rotate(rot); g.fillStyle = o.cols[i % o.cols.length]; g.beginPath(); g.ellipse(0, 0, 7, 3.6, 0, 0, 7); g.fill(); g.strokeStyle = shade(o.cols[i % o.cols.length], -.3); g.lineWidth = 1; g.beginPath(); g.moveTo(-7, 0); g.lineTo(7, 0); g.stroke(); g.restore() }
}
/** rising smoke plume from (x,y). o={x,y,s,col,n:7} */
export function smoke(g, t, o0) {
  const o = withDefaults(o0, { x: 640, y: 400, s: 1, col: 'rgba(235,225,215,.85)', n: 8 }); g.save();
  for (let i = 0; i < o.n; i++) { const u = ((t * .35 + i / o.n) % 1), x = o.x + Math.sin(u * 5 + i) * 14 * u * o.s + u * 26 * o.s, y = o.y - u * 120 * o.s, r = (8 + u * 22) * o.s; g.globalAlpha = (1 - u) * .85 * (u < .1 ? u * 10 : 1); g.fillStyle = o.col; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill() } g.restore();
}
/** ground dust kicked up behind walkers / vehicles. o={x,y,dir:-1,s,rate} puffs trail behind (dir = movement direction) */
export function dustTrail(g, t, o0) {
  const o = withDefaults(o0, { x: 640, y: 640, dir: 1, s: 1, n: 6, col: 'rgba(225,185,140,.7)' }); g.save();
  for (let i = 0; i < o.n; i++) { const u = ((t * 1.4 + i / o.n) % 1), x = o.x - o.dir * (u * 90 * o.s), y = o.y - u * 28 * o.s, r = (5 + u * 16) * o.s; g.globalAlpha = (1 - u) * .7; g.fillStyle = o.col; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill() } g.restore();
}
/** expanding water ripples (e.g. a stone drop) at (x,y). o={x,y,rings:3,period:1.6,at:{start:0},w:140} */
export function ripple(g, t, o0) {
  const o = withDefaults(o0, { x: 640, y: 600, rings: 3, period: 1.6, w: 140, col: 'rgba(255,255,255,.7)', at: { start: 0 } }); g.save(); g.strokeStyle = o.col; g.lineWidth = 3;
  for (let i = 0; i < o.rings; i++) { const u = ((t - o.at.start) / o.period - i / o.rings); if (u < 0) continue; const k = ((u % 1) + 1) % 1; g.globalAlpha = (1 - k) * .9; const rw = Math.max(5, o.w * k); g.beginPath(); g.ellipse(o.x, o.y, rw, rw * .32, 0, 0, 7); g.stroke() } g.restore();
}
export const assets = {
  'env/fx-sunbeams': mk('env/fx-sunbeams', { title: 'Sun rays and dust motes', description: 'Soft screen-blended sun rays with floating dust motes; place at the sun position. Use over warm scenes for atmosphere.', tags: ['fx', 'sunbeams', 'dust', 'light'], params: { x: P('number', 980, 'sun x'), y: P('number', 170, 'sun y'), cam: P('number', 0, 'camera px (dust parallax)') }, bounds: [0, 0, 1280, 720] }, (g, t, p) => { const q = withDefaults(p, { x: 980, y: 170, cam: 0 }); if (q.x === 980 && q.y === 170) sunbeamsAndDust(g, t, q.cam); else { sunbeams(g, q.x, q.y); g.save(); g.globalCompositeOperation = 'screen'; dustMotes(g, t, q.cam); g.restore() } }),
  'env/fx-rain': mk('env/fx-rain', { title: 'Rain', description: 'Diagonal rain streaks across the whole frame. Use for weather, mood, gloomy scenes; combine with the overcast sky.', tags: ['fx', 'rain', 'weather'], params: { n: P('number', 140, 'streaks'), angle: P('number', .18, 'slant rad'), speed: P('number', 900, 'px/s') }, bounds: [0, 0, 1280, 720] }, (g, t, p) => rain(g, t, p)),
  'env/fx-leaves': mk('env/fx-leaves', { title: 'Falling leaves', description: 'Autumn leaves drifting down across the frame.', tags: ['fx', 'leaves', 'autumn', 'wind'], params: { n: P('number', 18, 'leaves'), speed: P('number', 60, 'fall px/s') }, bounds: [0, 0, 1280, 720] }, (g, t, p) => leaves(g, t, p)),
  'env/fx-smoke': mk('env/fx-smoke', { title: 'Smoke plume', description: 'Rising soft smoke from a chimney or fire at (x,y).', tags: ['fx', 'smoke', 'chimney'], params: { x: P('number', 640, 'x'), y: P('number', 400, 'base y'), s: P('number', 1, 'scale') }, bounds: [500, 240, 300, 200], origin: [640, 400] }, (g, t, p) => smoke(g, t, p)),
  'env/fx-dust': mk('env/fx-dust', { title: 'Dust trail', description: 'Puffs of dust trailing behind a walker, vehicle or animal moving in direction dir.', tags: ['fx', 'dust', 'trail', 'motion'], params: { x: P('number', 640, 'x'), y: P('number', 640, 'ground y'), dir: P('number', 1, 'movement direction'), s: P('number', 1, 'scale') }, bounds: [500, 580, 240, 80] }, (g, t, p) => dustTrail(g, t, p)),
  'env/fx-ripple': mk('env/fx-ripple', { title: 'Water ripples', description: 'Expanding ripple rings on water at (x,y); starts at at.start.', tags: ['fx', 'water', 'ripple'], params: { x: P('number', 640, 'x'), y: P('number', 600, 'y'), rings: P('number', 3, 'rings'), w: P('number', 140, 'max radius') }, anchors: { start: { default: 0, desc: 'seconds when ripples begin' } }, markerKinds: ['pop'], bounds: [480, 540, 320, 100] }, (g, t, p) => ripple(g, t, p), p => [{ id: 'plop', t: (p && p.at && p.at.start) || 0, kind: 'pop' }]),
};

