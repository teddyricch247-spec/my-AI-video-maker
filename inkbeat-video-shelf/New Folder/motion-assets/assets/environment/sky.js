/**
 * environment/sky.js — skies, suns, moons, clouds, stars, birds.
 *
 * drawSky(g,t,{time,to,cam,clouds,birds,horizon,at:{shift,dur}}): gradient sky + sun/moon rings + parallax clouds (+ stars at night, optional bird flock);
 *   time = dawn|morning|noon|golden|dusk|night|overcast; `to` + at.shift/at.dur cross-fades to a second time of day.
 * Helpers: skyGrad, sunRings, cloudsTiled, cloudBank, stars, birdFlock, birdsSeed (exact market port), SKY / SKY_TIMES, skyTint(time) (vignette colour for the time of day).
 * Registered: 'env/sky', 'env/birds', 'env/clouds'. All motion is closed-form in t; valid for t = 0–15.
 *
 *   assets['env/sky'].draw(g,t,{time:'golden',to:'night',at:{shift:3,dur:4},birds:true});
 */
import { cl, lerp, rng, tiled, shade } from '../core/core.js';
import { W, H } from '../core/palette.js';
import { mk, P, ANC, withDefaults } from './_meta.js';

/** vertical gradient fill from y=0 to y=h. stops: [[pos,color],...] */
export function skyGrad(g, stops, h = 520, y0 = 0) {
  const sk = g.createLinearGradient(0, y0, 0, h); stops.forEach(([p, c]) => sk.addColorStop(p, c));
  g.fillStyle = sk; g.fillRect(0, 0, W, H);
}
/** sun made of soft rings + core disc (market look) */
export function sunRings(g, x, y, rings, coreR, coreCol) {
  rings.forEach(([r, c]) => { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill() });
  g.fillStyle = coreCol; g.beginPath(); g.arc(x, y, coreR, 0, 7); g.fill();
}
/** parallax clouds (exact market port). off = cam*.04 + t*7 */
export function cloudsTiled(g, off, period = 540, col = 'rgba(255,247,235,.85)') {
  tiled(period, off, (ox, k) => {
    const r = rng(k * 97 + 5), y = 90 + r() * 110, s = .7 + r() * .6; g.fillStyle = col;
    g.beginPath(); g.roundRect(ox + 10, y + 16 * s, 150 * s, 26 * s, 13 * s); g.fill(); g.beginPath(); g.arc(ox + 55 * s + 10, y + 16 * s, 24 * s, 0, 7); g.fill(); g.beginPath(); g.arc(ox + 92 * s + 10, y + 10 * s, 30 * s, 0, 7); g.fill()
  }, 200);
}
/** flock of 4 flapping birds (exact dunes port) */
export function birdsSeed(g, t, col = '#8A3F36') {
  for (let i = 0; i < 4; i++) {
    const x = ((300 + i * 210 + t * 38) % (W + 120)) - 60, y = 120 + i * 26 + Math.sin(t * 1.7 + i) * 8, f = Math.sin(t * 8 + i * 2) * 7;
    g.strokeStyle = col; g.lineWidth = 3; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(x - 13, y - f); g.quadraticCurveTo(x - 6, y - 6, x, y); g.quadraticCurveTo(x + 6, y - 6, x + 13, y - f); g.stroke()
  }
}

/** sky presets: gradient stops, sun/moon disc (x,y,r), ring colours, cloud colour, star alpha, bird colour, ambient tint (for vignette) */
export const SKY = {
  dawn: { g: [[0, '#B9A3C9'], [.45, '#F2B0A0'], [1, '#FBD9A8']], sun: [330, 330, 64, '#FFF0C8'], rings: [[150, 'rgba(255,230,190,.25)'], [104, 'rgba(255,230,190,.35)']], cloud: 'rgba(255,226,214,.85)', stars: .25, bird: '#7A4A4A', vig: '120,60,70' },
  morning: { g: [[0, '#F2AFA0'], [.5, '#F8CDA8'], [1, '#FDE9C8']], sun: [980, 170, 66, '#FFF1C4'], rings: [[150, 'rgba(255,243,207,.35)'], [105, 'rgba(255,243,207,.5)']], cloud: 'rgba(255,247,235,.85)', stars: 0, bird: '#8A3F36', vig: '110,50,35' },
  noon: { g: [[0, '#8FC9D6'], [.55, '#BDE0DC'], [1, '#F4EBCB']], sun: [900, 110, 56, '#FFF6D2'], rings: [[120, 'rgba(255,250,225,.30)'], [86, 'rgba(255,250,225,.45)']], cloud: 'rgba(255,255,250,.92)', stars: 0, bird: '#4A5A5A', vig: '90,70,40' },
  golden: { g: [[0, '#E9907E'], [.55, '#F6B98E'], [1, '#FBDDB0']], sun: [900, 292, 82, '#FFF3CF'], rings: [[190, 'rgba(255,225,176,.20)'], [132, 'rgba(255,225,176,.30)']], cloud: 'rgba(255,226,196,.8)', stars: 0, bird: '#8A3F36', vig: '120,45,30' },
  dusk: { g: [[0, '#4E3F6B'], [.4, '#B2587A'], [.75, '#EE8A66'], [1, '#F8C48A']], sun: [640, 440, 70, '#FFD9A0'], rings: [[170, 'rgba(255,190,140,.22)'], [118, 'rgba(255,190,140,.32)']], cloud: 'rgba(230,140,150,.8)', stars: .35, bird: '#3A2A3A', vig: '70,30,60' },
  night: { g: [[0, '#241B3A'], [.6, '#4A3560'], [1, '#7A4A6A']], moon: [940, 150, 46, '#FFF1C4'], rings: [[110, 'rgba(255,241,196,.10)'], [76, 'rgba(255,241,196,.16)']], cloud: 'rgba(120,96,140,.7)', stars: 1, bird: '#1A1226', vig: '40,20,60' },
  overcast: { g: [[0, '#B4B0AA'], [.6, '#CFC8BB'], [1, '#E7DECB']], sun: null, rings: [], cloud: 'rgba(238,233,224,.9)', stars: 0, bird: '#5A5650', vig: '90,80,70' },
};
export const SKY_TIMES = Object.keys(SKY);
/** wide soft cloud banks, parallax (cam px) with slow drift; shade = colour */
export function cloudBank(g, t, cam, col, y0 = 90, spread = 110, period = 540, par = .04, drift = 7) { cloudsTiled(g, cam * par + t * drift, period, col) }
/** twinkling stars (deterministic) */
export function stars(g, t, alpha = 1, count = 70, ymax = 360) {
  const r = rng(77); g.save(); for (let i = 0; i < count; i++) { const x = r() * W, y = r() * ymax, k = .5 + .5 * Math.sin(t * (1 + r() * 2) + r() * 6), s = 1 + r() * 1.8; g.fillStyle = `rgba(255,244,214,${alpha * (.35 + .5 * k)})`; g.beginPath(); g.arc(x, y, s, 0, 7); g.fill() } g.restore();
}
/** a flock of V-flapping birds crossing the sky. o={n,y,speed,col,seed,x0} */
export function birdFlock(g, t, o = {}) {
  const n = o.n ?? 5, r = rng((o.seed || 1) * 31 + 5), col = o.col || '#8A3F36', sp = o.speed ?? 46;
  for (let i = 0; i < n; i++) { const dx = r() * 220 - 110, dy = Math.abs(dx) * .25 + r() * 26, x = ((o.x0 ?? 100) + dx + t * sp) % (W + 240) - 120, y = (o.y ?? 140) + dy + Math.sin(t * 1.7 + i) * 7, f = Math.sin(t * 8 + i * 2) * 7;
    g.strokeStyle = col; g.lineWidth = 3; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(x - 13, y - f); g.quadraticCurveTo(x - 6, y - 6, x, y); g.quadraticCurveTo(x + 6, y - 6, x + 13, y - f); g.stroke() }
}
/**
 * drawSky(g,t,o): full sky. o={time:'dawn|morning|noon|golden|dusk|night|overcast', cam:0, clouds:true, birds:false, sunx,suny (override), rise: 0..1 optional sun/moon rise offset, horizon:520}
 *   with at.shift (s) and to:'dusk' the sky cross-fades from `time` to `to` over at.dur seconds (colours blend; sun moves).
 */
export function drawSky(g, t, o0) {
  const o = withDefaults(o0, { time: 'morning', to: null, cam: 0, clouds: true, birds: false, horizon: 520, sunx: null, suny: null, at: { shift: 1, dur: 3 } });
  const A = SKY[o.time] || SKY.morning, B = o.to ? SKY[o.to] : null, k = B ? eio01((t - o.at.shift) / o.at.dur) : 0;
  const mix = (a, b) => k <= 0 ? a : k >= 1 ? b : mixCol(a, b, k);
  const stops = A.g.map((st, i) => [st[0], mix(st[1], B ? B.g[Math.min(i, B.g.length - 1)][1] : st[1])]);
  skyGrad(g, stops, o.horizon);
  const sa = lerp(A.stars, B ? B.stars : A.stars, k); if (sa > .02) stars(g, t, sa);
  const sunA = A.sun || A.moon, sunB = B ? (B.sun || B.moon) : null;
  if (A.sun || (B && B.sun)) { const S0 = A.sun || [sunB[0], sunB[1] + 200, sunB[2], sunB[3]], S1 = B ? (B.sun || [S0[0], S0[1] + 260, S0[2], S0[3]]) : S0; const x = o.sunx ?? lerp(S0[0], S1[0], k), y = (o.suny ?? lerp(S0[1], S1[1], k)) + Math.sin(t * .3) * 1.5; sunRings(g, x, y, A.rings, lerp(S0[2], S1[2], k), S0[3]) }
  if (A.moon || (B && B.moon)) { const M = A.moon || B.moon, y = M[1] + (A.moon ? 0 : (1 - k) * 220); g.globalAlpha = A.moon ? 1 : k; sunRings(g, M[0], y, A.rings.length ? A.rings : B.rings, M[2], M[4] || M[3]); g.fillStyle = shade(M[3], -.08); [[-12, -8, 7], [10, 12, 9], [8, -16, 5]].forEach(([dx, dy, r]) => { g.beginPath(); g.arc(M[0] + dx, y + dy, r, 0, 7); g.fill() }); g.globalAlpha = 1 }
  if (o.clouds) cloudBank(g, t, o.cam, mix(A.cloud, B ? B.cloud : A.cloud));
  if (o.birds) birdFlock(g, t, { col: A.bird });
}
const eio01 = x => { x = cl(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2 };
function parseC(c) { if (c[0] === '#') { const n = parseInt(c.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255, 1] } const m = c.match(/[\d.]+/g).map(Number); return [m[0], m[1], m[2], m[3] ?? 1] }
function mixCol(a, b, k) { const A = parseC(a), B = parseC(b), v = A.map((x, i) => lerp(x, B[i], k)); return `rgba(${v[0] | 0},${v[1] | 0},${v[2] | 0},${v[3].toFixed(3)})` }
export const skyTint = time => (SKY[time] || SKY.morning).vig;
const pre = { x: 0 };
export const assets = {
  'env/sky': mk('env/sky', { title: 'Sky (time of day)', description: 'Full-screen sky background with sun or moon, parallax clouds, stars at night; time = dawn, morning, noon, golden, dusk, night or overcast. Set to + at.shift/at.dur to transition between two times of day. Draw first, then terrain and buildings.', tags: ['sky', 'background', 'sun', 'moon', 'clouds', 'time-of-day', 'stars'], params: { time: P('string', 'morning', 'dawn|morning|noon|golden|dusk|night|overcast'), to: P('string', null, 'optional second time of day to fade to'), cam: P('number', 0, 'camera scroll px (parallax clouds)'), clouds: P('bool', true, 'draw clouds'), birds: P('bool', false, 'draw a bird flock'), horizon: P('number', 520, 'gradient bottom y') }, anchors: { shift: ANC(1, 'seconds when to-transition starts'), dur: ANC(3, 'transition length (s)') }, bounds: [0, 0, 1280, 520], origin: [0, 0], example: "assets['env/sky'].draw(g,t,{time:'golden',to:'dusk',at:{shift:2,dur:4}})" }, drawSky),
  'env/birds': mk('env/birds', { title: 'Bird flock', description: 'A small V-shaped flock of birds flapping across the sky. Use for atmosphere in outdoor scenes; col tints them for time of day.', tags: ['birds', 'sky', 'nature', 'fx'], params: { n: P('number', 5, 'birds'), y: P('number', 140, 'altitude'), speed: P('number', 46, 'px/s'), col: P('color', '#8A3F36', 'colour'), seed: P('number', 1, 'seed') }, bounds: [0, 60, 1280, 220], origin: [0, 0] }, (g, t, p) => birdFlock(g, t, p || {})),
  'env/clouds': mk('env/clouds', { title: 'Cloud bank', description: 'Soft drifting parallax clouds; use over a plain sky colour.', tags: ['clouds', 'sky', 'weather'], params: { cam: P('number', 0, 'camera px'), col: P('color', 'rgba(255,247,235,.85)', 'cloud colour') }, bounds: [0, 60, 1280, 200], origin: [0, 0] }, (g, t, p) => { const q = withDefaults(p, { cam: 0, col: 'rgba(255,247,235,.85)' }); cloudBank(g, t, q.cam, q.col) }),
};

