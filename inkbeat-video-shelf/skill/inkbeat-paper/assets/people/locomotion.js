/**
 * people/locomotion.js — ground-distance based gait, ease in/out, turn-around hop, idle breathing. (Library module: no drawable assets of its own.)
 *
 * travelDist(t,w) / travelFactor(t,w) / timeAtDist(fn,d): distance and speed envelope of a walk window w={speed,from,to,ramp}; the leg phase is distance / stride, so planted feet never slide.
 * GAIT (walk, run) + gait(o,t) + footPose(...): per-foot ground contact, lift and hip bob;  dirAt(o,t) / turnHop(o,t): facing over time and the hop of a turn;
 * footstepTimes(o,tMax): 'thud' markers for every footfall;  breath(t), weightShift(t): idle motion for standing people.
 * Used by people/rig.js; see 'people/walk' and 'people/person' (registered in rig.js) for the drawable assets.
 */
import { cl, lerp } from '../core/core.js';

/** integral of smoothstep ramp, x in ramp units: J(x)=x^3-x^4/2 on [0,1], x-0.5 after */
const J = x => x <= 0 ? 0 : x < 1 ? x * x * x - x * x * x * x / 2 : x - .5;

/**
 * travelDist(t, w) -> ground distance (px) travelled by time t.
 * w = {speed (px/s), from (s|null), to (s|null), ramp (s, default .4)}.
 * from=null && to=null -> constant speed from t=0 (distance = speed*t).
 * from given -> speed eases in over `ramp`; to given -> speed eases out so it reaches 0 exactly at `to`.
 * Example: travelDist(t,{speed:200,from:1,to:5})
 */
export function travelDist(t, w) {
  const speed = w.speed ?? 0, ramp = w.ramp ?? .4, from = w.from ?? null, to = (w.to === undefined || w.to === Infinity) ? null : w.to;
  const iin = from == null ? t : ramp * J((t - from) / ramp);
  const iout = to == null ? 0 : ramp * J((t - to + ramp) / ramp);
  return speed * (iin - iout);
}
/** speed factor 0..1 at time t for the same window (used for lean / bob amplitude) */
export function travelFactor(t, w) {
  const ramp = w.ramp ?? .4, from = w.from ?? null, to = (w.to === undefined || w.to === Infinity) ? null : w.to;
  const sm = x => { x = cl(x); return x * x * (3 - 2 * x) };
  return (from == null ? 1 : sm((t - from) / ramp)) - (to == null ? 0 : sm((t - to + ramp) / ramp));
}
/** earliest time in [0,tMax] where distance(t) >= d (bisection; distance must be non-decreasing) */
export function timeAtDist(distFn, d, tMax = 15) {
  if (distFn(tMax) < d) return null; let a = 0, b = tMax;
  for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (distFn(m) >= d) b = m; else a = m }
  return b;
}
// ------------------------------------------------------------------ gait
/** gait presets (px at scale 1). stride = ground distance per full cycle (both legs), beta = stance duty, lift = foot lift, lean = torso lean (rad) */
export const GAIT = {
  walk: { stride: 120, beta: .6, lift: 9, lean: .045, armAmp: .5, armLen: 52, bob: 1.2, speed: 190, hand: 'relaxed' },
  run: { stride: 185, beta: .38, lift: 22, lean: .2, armAmp: .85, armLen: 33, bob: 8, speed: 420, hand: 'fist' },
};
export const ANKLE = 8, HIP_NOM = 77, LEG = 75;   // ankle height above ground, nominal hip height, usable leg length (2 x 38 bones - slack)

/**
 * gait(o,t): locomotion state from o.walk = {speed (screen px/s), stride (px at scale 1), from, to, mode:'walk'|'run', phase (cycles)}.
 * Leg phase u = groundDistance / (scale*stride) so planted feet move back at exactly the ground speed (no sliding).
 * Returns {f (0..1 speed factor), D (px travelled), u (cycles), cfg, mode} or {f:0,D:0,u:0} when o.walk is falsy.
 */
export function gait(o, t) {
  const w = o.walk; if (!w) return { f: 0, D: 0, u: 0, cfg: GAIT.walk, mode: 'idle' };
  const mode = w.mode || 'walk', cfg = GAIT[mode] || GAIT.walk, s = o.s || 1;
  const win = { speed: w.speed ?? cfg.speed, from: w.from ?? null, to: w.to ?? null, ramp: w.ramp ?? .4 };
  const D = travelDist(t, win), f = travelFactor(t, win), stride = (w.stride ?? cfg.stride) * s;
  return { f, D, u: D / stride + (w.phase || 0), cfg: { ...cfg, beta: w.beta ?? cfg.beta }, mode, stride, win };
}
const sm = x => { x = cl(x); return x * x * (3 - 2 * x) };
/** foot offset for one leg at gait phase u (cycles). isB = the other leg (phase + .5). Returns {dx, lift, ang, plant} in local px. */
export function footPose(cfg, stride, s, u, isB) {
  const beta = cfg.beta, R = stride / s * beta / 2; let p = (u + (isB ? .5 : 0)) % 1; if (p < 0) p += 1;
  if (p < beta) return { dx: R - (p / beta) * 2 * R, lift: 0, ang: 0, plant: true, p };
  const w = (p - beta) / (1 - beta), e = sm(w);
  return { dx: -R + 2 * R * e, lift: cfg.lift * Math.sin(Math.PI * w), ang: lerp(.35, -.3, w), plant: false, p };
}
/** facing direction (continuous -1..1) with optional turn-arounds: o.dir (start), o.turns=[{at,dur,to}] */
export function dirAt(o, t) {
  let d = o.dir ?? 1; (o.turns || []).forEach(k => { const dur = k.dur ?? .5; if (t >= k.at) d = lerp(d, k.to, sm((t - k.at) / dur)) });
  return d;
}
/** hop height (px at scale 1) during a turn, so the flip reads as a little pivot */
export function turnHop(o, t) { let h = 0; (o.turns || []).forEach(k => { const dur = k.dur ?? .5; if (t > k.at && t < k.at + dur) h = Math.max(h, 3 * Math.sin(Math.PI * (t - k.at) / dur)) }); return h }
/** footstep hit times (s) for markers: both feet, until tMax */
export function footstepTimes(o, tMax = 15) {
  const out = []; if (!o.walk) return out; const g0 = gait(o, 0), s = o.s || 1;
  const dist = tt => gait(o, tt).D; const w = o.walk, cfg = g0.cfg, stride = g0.stride;
  for (let k = 0; k < 200; k++) {
    const d = (k / 2 - (w.phase || 0)) * stride; if (d < 0) continue; const tt = timeAtDist(dist, d, tMax); if (tt == null) break; out.push({ id: 'step' + k, t: tt, kind: 'thud' });
  }
  return out;
}
/** idle: breathing 0..1 (3.4 s period) and slow weight shift -1..1 */
export const breath = t => .5 + .5 * Math.sin(t * 2 * Math.PI / 3.4);
export const weightShift = t => Math.sin(t * .55) * .8 + Math.sin(t * .23 + 1) * .2;
/** library module without drawable assets of its own (see people/rig.js: 'people/walk') */
export const assets = {};
