/**
 * people/gestures.js — the gesture library (timeline entries layered on top of locomotion).
 *
 * A person spec carries  gestures: [{name, at, dur, hand:'R'|'L'|'both', target?, n?, gap?, path?, ...}]
 *   at = start (s), dur = total length incl. .25 s ease-in and ease-out (hold in between, then returns to rest / walk arms).
 *   hand: 'R' = the arm nearer the camera (side view) / on the RIGHT of the screen (front view); 'L' = the other one. Default 'R' (two-hand gestures ignore it).
 *   target: [x,y] in SCENE coordinates (point_at, present, hand_over, high_five, nod/look_at); n: 1-5 (count_fingers); gap: px between hands (measure, pinch_zoom);
 *   path: [[x,y],...] scene points (draw_in_air).
 * P0 names: wave wave_goodbye point_at point_up present shrug count_fingers thumbs_up ok stop clap think_chin scratch_head facepalm hold_phone
 *           type_on_laptop write_with_pen hold_paper hand_over carry_box cross_arms hands_on_hips fist_pump beckon rub_hands spread_hands measure draw_in_air
 * P1 names: pinch_zoom high_five push pull lift   head only: nod shake_head look_at tilt_head
 * GESTURE_NAMES lists them all; gestureMarkers(spec) returns sound hit moments for a spec's gestures; envelope(t,at,dur) is the 0..1 weight.
 *
 *   gestures:[{name:'wave',at:1,dur:2.4},{name:'point_at',at:4,dur:2,target:[900,300]},{name:'count_fingers',at:7,dur:3,n:3,hand:'L'}]
 */
import { cl, lerp, eio, eo } from '../core/core.js';

export const envelope = (t, at, dur) => { const e = Math.min(.25, dur / 2.2); return eio(cl(Math.min((t - at) / e, (at + dur - t) / e))) };
const sgnOf = H => H === 'R' ? 1 : -1;

/** context helpers handed to every gesture function (built by the rig) :
 *  c = { H, tt, dur, u, n, gap, target, path, side(bool), pt(f,l,u,H), A(angle,H), pv(ob,d,H), toBody([x,y]), S:{R:{x,y},L:{x,y},cx}, G: gesture spec } */
const hold = (c, ph = 0, fr = 1) => Math.sin((c.tt + ph) * fr);

export const GESTURES = {
  wave(c) {
    const s = Math.sin(c.tt * 9) * .38, up = Math.min(1, c.tt / .35);
    return { [c.H]: { abs: c.pt(20, 40 + Math.sin(c.tt * 9) * 3, 36 * up + 2), pose: 'open', wrAbs: c.A(-Math.PI / 2 + s), pv: c.pv(.8, 1) }, face: 'smile' };
  },
  wave_goodbye(c) {
    const s = Math.sin(c.tt * 5.2) * .6;
    return { [c.H]: { abs: c.pt(18, 46 + Math.sin(c.tt * 5.2) * 6, 40), pose: 'open', wrAbs: c.A(-Math.PI / 2 + s), pv: c.pv(.8, 1) }, face: 'smile' };
  },
  point_at(c) {
    const S = c.S[c.H]; let d = c.target ? c.toBody(c.target) : c.pt(60, 52, 6, c.H);
    let vx = d[0] - S.x, vy = d[1] - S.y, L = Math.hypot(vx, vy) || 1; vx /= L; vy /= L;
    const r = Math.min(54, Math.max(30, L - 6)), a = Math.atan2(vy, vx);
    return { [c.H]: { abs: [S.x + vx * r, S.y + vy * r], pose: 'point', wrAbs: c.A0(a, c.H), pv: c.pv(.3, 1) }, look: c.target || null, face: 'focused' };
  },
  point_up(c) {
    const b = Math.sin(c.tt * 7) * 1.6 * Math.min(1, c.tt / .4);
    return { [c.H]: { abs: c.pt(12, 24, 58 + b), pose: 'point', wrAbs: c.A(-Math.PI / 2), pv: c.pv(.8, 1) }, face: 'surprise' };
  },
  present(c) {
    const S = c.S[c.H], sw = eio(cl(c.tt / Math.max(.4, c.dur * .45)));
    let end = c.target ? c.toBody(c.target) : c.pt(50, 44, -4, c.H), start = c.pt(18, 20, -22, c.H);
    let vx = end[0] - S.x, vy = end[1] - S.y, L = Math.hypot(vx, vy) || 1, r = Math.min(50, L - 4);
    const tgt = c.target ? [S.x + vx / L * r, S.y + vy / L * r] : end;
    const ang = c.A0(Math.atan2(tgt[1] - S.y, tgt[0] - S.x) - .1, c.H);
    return { [c.H]: { abs: [lerp(start[0], tgt[0], sw), lerp(start[1], tgt[1], sw)], pose: 'flat_up', wrAbs: ang, pv: c.pv(.4, 1) }, look: c.target || null, face: 'smile' };
  },
  shrug(c) {
    const o = {}; ['R', 'L'].forEach(H => o[H] = { abs: c.pt(16, 40, -16, H), pose: 'flat_out', wrAbs: c.A0(-1.1, H), pv: c.pv(1, .3, H) });
    return { ...o, body: { shrug: 1 }, head: { rot: .07 * Math.sin(c.tt * 3), dy: 1 }, face: 'worried' };
  },
  count_fingers(c) {
    const n = cl(Math.round(c.n || 3), 1, 5), step = (c.dur - .6) / n, k = cl(c.tt - .3, 0, 1e9) / step, i = Math.min(n, Math.floor(k) + 1), f = eio(cl((k - Math.floor(k)) * 3));
    const prev = Math.max(0, Math.min(n, i) - 1), pose = i > n ? 'count_' + n : { a: prev ? 'count_' + prev : 'fist', b: 'count_' + i, k: k >= n ? 1 : f };
    return { [c.H]: { abs: c.pt(18, 34, 30 + Math.sin(c.tt * 2) * 1.2), pose, wrAbs: c.A(-Math.PI / 2 + .12), pv: c.pv(.8, 1) } };
  },
  thumbs_up(c) {
    const b = eo(cl(c.tt / .4)); return { [c.H]: { abs: c.pt(22, 32, 22 + (1 - b) * -6), pose: 'thumbs_up', wrAbs: c.A(-.15), pv: c.pv(.6, 1) }, face: 'big_smile' };
  },
  ok(c) { return { [c.H]: { abs: c.pt(22, 34, 26), pose: 'ok', wrAbs: c.A(-Math.PI / 2 + .25), pv: c.pv(.8, 1) }, face: 'smile' } },
  stop(c) {
    const p = eo(cl(c.tt / .3)); return { [c.H]: { abs: c.pt(26 + p * 4, 24, 30), pose: 'flat_out', wrAbs: c.A(-Math.PI / 2 + .05), pv: c.pv(.5, 1) }, face: 'focused' };
  },
  clap(c) {
    const f = 3.2, ph = .5 + .5 * Math.cos(c.tt * f * 6.2832), gap = 2.5 + 15 * ph, o = {};
    ['R', 'L'].forEach(H => o[H] = { abs: c.pt(30, gap, -13 + ph * 2, H), pose: 'flat_up', wrAbs: c.A0(-Math.PI / 2 + .35, H), pv: c.pv(.7, 1, H) });
    return { ...o, face: 'big_smile' };
  },
  think_chin(c) {
    return { R: { abs: c.pt(16, 7, 16), pose: 'relaxed', wrAbs: c.A(-1.9), pv: c.pv(.7, 1) }, L: { abs: c.pt(18, -6, -14, 'L'), pose: 'relaxed', wrAbs: c.A0(-.3, 'L'), pv: c.pv(.2, 1, 'L') }, head: { rot: .09, dy: 0 }, face: 'focused', look: null };
  },
  scratch_head(c) {
    const s = Math.sin(c.tt * 11) * 2.4; return { [c.H]: { abs: c.pt(-2 + s, 18, 58), pose: 'relaxed', wrAbs: c.A(-Math.PI / 2 - .3 + s * .05), pv: c.pv(.9, .5) }, head: { rot: .1 }, face: 'worried' };
  },
  facepalm(c) {
    const p = eo(cl(c.tt / .3)); return { [c.H]: { abs: c.pt(21, 2, 33 - (1 - p) * 8), pose: 'open', wrAbs: c.A(-Math.PI / 2 + .1), pv: c.pv(.9, 1) }, head: { rot: .14, dy: 2 }, face: 'tired' };
  },
  hold_phone(c) {
    const tapPh = ((c.tt - .5) % .95 + .95) % .95 / .95, tap = c.tt > .5 && tapPh < .35 ? tapPh / .35 : 0;
    return { [c.H]: { abs: c.pt(26, 18, 8 + Math.sin(c.tt * 1.7) * .8), pose: 'grip', wrAbs: c.A(-Math.PI / 2 + .1), pv: c.pv(.6, 1), prop: { kind: 'phone', scroll: Math.max(0, c.tt - .3) * 26, tap } }, head: { rot: .1, dy: 1 }, lookv: [.2, .8], face: 'focused' };
  },
  type_on_laptop(c) {
    const o = {}; ['R', 'L'].forEach((H, i) => o[H] = { abs: c.pt(32, 11, -28 + Math.max(0, Math.sin(c.tt * 15 + i * 2.4)) * 2.8, H), pose: 'relaxed', wrAbs: c.A0(-Math.PI / 2 + (i ? -.15 : .15), H), pv: c.pv(.9, 1, H) });
    return { ...o, mid: { kind: 'laptop', open: 1, dy: 10 }, head: { rot: .05, dy: 1 }, lookv: [.5, .6], face: 'focused' };
  },
  write_with_pen(c) {
    const z = Math.sin(c.tt * 9) * 2.2, z2 = Math.sin(c.tt * 2.3) * 3;
    return { R: { abs: c.pt(30 + z2, 8 + z * .6, -20 + Math.abs(z) * .4), pose: 'pinch', wrAbs: c.A(.7), pv: c.pv(.5, 1), prop: { kind: 'pen' } },
      L: { abs: c.pt(26, 14, -16, 'L'), pose: 'grip', wrAbs: c.A0(-Math.PI / 2 + .3, 'L'), pv: c.pv(.3, 1, 'L'), prop: { kind: 'clipboard', col: '#B07A4A' } }, head: { rot: .08, dy: 1 }, lookv: [.3, .8], face: 'focused' };
  },
  hold_paper(c) {
    const o = {}; ['R', 'L'].forEach(H => o[H] = { abs: c.pt(26, 15, -22, H), pose: 'pinch', wrAbs: c.A0(-Math.PI / 2 + .1, H), pv: c.pv(.8, 1, H) });
    return { ...o, mid: { kind: 'paper' }, head: { rot: .04, dy: 1 }, lookv: [.4, .1], face: 'focused' };
  },
  hand_over(c) {
    const S = c.S[c.H]; const end = c.target ? c.toBody(c.target) : c.pt(52, 40, -8, c.H); let vx = end[0] - S.x, vy = end[1] - S.y, L = Math.hypot(vx, vy) || 1, r = Math.min(54, L);
    const tgt = [S.x + vx / L * r, S.y + vy / L * r], held = c.G.give || null;
    return { [c.H]: { abs: tgt, pose: 'flat_up', wrAbs: c.A0(Math.atan2(vy, vx), c.H), pv: c.pv(.3, 1), prop: held && c.u < .55 ? { kind: held, col: c.G.col } : null }, look: c.target || null, face: 'smile' };
  },
  carry_box(c) {
    const o = {}; ['R', 'L'].forEach(H => o[H] = { abs: c.pt(26, 15, -24 + Math.sin(c.tt * 2) * .3, H), pose: 'flat_up', wrAbs: c.A0(.1, H), pv: c.pv(.6, 1, H) });
    return { ...o, mid: { kind: 'box', dy: -14, col: c.G.col }, body: { lean: -.05 }, lookv: [.5, 0] };
  },
  cross_arms(c) {
    return { R: { abs: c.pt(12, -16, -14, 'R'), pose: 'relaxed', wrAbs: c.A0(-.35, 'R'), pv: c.pv(.4, 1) }, L: { abs: c.pt(14, -14, -18, 'L'), pose: 'relaxed', wrAbs: c.A0(-.2, 'L'), pv: c.pv(.4, 1, 'L') }, face: 'focused' };
  },
  hands_on_hips(c) {
    const o = {}; ['R', 'L'].forEach(H => o[H] = { abs: c.pt(-3, 23, -51, H), pose: 'relaxed', wrAbs: c.A0(1.9, H), pv: c.pv(1, .2, H) });
    return { ...o, face: 'proud', head: { rot: -.04 } };
  },
  fist_pump(c) {
    const p = Math.max(0, Math.sin(c.tt * 10)) * 9 * Math.min(1, c.tt / .3); return { [c.H]: { abs: c.pt(20, 30, 38 + p), pose: 'fist', wrAbs: c.A(-.5), pv: c.pv(.8, 1) }, face: 'big_smile', head: { rot: -.05, dy: -1 } };
  },
  beckon(c) {
    const k = .5 + .5 * Math.sin(c.tt * 12); return { [c.H]: { abs: c.pt(36, 30, 6), pose: { a: 'flat_up', b: 'relaxed', k }, wrAbs: c.A(-.25 + k * .2), pv: c.pv(.6, 1) }, face: 'smile' };
  },
  rub_hands(c) {
    const s = Math.sin(c.tt * 9) * 5, o = {}; ['R', 'L'].forEach((H, i) => o[H] = { abs: c.pt(28 + (i ? -s : s), 4, -14, H), pose: 'flat_up', wrAbs: c.A0(-.1, H), pv: c.pv(.5, 1, H) });
    return { ...o, face: 'smile' };
  },
  spread_hands(c) {
    const o = {}; ['R', 'L'].forEach(H => o[H] = { abs: c.pt(30, 64, 14, H), pose: 'open', wrAbs: c.A0(-.55, H), pv: c.pv(.2, 1, H) });
    return { ...o, face: 'big_smile', head: { rot: -.04, dy: -1 } };
  },
  measure(c) {
    const g = c.gap ?? 90, g0 = c.G.gap0 ?? 20, k = eio(cl(c.tt / .7)), gp = lerp(g0, g, k), o = {};
    ['R', 'L'].forEach(H => { const s = sgnOf(H); o[H] = { abs: c.side ? c.pt(26 + s * gp / 2, 0, 4, H) : c.pt(0, gp / 2, 4, H), pose: 'flat_out', wrAbs: c.A0(-Math.PI / 2, H), pv: c.pv(.6, 1, H) } });
    return { ...o, face: 'focused' };
  },
  draw_in_air(c) {
    const pts = c.path && c.path.length > 1 ? c.path : null; if (!pts) return { [c.H]: { abs: c.pt(40, 40, 20), pose: 'point', wrAbs: c.A(-.4) } };
    const T = [0]; for (let i = 1; i < pts.length; i++)T.push(T[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const p = eio(cl((c.tt - .25) / Math.max(.3, c.dur * .6))) * T[T.length - 1]; let q = pts[0], cut = [pts[0]];
    for (let i = 1; i < pts.length; i++) { if (p >= T[i]) { cut.push(pts[i]); q = pts[i] } else { const f = (p - T[i - 1]) / (T[i] - T[i - 1] || 1); q = [lerp(pts[i - 1][0], pts[i][0], f), lerp(pts[i - 1][1], pts[i][1], f)]; cut.push(q); break } }
    const S = c.S[c.H], b = c.toBody(q), a = Math.atan2(b[1] - S.y, b[0] - S.x);
    return { [c.H]: { abs: b, pose: 'point', wrAbs: c.A0(a, c.H), pv: c.pv(.4, 1) }, trail: { pts: cut, fade: cl((c.dur - c.tt - .25) / .5) }, look: q, face: 'focused' };
  },
  // ---- P1
  pinch_zoom(c) {
    const g = lerp(c.G.gap0 ?? 14, c.gap ?? 70, eio(cl((c.tt - .3) / Math.max(.4, c.dur - .9)))), o = {};
    ['R', 'L'].forEach(H => { const s = sgnOf(H); o[H] = { abs: c.side ? c.pt(26 + s * g / 2, 0, 2, H) : c.pt(0, g / 2, 2, H), pose: 'pinch', wrAbs: c.A0(-.5, H), pv: c.pv(.5, 1, H) } }); return { ...o, face: 'focused' };
  },
  high_five(c) {
    const S = c.S[c.H], end = c.target ? c.toBody(c.target) : c.pt(36, 40, 40, c.H), p = eo(cl(c.tt / .35)), tgt = [lerp(S.x + 10, end[0], p), lerp(S.y - 10, end[1], p)];
    return { [c.H]: { abs: tgt, pose: 'open', wrAbs: c.A(-Math.PI / 2 + .1), pv: c.pv(.8, 1) }, face: 'big_smile' };
  },
  push(c) {
    const o = {}, p = Math.sin(cl(c.tt / c.dur) * Math.PI); ['R', 'L'].forEach(H => o[H] = { abs: c.pt(36 + p * 8, 12, -2, H), pose: 'flat_out', wrAbs: c.A0(-.1, H), pv: c.pv(.6, 1, H) });
    return { ...o, body: { lean: .12 * Math.min(1, c.tt / .4) }, face: 'focused' };
  },
  pull(c) {
    const o = {}, p = Math.sin(cl(c.tt / c.dur) * Math.PI); ['R', 'L'].forEach(H => o[H] = { abs: c.pt(38 - p * 18, 12, -2, H), pose: 'grip', wrAbs: c.A0(.1, H), pv: c.pv(.6, 1, H) });
    return { ...o, body: { lean: -.12 * Math.min(1, c.tt / .4) }, face: 'focused' };
  },
  lift(c) {
    const o = {}, p = eio(cl(c.tt / Math.max(.5, c.dur * .6))); ['R', 'L'].forEach(H => o[H] = { abs: c.pt(24, 14, lerp(-48, 14, p), H), pose: 'flat_up', wrAbs: c.A0(.1, H), pv: c.pv(.6, 1, H) });
    return { ...o, mid: { kind: 'box', dy: -14, col: c.G.col }, face: 'focused' };
  },
  // ---- head only
  nod(c) { return { head: { rot: 0, dy: Math.sin(c.tt * 8) * 2.4, nod: Math.sin(c.tt * 8) * .14 }, face: null } },
  shake_head(c) { return { head: { shakeX: Math.sin(c.tt * 9) * 3, rot: Math.sin(c.tt * 9) * .06 }, face: 'worried' } },
  look_at(c) { return { look: c.target || null, face: null } },
  tilt_head(c) { return { head: { rot: .14 }, face: 'smile' } },
};
export const GESTURE_NAMES = Object.keys(GESTURES);
/** gestures that use both hands regardless of the `hand` field */
export const TWO_HAND = new Set(['shrug', 'clap', 'think_chin', 'type_on_laptop', 'write_with_pen', 'hold_paper', 'carry_box', 'cross_arms', 'hands_on_hips', 'rub_hands', 'spread_hands', 'measure', 'pinch_zoom', 'push', 'pull', 'lift']);
export const HEAD_ONLY = new Set(['nod', 'shake_head', 'look_at', 'tilt_head']);

/** sound hit moments of a person's gestures: [{id,t,kind}] */
export function gestureMarkers(spec) {
  const out = [];
  (spec.gestures || []).forEach((G, gi) => {
    const a = G.at, d = G.dur, id = (s) => `${G.name}${gi}-${s}`;
    switch (G.name) {
      case 'clap': for (let k = 0; a + .3 + k / 3.2 < a + d - .2; k++)out.push({ id: id(k), t: a + .25 + k / 3.2, kind: 'pop' }); break;
      case 'type_on_laptop': for (let k = 0; a + .3 + k * .13 < a + d - .2; k++)out.push({ id: id(k), t: a + .3 + k * .13 + (k % 3) * .02, kind: 'tick' }); break;
      case 'hold_phone': for (let k = 0; a + .5 + .95 * k < a + d - .3; k++)out.push({ id: id(k), t: a + .5 + .95 * k, kind: 'tick' }); break;
      case 'write_with_pen': for (let k = 0; a + .3 + k * .35 < a + d - .3; k++)out.push({ id: id(k), t: a + .3 + k * .35, kind: 'rustle' }); break;
      case 'fist_pump': for (let k = 0; a + .3 + k * .63 < a + d - .25; k++)out.push({ id: id(k), t: a + .3 + k * .63, kind: 'whoosh' }); break;
      case 'high_five': out.push({ id: id(0), t: a + .35, kind: 'pop' }); break;
      case 'facepalm': out.push({ id: id(0), t: a + .28, kind: 'pop' }); break;
      case 'thumbs_up': case 'ok': case 'point_up': case 'stop': out.push({ id: id(0), t: a + .3, kind: 'pop' }); break;
      case 'carry_box': case 'lift': out.push({ id: id(0), t: a + .2, kind: 'thud' }); break;
      case 'hand_over': out.push({ id: id(0), t: a + .35, kind: 'slide' }); break;
      case 'present': case 'beckon': case 'draw_in_air': case 'wave': case 'wave_goodbye': out.push({ id: id(0), t: a + .1, kind: 'whoosh' }); break;
      case 'rub_hands': case 'shrug': case 'scratch_head': case 'cross_arms': out.push({ id: id(0), t: a + .15, kind: 'rustle' }); break;
      case 'count_fingers': { const n = cl(Math.round(G.n || 3), 1, 5), step = (d - .6) / n; for (let k = 0; k < n; k++)out.push({ id: id(k), t: a + .3 + k * step + step * .33, kind: 'tick' }); break }
      default: break;
    }
  });
  return out;
}
/** library module without drawable assets of its own (see people/rig.js: 'people/gesture' and 'people/person') */
export const assets = {};
