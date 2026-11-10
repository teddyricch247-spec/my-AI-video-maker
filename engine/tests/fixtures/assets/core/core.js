// FIXTURE copy of the frozen core surface: small, honest implementations for tests only.
import { W, H, PAPER, INK, SANS } from './palette.js';

export const cl = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const eo = (t) => 1 - Math.pow(1 - cl(t), 3);
export const eio = (t) => { t = cl(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
export const eb = (t) => { t = cl(t); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
export const A = (t, delay, dur) => cl((t - delay) / dur);

export function rng(seed) {                      // mulberry32
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.round(cl(v + amt * 255, 0, 255));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

export function rrect(g, x, y, w, h, r = 8) {
  r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function txt(g, s, x, y, o = {}) {
  g.save();
  g.font = `${o.weight || 'bold'} ${o.size || 40}px ${o.font || SANS}`;
  g.fillStyle = o.color || INK;
  g.textAlign = o.align || 'left';
  g.textBaseline = o.baseline || 'alphabetic';
  g.globalAlpha *= o.alpha === undefined ? 1 : o.alpha;
  g.fillText(s, x, y);
  g.restore();
}

export function grainOver(g, seed = 1, n = 800, alpha = 0.06) {
  const r = rng(seed);
  g.save(); g.globalAlpha = alpha; g.fillStyle = INK;
  for (let i = 0; i < n; i++) g.fillRect(r() * W, r() * H, 1.5, 1.5);
  g.restore();
}

export function vignette(g, strength = 0.25) {
  const gr = g.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, W * 0.75);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, `rgba(0,0,0,${strength})`);
  g.save(); g.fillStyle = gr; g.fillRect(0, 0, W, H); g.restore();
}

export function halftoneDisc(g, cx, cy, r, color, step = 10) {
  g.save(); g.fillStyle = color;
  for (let y = -r; y <= r; y += step) for (let x = -r; x <= r; x += step) {
    const d = Math.hypot(x, y);
    if (d <= r) { g.beginPath(); g.arc(cx + x, cy + y, (step / 2) * (1 - d / r) + 0.5, 0, Math.PI * 2); g.fill(); }
  }
  g.restore();
}

export function tiled(g, w, h, fn) { for (let y = 0; y < H; y += h) for (let x = 0; x < W; x += w) fn(g, x, y); }
export function poly(g, pts) { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); }
export function polyAt(g, pts, x, y, s = 1) { poly(g, pts.map(([px, py]) => [x + px * s, y + py * s])); }
export function strokePoly(g, pts, w = 3) { poly(g, pts); g.lineWidth = w; g.stroke(); }

const layers = new Map();
export function getLayer(key, w, h) {
  let l = layers.get(key);
  if (!l || l.canvas.width !== w || l.canvas.height !== h) {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    l = { canvas, g: canvas.getContext('2d') };
    layers.set(key, l);
  }
  return l;
}

export function resetG(g) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.shadowBlur = 0; g.shadowColor = 'rgba(0,0,0,0)'; g.shadowOffsetX = 0; g.shadowOffsetY = 0;
  g.filter = 'none';
  g.lineWidth = 1; g.lineCap = 'butt'; g.lineJoin = 'miter'; g.setLineDash([]);
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillStyle = PAPER; g.strokeStyle = INK;
}

export async function fontsReady() {
  if (document.fonts && document.fonts.load) await document.fonts.load('bold 40px "DejaVu Sans"');
}
