// The Shorts camera rig: every plan beat is a move from the current pose, ~19 frames, symmetric
// ease; between beats a drift-push of 3%/s (never still); a beat may carry a target lens (`to`). Pure function of t.
import type { V3 } from "../types";

/** a plan beat: a move starting at t (s) for dur (s); generate these from your word-anchored plan, never type them */
export type Beat = { t: number; move: string; dur: number; word?: string };

export type Cam = { pos: V3; look: V3; fov: number; roll?: number };
export type BeatPrm = { frac?: number; deg?: number; up?: number; side?: number; pan?: number; tilt?: number; to?: Cam; dur?: number };
type Pose = { pos: V3; look: V3; fov: number; roll: number };

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const easeOut = (u: number) => 1 - Math.pow(1 - clamp(u), 3);
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const mix = (a: V3, b: V3, u: number): V3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
const rotY = (v: V3, a: number): V3 => [v[0] * Math.cos(a) + v[2] * Math.sin(a), v[1], -v[0] * Math.sin(a) + v[2] * Math.cos(a)];

export const FPS = 30;
export const DRIFT = 0.03;
export const ARC = 3; // deg/s (between moves the camera keeps ~1/3 of peak speed)

const moveAt = (m: string, p0: Pose, u: number, prm: BeatPrm): Pose => {
  if (prm.to) {
    const to = prm.to;
    return { pos: mix(p0.pos, to.pos, u), look: mix(p0.look, to.look, u), fov: p0.fov + (to.fov - p0.fov) * u, roll: p0.roll + ((to.roll ?? 0) - p0.roll) * u };
  }
  const d = sub(p0.look, p0.pos);
  const dist = len(d) || 1;
  const right: V3 = [-d[2] / dist, 0, d[0] / dist];
  switch (m) {
    case "PUSH":
    case "MACRO":
    case "PULL":
    case "PUNCH": {
      const f = prm.frac ?? (m === "PUSH" ? 0.12 : m === "MACRO" ? 0.3 : m === "PULL" ? -0.16 : 0.08);
      return { ...p0, pos: add(p0.pos, d, f * u) };
    }
    case "ORBIT_L":
    case "ORBIT_R": {
      const a = (((prm.deg ?? 18) * Math.PI) / 180) * (m === "ORBIT_L" ? 1 : -1) * u;
      return { ...p0, pos: add(p0.look, rotY(sub(p0.pos, p0.look), a)), roll: p0.roll + (m === "ORBIT_L" ? -1 : 1) * 3 * Math.sin(Math.PI * u) };
    }
    case "CRANE_UP":
    case "CRANE_DOWN": {
      const h = (prm.up ?? 0.25 * dist) * (m === "CRANE_UP" ? 1 : -1) * u;
      return { ...p0, pos: add(p0.pos, [0, h, 0]), look: add(p0.look, [0, h * (prm.tilt ?? 0.55), 0]) };
    }
    case "DOLLY_L":
    case "DOLLY_R": {
      const s = (prm.side ?? 0.25 * dist) * (m === "DOLLY_R" ? 1 : -1) * u;
      return { ...p0, pos: add(p0.pos, right, s), look: add(p0.look, right, s) };
    }
    case "TILT_UP":
    case "TILT_DOWN": {
      const a = (((prm.deg ?? 14) * Math.PI) / 180) * (m === "TILT_UP" ? 1 : -1) * u;
      const h = Math.hypot(d[0], d[2]);
      const el = Math.atan2(d[1], h) + a;
      return { ...p0, look: [p0.pos[0] + (d[0] / h) * Math.cos(el) * dist, p0.pos[1] + Math.sin(el) * dist, p0.pos[2] + (d[2] / h) * Math.cos(el) * dist] };
    }
    case "WHIP": {
      const a = (((prm.pan ?? 25) * Math.PI) / 180) * u;
      return { ...p0, look: add(p0.pos, rotY(d, -a)) };
    }
    default:
      return p0;
  }
};

const drift = (p: Pose, dt: number): Pose => {
  if (dt <= 0) return p;
  const d = sub(p.look, p.pos);
  const dist = len(d);
  const k = Math.min(0.3, DRIFT * dt);
  const pushed = add(p.pos, d, (k * Math.min(dist, 30)) / Math.max(dist, 1e-3));
  // + a slow lateral arc around the look point (1.5°/s): parallax keeps a hold alive without a stronger zoom
  return { ...p, pos: add(p.look, rotY(sub(pushed, p.look), ((ARC * Math.PI) / 180) * Math.min(dt, 4))) };
};

/** the camera of a setup at time t, plus a 0..1 decaying shake */
export const poseAt = (base: Cam, beats: Beat[], t0: number, t: number, prms: (BeatPrm | undefined)[] = []): Pose & { shake: number } => {
  let p: Pose = { pos: base.pos, look: base.look, fov: base.fov, roll: base.roll ?? 0 };
  let cur = t0;
  let shake = 0;
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i];
    const prm = prms[i] ?? {};
    if (b.move === "SHAKE") {
      const s = t - b.t;
      if (s >= 0 && s < 0.4) shake = Math.max(shake, (1 - s / 0.4) * Math.sin(s * 70));
      continue;
    }
    if (b.move === "SLOWPUSH" || b.move === "RACK") continue;
    if (t < b.t) return { ...drift(p, t - cur), shake };
    p = drift(p, b.t - cur);
    const dur = prm.dur ?? (b.move === "PUNCH" ? 0.2 : b.move === "WHIP" ? 0.3 : b.dur || 0.63);
    const u = clamp((t - b.t) / dur);
    const e = b.move === "PUNCH" ? easeOut(u) : ease(u);
    if (u < 1) return { ...moveAt(b.move, p, e, prm), shake };
    p = moveAt(b.move, p, 1, prm);
    cur = b.t + dur;
  }
  return { ...drift(p, t - cur), shake };
};

export const withShake = (p: Pose, shake: number): Cam => {
  if (!shake) return p;
  const a = 0.004 * len(sub(p.look, p.pos)) * shake;
  return { ...p, look: add(p.look, [a, a * 0.6, 0]), pos: add(p.pos, [a * 0.3, a * 0.2, 0]) };
};
/** a lens aimed so `subject` sits at `face` (fraction from the top of the frame) */
export const aim = (from: V3, subject: V3, fov: number, face = 0.4): Cam => {
  const d = Math.hypot(subject[0] - from[0], subject[1] - from[1], subject[2] - from[2]);
  const drop = Math.tan(((0.5 - face) * fov * Math.PI) / 180) * d;
  return { pos: from, look: [subject[0], subject[1] - drop, subject[2]], fov, roll: 0 };
};
/** keep the look point `d` m ahead (PUSH / ORBIT scale with |look − pos|) */
export const near = (c: Cam, d: number): Cam => {
  const v = sub(c.look, c.pos);
  const L = len(v);
  return { ...c, look: add(c.pos, v, d / L) };
};
/** yaw the look by `deg` about the lens (a WHIP beat pans back by 25°) */
export const panned = (c: Cam, deg: number): Cam => ({ ...c, look: add(c.pos, rotY(sub(c.look, c.pos), (deg * Math.PI) / 180)) });
