/**
 * core.js - FROZEN CORE API. Helpers ported verbatim from v2.html; only `g` (context) and `T` (time) are explicit.
 * Math: cl(x,a=0,b=1) clamp; lerp(a,b,p); eo(x) ease-out cubic; eio(x) ease-in-out cubic; eb(x) ease-out-back (slight overshoot);
 *   A(t,delay,dur) = cl((t-delay)/dur) progress 0..1; rng(seed) seeded random () => [0,1); shade(hex,f) lighten (f>0) / darken (f<0) by |f|.
 * Draw: rrect(g,x,y,w,h,r) begins a rounded-rect path; txt(g,s,x,y,o) text, o = {k:alpha/reveal 0..1, st:'italic', w:weight, s:px, f:font stack,
 *   al:align, ls:letterSpacing px, mul:multiply blend, c:colour, rise:px offset}; grainOver(g,a=.5) paper grain; vignette(g,a=.25,col);
 *   halftoneDisc(g,cx,cy,R,spacing,colour,k=1) multiply dot disc; tiled(period,off,fn,pad=400) calls fn(k*period-off,k) for tiles across the frame.
 * Paths: poly(pts) -> {pts,L,T}; polyAt(p,d) point at distance d (v2.html's at()); strokePoly(g,p,d,w,c) strokes the first d px of p.
 * Infra: getLayer(key,w,h) -> {canvas,g} cached offscreen layer (caller fully redraws it); resetG(g); fontsReady() promise.
 * Usage:
 *   import { A, eo, txt, grainOver } from '../core/core.js';
 *   const k = eo(A(t, 0.2, 0.5)); txt(g, 'Hello', 100, 100, { s: 40, k });
 *   grainOver(g, .5);
 */
import { W, H, SANS, INK } from './palette.js';
export const cl = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, p) => a + (b - a) * p;
export const eo = x => 1 - Math.pow(1 - cl(x), 3);
export const eio = x => { x = cl(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2 };
export const eb = x => { x = cl(x); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2) };
export const A = (t, delay, dur) => cl((t - delay) / dur);
export function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 } }
export const rrect = (g, x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r) };
export function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16); let r = n >> 16, gg = (n >> 8) & 255, b = n & 255; const m = f < 0 ? 0 : 255, a = Math.abs(f);
  r = Math.round(lerp(r, m, a)); gg = Math.round(lerp(gg, m, a)); b = Math.round(lerp(b, m, a));
  return '#' + ((1 << 24) | (r << 16) | (gg << 8) | b).toString(16).slice(1)
}
// ---- offscreen layers (the only way to get an offscreen canvas) ----
const LAYERS = new Map();
export function getLayer(key, w, h) {
  let L = LAYERS.get(key);
  if (!L || L.canvas.width !== w || L.canvas.height !== h) {
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    L = { canvas, g: canvas.getContext('2d') }; LAYERS.set(key, L);
  }
  L.g.setTransform(1, 0, 0, 1, 0, 0); L.g.clearRect(0, 0, w, h); resetG(L.g);
  return L;
}
export function resetG(g) { g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.shadowBlur = 0; return g }
// ---- paper grain (deterministic, built once from rng(7), identical to v2.html) ----
let GRAIN = null;
function grainCanvas() {
  if (GRAIN) return GRAIN;
  const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d');
  const id = x.createImageData(512, 512), r = rng(7);
  for (let i = 0; i < id.data.length; i += 4) { const v = 216 + r() * 39 | 0; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255 }
  x.putImageData(id, 0, 0); x.strokeStyle = 'rgba(110,90,60,.08)'; x.lineWidth = 1;
  for (let i = 0; i < 320; i++) { const a = r() * 512, b = r() * 512, an = r() * 6.28, l = 6 + r() * 16; x.beginPath(); x.moveTo(a, b); x.lineTo(a + Math.cos(an) * l, b + Math.sin(an) * l); x.stroke() }
  return GRAIN = c;
}
export function grainOver(g, a = .5) { g.save(); g.globalCompositeOperation = 'multiply'; g.globalAlpha = a; g.fillStyle = g.createPattern(grainCanvas(), 'repeat'); g.fillRect(0, 0, W, H); g.restore() }
export function vignette(g, a = .25, col = '110,50,35') {
  const gr = g.createRadialGradient(W / 2, H / 2, H * .5, W / 2, H / 2, H * 1.0);
  gr.addColorStop(0, `rgba(${col},0)`); gr.addColorStop(1, `rgba(${col},${a})`); g.fillStyle = gr; g.fillRect(0, 0, W, H)
}
export function txt(g, s, x, y, o = {}) {
  const k = o.k ?? 1; if (k <= 0) return;
  g.save(); g.globalAlpha *= k; g.font = `${o.st || ''} ${o.w || 700} ${o.s || 24}px ${o.f || SANS}`; g.textAlign = o.al || 'left'; g.textBaseline = 'alphabetic';
  if (o.ls && 'letterSpacing' in g) g.letterSpacing = o.ls + 'px';
  if (o.mul) g.globalCompositeOperation = 'multiply';
  g.fillStyle = o.c || INK; g.fillText(s, x, y + (o.rise ?? (1 - k) * 16)); g.restore()
}
export function halftoneDisc(g, cx, cy, R, sp, col, k = 1) {
  g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = col;
  const ca = Math.cos(.785), sa = Math.sin(.785);
  for (let u = -R; u <= R; u += sp) for (let v = -R; v <= R; v += sp) {
    const x = u * ca - v * sa, y = u * sa + v * ca, d = Math.hypot(x, y); if (d > R) continue;
    const r = sp * .5 * Math.pow(1 - d / R, .55) * k; if (r < .7) continue; g.beginPath(); g.arc(cx + x, cy + y, r, 0, 7); g.fill()
  }
  g.restore()
}
export function tiled(period, off, fn, pad = 400) { const k0 = Math.floor((off - pad) / period), k1 = Math.floor((off + W + pad) / period); for (let k = k0; k <= k1; k++) fn(k * period - off, k) }
export function poly(pts) { const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return { pts, L, T: L[L.length - 1] } }
export function polyAt(p, d) {
  d = cl(d, 0, p.T);
  for (let i = 1; i < p.pts.length; i++) { if (d <= p.L[i]) { const q = (d - p.L[i - 1]) / (p.L[i] - p.L[i - 1] || 1); return [lerp(p.pts[i - 1][0], p.pts[i][0], q), lerp(p.pts[i - 1][1], p.pts[i][1], q)] } }
  return p.pts[p.pts.length - 1]
}
export function strokePoly(g, p, d, w, c) {
  if (d <= 0) return; g.save(); g.strokeStyle = c; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(p.pts[0][0], p.pts[0][1]);
  for (let i = 1; i < p.pts.length; i++) { if (d >= p.L[i]) g.lineTo(p.pts[i][0], p.pts[i][1]); else { const q = polyAt(p, d); g.lineTo(q[0], q[1]); break } }
  g.stroke(); g.restore()
}
export async function fontsReady() {
  const faces = ['700 20px Lora', 'italic 700 20px Lora', '400 20px Poppins', '500 20px Poppins', '700 20px Poppins', 'italic 400 20px Poppins', '400 16px "DejaVu Sans Mono"', '700 16px "DejaVu Sans Mono"'];
  await Promise.all(faces.map(f => document.fonts.load(f, 'Aa0')));
  await document.fonts.ready;
}
