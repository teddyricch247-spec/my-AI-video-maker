/**
 * environment/_meta.js — internal helpers (NOT an asset module): meta builders, param merging and the shared idle-motion layer.
 *
 * defMeta(o), P(type,def,desc), ANC(def,desc), withDefaults(params,defs), mk(id,opts,draw,markers), XY,
 * idled(id, draw, () => meta) wraps a draw() with the idle motion its id calls for (all pure functions of t):
 *   'sway' thin posts / hanging frames rock a fraction of a degree about their anchor;
 *   'bob' parked motor vehicles shake with the idling engine;  'float' held props hover and tilt;
 *   'sheen' solid objects get a faint drifting shade plus a flat light band sweeping over their silhouette every ~5 s (masked with source-atop in a core layer);
 *   'cloudshade' terrain layers get slow cloud shadows drifting over them.
 * Convention for every asset meta: bounds = absolute canvas rect drawn with default params; origin = default anchor (x,y).
 */
import { getLayer } from '../core/core.js';
import { BOUNDS } from './_bounds.js';
/** builds meta objects with defaults. Measured bounds (see _bounds.js) override authored ones. */
export function defMeta(o) {
  const m = {
    kind: 'part', mode: 'story', holds: true, duration: 8, params: {}, anchors: {}, markers: [], tags: [],
    bounds: [0, 0, 1280, 720], origin: [0, 0], example: '', ...o
  };
  if (BOUNDS[m.id]) m.bounds = BOUNDS[m.id].slice();
  return m;
}
export const P = (type, def, desc) => ({ type, default: def, desc });
export const ANC = (def, desc) => ({ default: def, desc });
/** merge defaults into params (shallow, plus one level for `at`) */
export function withDefaults(params, defs) {
  const o = { ...defs, ...(params || {}) };
  if (defs.at) o.at = { ...defs.at, ...((params && params.at) || {}) };
  return o;
}


const IDLE = [
  [/^env\/(building|house|shop)-/, 'sheen'], [/^env\/furniture-(desk|shelves|whiteboard|chair)$/, 'sheen'], [/^env\/furniture-poster$/, 'sway'],
  [/^env\/street-(lamp_post|sign|billboard)$/, 'sway'], [/^env\/street-(bench|bus_stop|crates|fence)$/, 'sheen'],
  [/^env\/vehicle-(bus|car|taxi|truck|motorbike|train)$/, 'bob'], [/^env\/vehicle-(bicycle|handcart)$/, 'sheen'],
  [/^env\/(hills|mountains|ground)$/, 'cloudshade'], [/^people\/prop-/, 'float'], [/^people\/hand$/, 'sway'],
];
/** wrap draw(g,t,p) with idle motion chosen by asset id (no-op for ids without a rule). getMeta is read lazily (bounds / origin). */
export function idled(id, draw, getMeta) {
  const rule = IDLE.find(r => r[0].test(id)); if (!rule) return draw;
  const kind = rule[1]; let seed = 7; for (let i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) >>> 0;
  const ph = (seed % 97) / 97 * 6.283, per = 4.4 + (seed % 5) * .3;
  return (g, t, p) => {
    const m = getMeta(), q = p || {}, ox = m.origin[0], oy = m.origin[1], ax = typeof q.x === 'number' ? q.x : ox, ay = typeof q.y === 'number' ? q.y : oy, s = typeof q.s === 'number' ? q.s : 1;
    if (kind === 'sway' || kind === 'float') {
      g.save(); if (kind === 'float') g.translate(0, Math.sin(t * 1.7 + ph) * 3);
      g.translate(ax, ay); g.rotate(Math.sin(t * 1.15 + ph) * (kind === 'sway' ? .007 : .03)); g.translate(-ax, -ay); draw(g, t, p); g.restore(); return;
    }
    if (kind === 'bob') { g.save(); g.translate(0, Math.sin(t * 22 + ph) * .45 + Math.sin(t * 9 + ph) * .25); draw(g, t, p); g.restore(); return }
    // layered kinds: draw into a core layer under the caller's transform, tint only painted pixels, composite
    const cw = (g.canvas && g.canvas.width) || 1280, ch = (g.canvas && g.canvas.height) || 720;
    const Lr = getLayer('idle:' + kind, cw, ch), lg = Lr.g, tr = g.getTransform();
    lg.setTransform(1, 0, 0, 1, 0, 0); lg.globalAlpha = 1; lg.globalCompositeOperation = 'source-over'; lg.clearRect(0, 0, cw, ch);
    lg.setTransform(tr); draw(lg, t, p);
    const b = m.bounds, cx = ax + (b[0] + b[2] / 2 - ox) * s, cy = ay + (b[1] + b[3] / 2 - oy) * s, hw = b[2] * s / 2, hh = b[3] * s / 2;
    lg.save(); lg.globalCompositeOperation = 'source-atop';
    if (kind === 'sheen') {
      lg.fillStyle = 'rgba(60,45,40,.05)'; { const x = cx - hw - 200 + ((((t * 16 + ph * 30) % (2 * hw + 400)) + 2 * hw + 400) % (2 * hw + 400)); lg.beginPath(); lg.ellipse(x, cy, Math.max(80, hw * .9), hh * 1.4 + 20, 0, 0, 7); lg.fill() }   // always-on faint drifting shade
      const u = (((t + ph) % per) + per) % per / per, k = u / .62;
      if (k < 1) { const e = k * k * (3 - 2 * k), x = cx - hw - hh * .5 - 60 + e * (2 * hw + hh + 120), sl = hh * .6; for (const [w, a] of [[hw * .22 + 10, .16], [hw * .07 + 4, .22]]) { lg.fillStyle = `rgba(255,246,222,${a})`; lg.beginPath(); lg.moveTo(x - w, cy + hh + 10); lg.lineTo(x - w + sl, cy - hh - 10); lg.lineTo(x + w + sl, cy - hh - 10); lg.lineTo(x + w, cy + hh + 10); lg.closePath(); lg.fill() } }
    } else {
      lg.fillStyle = 'rgba(60,45,40,.09)';
      for (let i = 0; i < 3; i++) { const x = (((t * (14 + i * 5) + i * 520 + ph * 40) % 1900) + 1900) % 1900 - 300; lg.beginPath(); lg.ellipse(x, cy + (i - 1) * hh * .5, 240 + i * 50, 46 + i * 12, 0, 0, 7); lg.fill() }
    }
    lg.restore();
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(Lr.canvas, 0, 0); g.restore();
  };
}

/** register helper: builds {meta,draw,markers} for a simple part. o = {title, description, tags, params, bounds, origin, mode, kind, markers:[kinds], anchors, example, duration} */
export function mk(id, o, draw, markers) {
  // Convention for every asset: bounds are ABSOLUTE canvas coordinates when drawn with default params, origin is the default anchor (x,y).
  let bounds = o.bounds || [0, 0, 1280, 720], origin = o.origin;
  const px = o.params && o.params.x && o.params.x.default, py = o.params && o.params.y && o.params.y.default;
  if ((!origin || (origin[0] === 0 && origin[1] === 0)) && typeof px === 'number' && typeof py === 'number') {
    origin = [px, py];
    if (bounds[1] < 0) bounds = [bounds[0] + px, bounds[1] + py, bounds[2], bounds[3]];   // authored relative to the anchor
  }
  o = { ...o, bounds, origin };
  const meta = defMeta({ id, title: o.title, description: o.description, tags: o.tags || [], params: o.params || {}, anchors: o.anchors || {}, markers: o.markerKinds || [], bounds: o.bounds || [0, 0, 1280, 720], origin: o.origin || [0, 0], kind: o.kind || 'part', mode: o.mode || 'story', duration: o.duration || 6, example: o.example || `assets['${id}'].draw(g,t,{})` });
  return { meta, draw: idled(id, draw, () => meta), markers: markers || (() => []) };
}
export const XY = { x: P('number', 640, 'ground-anchor x'), y: P('number', 560, 'ground-anchor y'), s: P('number', 1, 'scale') };
