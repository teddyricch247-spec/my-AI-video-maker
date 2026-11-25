/**
 * people/faces.js — simple paper-cut faces: dot eyes, blush, simple smile, plus eyebrows.
 *
 * Expressions: neutral smile big_smile surprise worried focused tired proud.
 * resolveFace(o,t): o.face (name | param object) + o.faces=[{at,name,dur}] timeline (crossfades, default .25 s) -> numeric params.
 *   Also applies: blink (deterministic, ~every 3 s), talking mouth (o.talk={from,to}), eye look (o.look=[dx,dy] in -1..1 or scene target via rig).
 * drawFace(g, view, fp, o): draws the face at the origin of the current transform (head centre, radius 21.5);
 *   view 'side' (facing +x) or 'front'. fp from resolveFace. o = {skin, seed}.
 * blinkOpen(t,seed) -> 0..1 ; talkOpen(t,talk,seed) -> 0..1.
 * Registered asset: 'people/face' — one big head showing an expression (optionally morphing + talking).
 *
 *   const fp = resolveFace({face:'smile',talk:{from:1,to:3}}, t); g.save(); g.translate(x,y); drawFace(g,'front',fp,{skin}); g.restore();
 *   assets['people/face'].draw(g,t,{expr:'worried',to:'big_smile',at:{morph:1.5}});
 */
import { cl, lerp, shade, eio } from '../core/core.js';
import { INK } from '../core/palette.js';
import { defMeta, P, ANC, withDefaults } from '../environment/_meta.js';

export const EXPR = {
  neutral: { eye: 1, eyeS: 1, happy: 0, curve: .42, mw: 4.4, open: 0, bro: 0, bl: 0, br: 0, tl: 0, tr: 0, blush: .5, tilt: 0, o: 0 },
  smile: { eye: 1, eyeS: 1, happy: 0, curve: .85, mw: 5.4, open: 0, bro: .55, bl: -.5, br: -.5, tl: 0, tr: 0, blush: .6, tilt: 0, o: 0 },
  big_smile: { eye: 1, eyeS: 1, happy: .85, curve: 1, mw: 7.2, open: .75, bro: .7, bl: -1.2, br: -1.2, tl: 0, tr: 0, blush: .75, tilt: .02, o: 0 },
  surprise: { eye: 1, eyeS: 1.35, happy: 0, curve: 0, mw: 3.4, open: .9, bro: 1, bl: -3.2, br: -3.2, tl: 0, tr: 0, blush: .35, tilt: 0, o: 1 },
  worried: { eye: 1, eyeS: 1.05, happy: 0, curve: -.55, mw: 4.6, open: 0, bro: 1, bl: -1.2, br: -1.2, tl: .42, tr: -.42, blush: .25, tilt: .03, o: 0 },
  focused: { eye: .85, eyeS: 1, happy: 0, curve: .1, mw: 4, open: 0, bro: .9, bl: .4, br: .4, tl: -.1, tr: .1, blush: .35, tilt: 0, o: 0 },
  tired: { eye: .42, eyeS: 1, happy: 0, curve: -.1, mw: 4.2, open: 0, bro: .8, bl: 1.6, br: 1.6, tl: .15, tr: -.15, blush: .2, tilt: .05, o: 0 },
  proud: { eye: .7, eyeS: 1, happy: .55, curve: .9, mw: 5.8, open: 0, bro: .8, bl: -1.6, br: -1.6, tl: -.12, tr: .12, blush: .7, tilt: -.05, o: 0 },
};
const KEYS = Object.keys(EXPR.neutral);
function exprOf(e) { return typeof e === 'string' ? (EXPR[e] || EXPR.neutral) : { ...EXPR.neutral, ...e } }
function mixF(a, b, k) { const o = {}; KEYS.forEach(q => o[q] = lerp(a[q], b[q], k)); return o }

/** blink amount multiplier 0..1 (1 = fully open). Deterministic: depends on t and seed only. */
export function blinkOpen(t, seed = 0) {
  const per = 3 + (seed % 5) * .37, ph = ((t + seed * .83) % per + per) % per, d = .16;
  if (ph < per - d) return 1; const u = (ph - (per - d)) / d; return 1 - Math.sin(u * Math.PI);
}
/** talking mouth openness 0..1 for talk={from,to}; syllable-like deterministic pattern */
export function talkOpen(t, talk, seed = 0) {
  if (!talk || t < talk.from || t > talk.to) return 0;
  const env = Math.min(cl((t - talk.from) / .12), cl((talk.to - t) / .18));
  const a = Math.abs(Math.sin(t * 11.3 + seed)), b = Math.abs(Math.sin(t * 6.1 + 1.3 + seed * .7)), gate = Math.sin(t * 2.3 + seed * 1.9) > -.55 ? 1 : .12;
  return env * gate * (.25 + .75 * (a * .6 + b * .4));
}
/** resolve numeric face parameters at time t from the person spec */
export function resolveFace(o, t) {
  let f = exprOf(o.face || 'neutral');
  if (o.faces && o.faces.length) {
    const L = [...o.faces].sort((a, b) => a.at - b.at); let prev = f;
    for (const e of L) {
      const to = exprOf(e.name || e.face), d = e.dur ?? .25;
      if (t >= e.at) { const k = eio((t - e.at) / d); if (k >= 1) prev = to; else { f = mixF(prev, to, k); prev = null; break } } else break;
    }
    if (prev) f = prev;
  }
  const seed = o.seed || 0, bk = o.blink === false ? 1 : blinkOpen(t, seed), talk = talkOpen(t, o.talk, seed);
  const r = { ...f };
  r.eye = f.eye * bk; r.talk = talk; r.open = Math.max(f.open, talk * .95); if (talk > .05) { r.curve = lerp(f.curve, .55, .6); r.mw = lerp(f.mw, 5.4, .5) }
  const lk = o.lookv || o.look || [0, 0]; r.lx = lk[0] || 0; r.ly = lk[1] || 0;
  return r;
}
/** draw the face at the current origin (head centre). view: 'side' (facing +x) | 'front' */
export function drawFace(g, view, f, o = {}) {
  const skin = o.skin || '#C58C5F', side = view === 'side';
  const ex = side ? [8, 17] : [-8.4, 8.4], ey = -1, bx = side ? [14] : [-14.5, 14.5], mx = side ? 12.5 : 0, my = 8.5;
  g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
  if (side) { g.fillStyle = shade(skin, -.14); g.beginPath(); g.arc(-12, 1, 5, 0, 7); g.fill() }          // ear
  else { g.fillStyle = shade(skin, -.14);[-1, 1].forEach(s => { g.beginPath(); g.arc(s * 21.4, 1.5, 4.3, 0, 7); g.fill() }) }
  // blush
  g.fillStyle = `rgba(242,100,120,${.5 * f.blush / .5 * .5})`; bx.forEach(x => { g.beginPath(); g.arc(x, 7, 4.5, 0, 7); g.fill() });
  // eyes
  ex.forEach((x, i) => {
    const px = x + f.lx * 1.8, py = ey + f.ly * 1.3, r = 2.7 * f.eyeS;
    if (f.happy > .5) { g.strokeStyle = INK; g.lineWidth = 2.2; g.beginPath(); g.arc(px, py + 1.6, 3.1, Math.PI + .35, 2 * Math.PI - .35); g.stroke() }
    else if (f.eye < .18) { g.strokeStyle = INK; g.lineWidth = 2.1; g.beginPath(); g.moveTo(px - 2.9, py + .6); g.lineTo(px + 2.9, py + .6); g.stroke() }
    else { g.fillStyle = INK; g.beginPath(); g.ellipse(px, py, r * (1 + (1 - f.eye) * .15), r * Math.max(.18, f.eye), 0, 0, 7); g.fill() }
  });
  // brows
  if (f.bro > .03) {
    g.strokeStyle = INK; g.globalAlpha *= cl(f.bro); g.lineWidth = 1.9;
    ex.forEach((x, i) => {
      const dirSign = side ? 1 : (i === 0 ? -1 : 1), tl = side ? (i === 0 ? f.tl : f.tr) : (i === 0 ? f.tl : f.tr), by = ey - 6.6 + (i === 0 ? f.bl : f.br) * .9 + f.ly * 1.0;
      g.save(); g.translate(x + f.lx * 1.8, by); g.rotate(tl * (side ? 1 : 1)); g.beginPath(); g.moveTo(-3.3, 0); g.lineTo(3.3, 0); g.stroke(); g.restore();
    });
    g.globalAlpha /= cl(f.bro);
  }
  // mouth
  const half = f.mw / 2, mxx = mx + f.lx * .8, p0y = my + .4, d = f.curve * 3.6;
  if (f.o > .5) { g.fillStyle = INK; g.beginPath(); g.ellipse(mxx, my + 1.5, 2.4 * (1 + f.open * .2), 3.1 * f.open + .6, 0, 0, 7); g.fill() }
  else if (f.open > .12) {
    const dep = f.open * 5.6; g.fillStyle = INK; g.beginPath(); g.moveTo(mxx - half, p0y); g.quadraticCurveTo(mxx, p0y + 2 * d * .55 - 1, mxx + half, p0y);
    g.quadraticCurveTo(mxx, p0y + dep * 1.75 + d * .6, mxx - half, p0y); g.closePath(); g.fill();
    g.fillStyle = '#E8452C'; g.globalAlpha *= .85; g.beginPath(); g.ellipse(mxx, p0y + dep * .78 + 1, half * .45, Math.max(.4, dep * .24), 0, 0, 7); g.fill(); g.globalAlpha /= .85;
  } else { g.strokeStyle = INK; g.lineWidth = 2.2; g.beginPath(); g.moveTo(mxx - half, p0y); g.quadraticCurveTo(mxx, p0y + 2 * d, mxx + half, p0y); g.stroke() }
  g.restore();
}

const DEF = { expr: 'smile', to: null, x: 640, y: 380, s: 7, skin: '#C58C5F', view: 'front', talk: null, seed: 0, at: { morph: 1, dur: .4 } };
function draw(g, t, params) {
  const p = withDefaults(params, DEF);
  const o = { face: p.expr, faces: p.to ? [{ at: p.at.morph, name: p.to, dur: p.at.dur }] : null, talk: p.talk, seed: p.seed };
  const f = resolveFace(o, t);
  g.save(); g.translate(p.x, p.y); g.scale(p.s, p.s);
  g.fillStyle = '#241713'; g.beginPath(); g.arc(0, -3, 24, 0, 7); g.fill();
  g.fillStyle = p.skin; g.beginPath(); g.arc(0, 0, 21.5, 0, 7); g.fill();
  drawFace(g, p.view, f, { skin: p.skin }); g.restore();
}
const meta = defMeta({
  id: 'people/face', kind: 'part', mode: 'both', title: 'Face expression', duration: 4,
  description: 'One big cartoon head showing a facial expression with blinking, optional morph to a second expression and talking mouth. Use for reaction close-ups: surprise, worry, focus, pride, big smile.',
  params: { expr: P('string', 'smile', 'neutral smile big_smile surprise worried focused tired proud'), to: P('string', null, 'morph target'), talk: P('object', null, '{from,to} seconds of mouth movement'), view: P('string', 'front', "'front' | 'side'"), x: P('number', 640, 'centre x'), y: P('number', 380, 'centre y'), s: P('number', 7, 'scale'), skin: P('color', '#C58C5F', 'skin') },
  anchors: { morph: ANC(1, 'seconds when morph starts'), dur: ANC(.4, 'morph duration') }, markers: [], tags: ['face', 'emotion', 'reaction', 'closeup', 'expression'],
  bounds: [440, 200, 400, 360], origin: [640, 380], example: "assets['people/face'].draw(g,t,{expr:'worried',to:'big_smile',at:{morph:1.5}})"
});
export const assets = { 'people/face': { meta, draw, markers: () => [] } };
