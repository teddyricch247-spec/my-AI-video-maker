/**
 * kit.js - shared helpers for the technical half (tech/*, obj/*, fx/*). Imports core only.
 * defAsset(spec, draw, markers) builds one { meta, draw, markers } entry. spec.params = {name:[type,default,desc]}, spec.anchors = {name:[default,desc]}.
 *   draw(g,t,p,at,meta): p = params merged with defaults, at = anchors merged with params.at. markers(p,at) -> [{id,t,kind}].
 * Scene helpers: frame(g,p,variant) paper background + ground inks (skipped when p.bg===false); finish(g,p) grain; SCENE_PARAMS common params.
 * Widgets: card, pill, kicker, headline, fit (shrink-to-width text), cursor, typed, idle, arrowHead, checkMark, crossMark.
 * Constants/paths: SAFE (40 px safe margin); rr(x,y,w,h,r), circ(x,y,r), ptsPath(pts,close) return path builders g=>{...} for shape().
 * defAsset spec extras: oneShot:true (fx that legitimately vanish after their burst; exempt from blank/idle checks), previewT (seconds shown in catalogs).
 * Fx helper: defFx(id,title,desc,tags,fn,opts) registers a paper fx (kind 'fx').
 * Icon helpers: defObj(id,title,desc,tags,fn,opts) registers a 200x200 prop (centred on 0,0) with pop-in + idle bob and params {col}; blob(g,parts,fill) union of circles/rects with outline.
 * Object helpers: objDraw(g,t,at,fn,o) pop-in + idle bob; shape(g,pathFn,fill,o) flat paper shape with drop shadow and ink outline.
 * Usage:
 *   import { defAsset, card, frame, finish } from './kit.js';
 *   export const assets = { 'tech/x': defAsset({ id:'tech/x', title:'X', description:'...', params:{ label:['string','Hi','text'] } }, (g,t,p,at)=>{ frame(g,p); card(g,100,100,300,200); finish(g,p) }) };
 */
import { W, H, INK, PAPER, TOMATO, MUSTARD, GREEN, PINK, SHADOW, AQUA, LEAF, CREAM, SERIF, SANS, MONO } from '../core/palette.js';
import { cl, lerp, eo, eio, eb, A, rrect, txt, grainOver, shade } from '../core/core.js';
export const SAFE = 40;
export const SCENE_PARAMS = {
  bg: ['boolean', true, 'draw the paper background, ground inks and grain; false = transparent overlay (no background)'],
  deco: ['string', 'auto', "ground-ink decoration: 'auto' (this scene's own variant), 'a', 'b', 'c' or 'none'"]
};
const buildParams = o => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, { type: v[0], default: v[1], desc: v[2] }]));
export function defAsset(spec, draw, markers) {
  const kind = spec.kind || 'scene';
  const meta = {
    id: spec.id, kind, mode: spec.mode || (kind === 'scene' ? 'technical' : 'both'), title: spec.title, description: spec.description,
    duration: spec.duration ?? 6, holds: true,
    params: buildParams(kind === 'scene' && !spec.noCommon ? { ...SCENE_PARAMS, ...spec.params } : spec.params),
    anchors: Object.fromEntries(Object.entries(spec.anchors || {}).map(([k, v]) => [k, { default: v[0], desc: v[1] }])),
    markers: spec.markerKinds || [], tags: spec.tags || [],
    bounds: spec.bounds || [0, 0, W, H], origin: spec.origin || [0, 0],
    ...(spec.oneShot ? { oneShot: true } : {}), ...(spec.previewT != null ? { previewT: spec.previewT } : {}),
    example: spec.example || (kind === 'scene'
      ? `assets['${spec.id}'].draw(g, t, {})`
      : `g.save(); g.translate(640, 360); assets['${spec.id}'].draw(g, t, {}); g.restore();`)
  };
  if (spec.noDeco) delete meta.params.deco;
  const resolve = params => {
    const p = {}, at = {};
    for (const k in meta.params) p[k] = meta.params[k].default;
    for (const k in meta.anchors) at[k] = meta.anchors[k].default;
    if (params) for (const k in params) { if (k === 'at') Object.assign(at, params.at || {}); else if (params[k] !== undefined) p[k] = params[k] }
    return { p, at };
  };
  const fn = (g, t, params) => { const { p, at } = resolve(params); g.save(); try { draw(g, Math.max(0, t), p, at, meta) } finally { g.restore() } };
  const mk = params => { if (!markers) return []; const { p, at } = resolve(params); return markers(p, at).map(m => ({ id: m.id, t: Math.round(m.t * 1000) / 1000, kind: m.kind })).sort((a, b) => a.t - b.t) };
  return { meta, draw: fn, markers: mk };
}
// ---------- paper ground ----------
export function frame(g, p, variant) {
  if (p.bg === false) return;
  g.fillStyle = PAPER; g.fillRect(0, 0, W, H);
  const v = (p.deco && p.deco !== 'auto') ? p.deco : (variant || 'a'); if (v === 'none') return;
  g.save(); g.globalCompositeOperation = 'multiply';
  if (v === 'a') {
    g.strokeStyle = AQUA; g.lineWidth = 74; g.lineCap = 'round'; g.beginPath(); g.moveTo(-40, 668); g.bezierCurveTo(300, 618, 520, 726, 800, 668); g.bezierCurveTo(980, 630, 1120, 668, 1330, 614); g.stroke();
    g.fillStyle = LEAF; g.beginPath(); g.moveTo(1010, 40); g.bezierCurveTo(1090, 0, 1200, 20, 1250, 80); g.bezierCurveTo(1290, 140, 1220, 182, 1130, 172); g.bezierCurveTo(1040, 162, 960, 100, 1010, 40); g.fill();
    g.fillStyle = 'rgba(242,163,181,.55)'; rrect(g, 40, 560, 100, 60, 10); g.fill(); rrect(g, 1200, 400, 50, 100, 10); g.fill();
  } else if (v === 'b') {
    g.fillStyle = AQUA; g.beginPath(); g.moveTo(-10, 560); g.bezierCurveTo(200, 520, 330, 640, 520, 700); g.lineTo(-10, 740); g.fill();
    g.fillStyle = LEAF; g.beginPath(); g.ellipse(1160, 90, 150, 70, -.3, 0, 7); g.fill();
    g.fillStyle = 'rgba(242,163,181,.55)'; rrect(g, 24, 600, 90, 60, 10); g.fill(); rrect(g, 1130, 560, 90, 110, 10); g.fill();
  } else {
    g.fillStyle = 'rgba(242,181,49,.28)'; g.beginPath(); g.arc(1180, 640, 150, 0, 7); g.fill();
    g.fillStyle = AQUA; rrect(g, 780, 24, 120, 50, 10); g.fill(); g.fillStyle = 'rgba(242,163,181,.5)'; rrect(g, 1100, 40, 130, 54, 10); g.fill();
    g.fillStyle = LEAF; g.beginPath(); g.ellipse(80, 650, 130, 50, .2, 0, 7); g.fill();
  }
  g.restore();
}
export const finish = (g, p, a = .5) => { if (p.bg !== false) grainOver(g, a) };
// ---------- widgets ----------
export function card(g, x, y, w, h, o = {}) {
  const r = o.r ?? 14, sh = o.sh ?? 5; if (sh) { g.fillStyle = SHADOW; rrect(g, x + sh, y + sh, w, h, r); g.fill() }
  g.fillStyle = o.fill || CREAM; rrect(g, x, y, w, h, r); g.fill();
  if (o.lw !== 0) { g.strokeStyle = o.stroke || INK; g.lineWidth = o.lw ?? 4; g.lineJoin = 'round'; g.stroke() }
}
export function pill(g, cx, cy, w, h, fill, label, o = {}) {
  g.save(); g.translate(cx, cy); const k = o.k ?? 1; if (k <= 0) { g.restore(); return } g.scale(k, k);
  g.fillStyle = SHADOW; rrect(g, -w / 2 + 3, -h / 2 + 3, w, h, h / 2); g.fill();
  g.fillStyle = fill; rrect(g, -w / 2, -h / 2, w, h, h / 2); g.fill(); g.strokeStyle = INK; g.lineWidth = o.lw ?? 3.5; g.stroke();
  if (label) { txt(g, label, 0, (o.s || 15) * .36 + 1, { f: o.f || MONO, s: o.s || 15, w: 700, al: 'center', c: o.c || (fill === INK || fill === TOMATO || fill === GREEN ? CREAM : INK), rise: 0 }) }
  g.restore();
}
export function kicker(g, s, x, y, k, col = TOMATO) {
  g.save(); g.globalAlpha = k; g.fillStyle = col; g.fillRect(x, y - 14, 16, 16); g.restore();
  txt(g, s, x + 28, y, { f: MONO, s: 17, w: 700, ls: 4, k });
}
/** headline with riso misregistration plate (pink) */
export function headline(g, s, x, y, o = {}) {
  const k = o.k ?? 1; if (k <= 0) return;
  const f = { f: o.f || SERIF, s: o.s || 72, w: 700, st: o.st || '', al: o.al, k };
  txt(g, s, x + 4, y + 4, { ...f, c: o.plate || PINK, mul: 1 }); txt(g, s, x, y, { ...f, c: o.c });
}
/** text shrunk to fit maxW (never below minS) */
export function fit(g, s, x, y, maxW, o = {}) {
  let sz = o.s || 24; const mn = o.min || 14;
  g.save(); while (sz > mn) { g.font = `${o.st || ''} ${o.w || 700} ${sz}px ${o.f || SANS}`; if (g.measureText(s).width <= maxW) break; sz -= 1 } g.restore();
  txt(g, s, x, y, { ...o, s: sz }); return sz;
}
export const typed = (s, t, start, cps = 18) => s.slice(0, Math.max(0, Math.min(s.length, Math.floor((t - start) * cps))));
export const idle = (t, f = 1, a = 1, ph = 0) => Math.sin(t * f * 6.2832 + ph) * a;
/** mouse pointer, tip at (x,y) */
export function cursor(g, x, y, s = 1, press = 0) {
  g.save(); g.translate(x, y); g.scale(s * (1 - .08 * press), s * (1 - .08 * press));
  g.fillStyle = SHADOW; g.beginPath(); g.moveTo(4, 5); g.lineTo(4, 33); g.lineTo(12, 26); g.lineTo(18, 40); g.lineTo(24, 37); g.lineTo(18, 24); g.lineTo(28, 24); g.closePath(); g.fill();
  g.fillStyle = CREAM; g.strokeStyle = INK; g.lineWidth = 3; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(0, 0); g.lineTo(0, 28); g.lineTo(8, 21); g.lineTo(14, 35); g.lineTo(20, 32); g.lineTo(14, 19); g.lineTo(24, 19); g.closePath(); g.fill(); g.stroke(); g.restore();
}
export function arrowHead(g, x, y, ang, s = 12, col = INK) {
  g.save(); g.translate(x, y); g.rotate(ang); g.fillStyle = col; g.beginPath(); g.moveTo(s, 0); g.lineTo(-s * .6, -s * .75); g.lineTo(-s * .6, s * .75); g.closePath(); g.fill(); g.restore();
}
export function checkMark(g, x, y, s, col = GREEN, p = 1) {
  g.save(); g.translate(x, y); g.scale(s, s); g.strokeStyle = col; g.lineWidth = 5 / Math.max(.5, s); g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(-8, 0); g.lineTo(-2, 7); g.lineTo(p < 1 ? lerp(-2, 9, p) : 9, p < 1 ? lerp(7, -8, p) : -8); g.stroke(); g.restore();
}
export function crossMark(g, x, y, s, col = TOMATO) {
  g.save(); g.translate(x, y); g.scale(s, s); g.strokeStyle = col; g.lineWidth = 5 / Math.max(.5, s); g.lineCap = 'round';
  g.beginPath(); g.moveTo(-7, -7); g.lineTo(7, 7); g.moveTo(7, -7); g.lineTo(-7, 7); g.stroke(); g.restore();
}
// ---------- objects ----------
/** pop-in (anchor at.in) + idle bob; fn(g,k) draws in a 200x200 box centred on 0,0. o.shadow draws a ground ellipse */
export function objDraw(g, t, at, fn, o = {}) {
  const k = eb(A(t, at.in, .5)); if (k <= 0) return;
  const settle = eo(A(t, at.in + .5, .6));
  g.save(); g.translate(0, idle(t, .45, 3 * settle, o.ph || 0)); g.rotate(idle(t, .3, .018 * settle, 1 + (o.ph || 0)));
  if (o.shadow !== false) { g.fillStyle = 'rgba(70,35,25,.16)'; g.beginPath(); g.ellipse(0, 92, 56 * k, 8, 0, 0, 7); g.fill() }
  g.scale(k, k); fn(g, k); g.restore();
}
/** flat paper shape: pathFn(g) builds the path; drop shadow, fill, ink outline */
export function shape(g, pathFn, fill, o = {}) {
  const sh = o.sh ?? 5;
  if (sh) { g.save(); g.translate(sh, sh); pathFn(g); g.fillStyle = SHADOW; g.fill(); g.restore() }
  pathFn(g); if (fill) { g.fillStyle = fill; g.fill() }
  if (o.lw !== 0) { g.strokeStyle = o.stroke || INK; g.lineWidth = o.lw ?? 5; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke() }
}

/** union of parts [{c:[x,y,r]} | {r:[x,y,w,h,rad]}] drawn as one paper shape (shadow, ink outline, fill) */
export function blob(g, parts, fill, o = {}) {
  const lw = o.lw ?? 5, sh = o.sh ?? 5, path = (dx, dy, grow) => { g.beginPath(); parts.forEach(q => { if (q.c) { g.moveTo(q.c[0] + dx + q.c[2] + grow, q.c[1] + dy); g.arc(q.c[0] + dx, q.c[1] + dy, q.c[2] + grow, 0, 7) } else g.roundRect(q.r[0] + dx - grow, q.r[1] + dy - grow, q.r[2] + 2 * grow, q.r[3] + 2 * grow, q.r[4] + grow) }) };
  if (sh) { path(sh, sh, lw / 2); g.fillStyle = SHADOW; g.fill() }
  path(0, 0, lw / 2); g.fillStyle = INK; g.fill(); path(0, 0, -lw / 2); g.fillStyle = fill; g.fill();
}
/** register a 200x200 icon. fn(g,t,p,at,k): draw around 0,0 inside [-100,100]; p.col = accent colour param; opts: {col, params, anchors, mk (marker kinds), markers(p,at), ph, shadow} */
export function defObj(id, title, description, tags, fn, o = {}) {
  return defAsset({ id, kind: 'prop', mode: 'both', title, description, duration: o.duration || 3, tags, bounds: [-100, -100, 200, 200], origin: [0, 0],
    params: { col: ['color', o.col || TOMATO, 'accent colour (any palette colour)'], ...o.params }, anchors: { in: [0, 'icon pops in'], ...o.anchors }, markerKinds: o.mk || ['pop'] },
  (g, t, p, at) => objDraw(g, t, at, (g2, k) => fn(g2, t, p, at, k), { shadow: o.shadow, ph: o.ph || 0 }),
  (p, at) => [{ id: 'pop', t: at.in + .12, kind: 'pop' }, ...(o.markers ? o.markers(p, at) : [])]);
}
export const rr = (x, y, w, h, r) => g => { g.beginPath(); g.roundRect(x, y, w, h, r) };
export const circ = (x, y, r) => g => { g.beginPath(); g.arc(x, y, r, 0, 7) };
export const ptsPath = (pts, close = true) => g => { g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); if (close) g.closePath() };
export { W, H, INK, PAPER, TOMATO, MUSTARD, GREEN, PINK, SHADOW, AQUA, LEAF, CREAM, SERIF, SANS, MONO, cl, lerp, eo, eio, eb, A, rrect, txt, shade };

/** register a paper fx (kind 'fx'): fn(g,t,p,at) draws around the current origin; p.col accent; opts {col, params, anchors, mk, markers, bounds, oneShot, previewT, duration} */
export function defFx(id, title, description, tags, fn, o = {}) {
  return defAsset({ id, kind: 'fx', mode: 'both', title, description, duration: o.duration || 3, tags: ['fx', ...tags], bounds: o.bounds || [-150, -150, 300, 300], origin: [0, 0],
    params: { col: ['color', o.col || TOMATO, 'main colour (any palette colour)'], ...o.params }, anchors: { in: [0, 'effect starts'], ...o.anchors }, markerKinds: o.mk || ['pop'], oneShot: o.oneShot, previewT: o.previewT ?? 3 },
  (g, t, p, at) => fn(g, t, p, at), (p, at) => o.markers ? o.markers(p, at) : [{ id: 'pop', t: at.in + .12, kind: 'pop' }]);
}
