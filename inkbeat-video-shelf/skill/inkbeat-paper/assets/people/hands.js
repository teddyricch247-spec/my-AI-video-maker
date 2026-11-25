/**
 * people/hands.js — articulated paper-cut hands.
 *
 * drawHand(g, pose, opts)
 *   pose: preset name | {c:[thumb,index,middle,ring,pinky] curl 0..1, spread 0..1, tOut 0..1 thumb abduction}
 *         | {a:pose, b:pose, k:0..1} (blend; nest freely)
 *   opts: x,y (wrist position), ang (radians, direction the fingers point), s (scale, 1 => hand ~22px long), skin (hex),
 *         flip (true mirrors across the finger axis; used for left hands), sleeve (optional cuff colour)
 *   Presets: relaxed open flat_up flat_out(stop) point fist thumbs_up ok peace grip pinch count_1..count_5
 *   Local frame: wrist at origin, fingers along +x, palm side is +y, thumb on -y.
 * mixPose(a,b,k) -> blended pose object.  resolvePose(p) -> {c,spread,tOut}.
 * Registered asset: 'people/hand' — big hand showing a pose and optionally morphing to a second pose.
 *
 *   drawHand(g,'point',{x:300,y:300,ang:-0.6,s:1.2,skin:'#C58C5F'});
 *   drawHand(g,mixPose('open','fist',eio(u)),{x,y,ang:0});
 *   assets['people/hand'].draw(g,t,{pose:'open',to:'fist',at:{morph:1},s:6,x:640,y:360});
 */
import { cl, lerp, shade, eio } from '../core/core.js';
import { SHADOW } from '../core/palette.js';
import { defMeta, P, ANC, withDefaults, idled } from '../environment/_meta.js';

export const HAND_POSES = {
  relaxed: { c: [.30, .38, .45, .52, .58], spread: .15, tOut: .15 },
  open: { c: [0, 0, 0, 0, 0], spread: 1, tOut: .75 },
  flat_up: { c: [0, 0, 0, 0, 0], spread: .1, tOut: .25 },
  flat_out: { c: [0, 0, 0, 0, 0], spread: .35, tOut: .5 },
  point: { c: [.55, 0, 1, 1, 1], spread: .15, tOut: .2 },
  fist: { c: [.85, 1, 1, 1, 1], spread: 0, tOut: 0 },
  thumbs_up: { c: [0, 1, 1, 1, 1], spread: 0, tOut: .95 },
  ok: { c: [.4, -.65, 0, 0, 0], spread: .8, tOut: .75 },
  peace: { c: [.85, 0, 0, 1, 1], spread: 1, tOut: .1 },
  grip: { c: [.55, .62, .68, .72, .78], spread: .1, tOut: .3 },
  pinch: { c: [.7, -.45, .75, .85, .9], spread: .3, tOut: .8 },
  count_1: { c: [.85, 0, 1, 1, 1], spread: .15, tOut: 0 },
  count_2: { c: [.85, 0, 0, 1, 1], spread: 1, tOut: 0 },
  count_3: { c: [.85, 0, 0, 0, 1], spread: .8, tOut: 0 },
  count_4: { c: [.85, 0, 0, 0, 0], spread: .7, tOut: 0 },
  count_5: { c: [0, 0, 0, 0, 0], spread: 1, tOut: .8 },
};
export function resolvePose(p) {
  if (!p) return HAND_POSES.relaxed;
  if (typeof p === 'string') return HAND_POSES[p] || HAND_POSES.relaxed;
  if (p.a !== undefined) return mixPose(p.a, p.b, p.k);
  return p;
}
export function mixPose(a, b, k) {
  const A = resolvePose(a), B = resolvePose(b); k = cl(k);
  return { c: A.c.map((v, i) => lerp(v, B.c[i], k)), spread: lerp(A.spread, B.spread, k), tOut: lerp(A.tOut, B.tOut, k) };
}
const FY = [-5.1, -1.7, 1.7, 5.1], FL = [9.4, 10.4, 9.6, 7.6];

export function drawHand(g, pose, o = {}) {
  const P_ = resolvePose(pose), s = o.s ?? 1, skin = o.skin || '#C58C5F', dk = shade(skin, -.24);
  g.save(); g.translate(o.x || 0, o.y || 0); g.rotate(o.ang || 0); g.scale(s, o.flip ? -s : s);
  g.lineCap = 'round'; g.lineJoin = 'round';
  // thumb behind palm when tucked, in front when out
  const tOut = P_.tOut, thA = -.28 - tOut * 1.05, c0 = P_.c[0];
  const thumb = (col, w) => {
    const bx = 3.4, by = -4.6, a1 = thA + c0 * .85, a2 = a1 + c0 * 1.05 - tOut * .12;
    const x1 = bx + Math.cos(a1) * 6.2, y1 = by + Math.sin(a1) * 6.2, x2 = x1 + Math.cos(a2) * 5, y2 = y1 + Math.sin(a2) * 5;
    g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(bx, by); g.lineTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  };
  const finger = (i, col, w) => {
    const c = P_.c[i + 1], fan = (i - 1.5) * P_.spread * .17;
    const l1 = FL[i] * .58, l2 = FL[i] * .42, a1 = fan + c * 1.28, a2 = a1 + c * 1.5;
    const bx = 10.2, by = FY[i], x1 = bx + Math.cos(a1) * l1, y1 = by + Math.sin(a1) * l1, x2 = x1 + Math.cos(a2) * l2, y2 = y1 + Math.sin(a2) * l2;
    g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(bx, by); g.lineTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  };
  if (o.sleeve) { g.fillStyle = o.sleeve; g.beginPath(); g.roundRect(-5, -6.4, 6, 12.8, 3); g.fill() }
  if (tOut < .55) { thumb(dk, 5); thumb(skin, 3.9) }
  // fingers: pinky side first so the index overlaps; a darker under-stroke separates them. Curled fingers go on top of the palm.
  const order = [3, 2, 1, 0], curled = i => Math.abs(P_.c[i + 1]) > .3;
  order.filter(i => !curled(i)).forEach(i => finger(i, dk, 4.3)); order.filter(i => !curled(i)).forEach(i => finger(i, skin, 3.1));
  g.fillStyle = skin; g.beginPath(); g.roundRect(-2, -5.8, 13.2, 11.6, 4.4); g.fill();
  order.filter(curled).forEach(i => finger(i, dk, 4.3)); order.filter(curled).forEach(i => finger(i, skin, 3.1));
  if (tOut >= .55) { thumb(dk, 5); thumb(skin, 3.9) }
  g.restore();
}

const DEF = { pose: 'open', to: null, x: 640, y: 360, ang: -Math.PI / 2, s: 6, skin: '#C58C5F', flip: false, at: { morph: 1, dur: .6 } };
function draw(g, t, params) {
  const p = withDefaults(params, DEF);
  const k = p.to ? eio((t - p.at.morph) / (p.at.dur || .6)) : 0;
  drawHand(g, p.to ? mixPose(p.pose, p.to, k) : p.pose, { x: p.x, y: p.y, ang: p.ang, s: p.s, skin: p.skin, flip: p.flip });
}
const meta = defMeta({
  id: 'people/hand', kind: 'part', mode: 'both', title: 'Hand pose', duration: 3,
  description: 'A single large articulated hand showing one preset pose, optionally morphing to a second pose. Use to zoom in on a gesture: pointing, thumbs-up, OK, counting 1-5, fist.',
  params: { pose: P('string', 'open', 'preset: relaxed open flat_up flat_out point fist thumbs_up ok peace grip pinch count_1..count_5'), to: P('string', null, 'optional second pose to morph to'), x: P('number', 640, 'wrist x'), y: P('number', 360, 'wrist y'), ang: P('number', -1.57, 'finger direction in radians'), s: P('number', 6, 'scale (1 = ~22px hand)'), skin: P('color', '#C58C5F', 'skin colour'), flip: P('bool', false, 'mirror (left hand)') },
  anchors: { morph: ANC(1, 'seconds when morph starts'), dur: ANC(.6, 'morph duration') }, markers: [], tags: ['hand', 'gesture', 'pose', 'closeup', 'counting'],
  bounds: [440, 100, 400, 500], origin: [640, 360], example: "assets['people/hand'].draw(g,t,{pose:'point',to:'thumbs_up',at:{morph:1}})"
});
export const assets = { 'people/hand': { meta, draw: idled('people/hand', draw, () => meta), markers: () => [] } };
