import { W, H, INK, SANS } from './palette.js';

export function cl(x, a = 0, b = 1) {
  return Math.max(a, Math.min(b, x));
}

export function lerp(a, b, k) {
  return a + (b - a) * k;
}

export function eo(x) {
  const u = cl(x, 0, 1);
  return 1 - Math.pow(1 - u, 3);
}

export function eio(x) {
  const u = cl(x, 0, 1);
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

function parseColor(col) {
  if (typeof col !== 'string') return [0, 0, 0, 1];
  const s = col.trim();
  if (s[0] === '#') {
    const hex = s.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1;
      return [r, g, b, a];
    }
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      return [r, g, b, a];
    }
  }
  const m = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
  if (m) {
    return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] !== undefined ? Number(m[4]) : 1];
  }
  return [34, 30, 26, 1];
}

export function shade(col, k = 0) {
  if (!k) return col;
  const [r0, g0, b0, a] = parseColor(col);
  const adj = (c) => {
    const v = k < 0 ? c * (1 + cl(k, -1, 0)) : c + (255 - c) * cl(k, 0, 1);
    return Math.max(0, Math.min(255, Math.round(v)));
  };
  const r = adj(r0);
  const g = adj(g0);
  const b = adj(b0);
  if (a < 0.999) {
    return `rgba(${r},${g},${b},${a.toFixed(3)})`;
  }
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export function rrect(g, x, y, w, h, r = 0) {
  const rad = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  g.beginPath();
  if (typeof g.roundRect === 'function') {
    g.roundRect(x, y, w, h, rad);
    return;
  }
  const x2 = x + w;
  const y2 = y + h;
  g.moveTo(x + rad, y);
  g.lineTo(x2 - rad, y);
  g.quadraticCurveTo(x2, y, x2, y + rad);
  g.lineTo(x2, y2 - rad);
  g.quadraticCurveTo(x2, y2, x2 - rad, y2);
  g.lineTo(x + rad, y2);
  g.quadraticCurveTo(x, y2, x, y2 - rad);
  g.lineTo(x, y + rad);
  g.quadraticCurveTo(x, y, x + rad, y);
  g.closePath();
}

export function rng(seed = 1) {
  let t = (Math.floor(Number(seed) || 0) >>> 0) || 1;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function tiled(period, off, fn, pad = 0) {
  if (!period || period <= 0) return;
  const k0 = Math.floor((off - pad) / period);
  const k1 = Math.floor((off + W + pad) / period);
  for (let k = k0; k <= k1; k++) {
    fn(k * period - off, k);
  }
}

export function txt(g, str, x, y, opts = {}) {
  const size = Math.max(14, Number(opts.s || 16));
  const weight = opts.w || 700;
  const font = opts.f || SANS;
  g.save();
  g.font = `${weight} ${size}px ${font}`;
  g.textAlign = opts.al || 'left';
  g.textBaseline = opts.base || 'alphabetic';
  g.fillStyle = opts.c || INK;
  if (opts.maxW) {
    g.fillText(String(str), x, y, opts.maxW);
  } else {
    g.fillText(String(str), x, y);
  }
  g.restore();
}

const LAYERS = new Map();
const MAX_LAYERS = 24;

export function getLayer(name, w = W, h = H) {
  const key = String(name || 'default');
  let entry = LAYERS.get(key);
  if (!entry) {
    if (LAYERS.size >= MAX_LAYERS) {
      const oldest = LAYERS.keys().next().value;
      LAYERS.delete(oldest);
    }
    const canvas = typeof document !== 'undefined'
      ? document.createElement('canvas')
      : { width: w, height: h, getContext: () => null };
    canvas.width = w;
    canvas.height = h;
    entry = { canvas, g: canvas.getContext('2d') };
    LAYERS.set(key, entry);
  } else if (entry.canvas.width !== w || entry.canvas.height !== h) {
    entry.canvas.width = w;
    entry.canvas.height = h;
    entry.g = entry.canvas.getContext('2d');
  }
  return entry;
}

export function vignette(g, alpha = 0.25, rgb = '34,30,26') {
  const a = cl(alpha, 0, 1);
  if (a <= 0) return;
  g.save();
  const cx = W / 2;
  const cy = H / 2;
  const gr = g.createRadialGradient(cx, cy, W * 0.3, cx, cy, W * 0.72);
  gr.addColorStop(0, `rgba(${rgb},0)`);
  gr.addColorStop(0.65, `rgba(${rgb},${(a * 0.35).toFixed(3)})`);
  gr.addColorStop(1, `rgba(${rgb},${a.toFixed(3)})`);
  g.fillStyle = gr;
  g.fillRect(-100, -100, W + 200, H + 200);
  g.restore();
}

export function grainOver(g, alpha = 0.4) {
  const a = cl(alpha, 0, 1);
  if (a <= 0 || typeof document === 'undefined') return;
  const tile = getLayer('__core_grain__', 192, 192);
  if (!tile._filled && tile.g) {
    const r = rng(424242);
    const tg = tile.g;
    tg.clearRect(0, 0, 192, 192);
    for (let i = 0; i < 1100; i++) {
      const gx = r() * 192;
      const gy = r() * 192;
      const dark = r() < 0.55;
      tg.fillStyle = dark ? 'rgba(34,30,26,0.08)' : 'rgba(255,250,240,0.09)';
      tg.fillRect(gx, gy, 1.5, 1.5);
    }
    tile._filled = true;
  }
  if (!tile.g) return;
  g.save();
  g.globalAlpha = a * 0.55;
  for (let y = 0; y < H; y += 192) {
    for (let x = 0; x < W; x += 192) {
      g.drawImage(tile.canvas, x, y);
    }
  }
  g.restore();
}
