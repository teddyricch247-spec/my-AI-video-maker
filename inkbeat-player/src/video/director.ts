// The director: for a time t, which shot is active, where the camera is, and the push-through between shots.
// A pure function of t (the same t always gives the same frame). Leave this file alone.
import { poseAt, withShake } from "../inkbeat/core/rig";
import type { Cam } from "../inkbeat/core/rig";
import { SHOTS } from "./plan";

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const easeIn = (u: number) => clamp(u) ** 3;
const easeOut = (u: number) => 1 - (1 - clamp(u)) ** 3;
const OUT = 0.2; // the outgoing shot punches in (fov x 0.7)...
const IN = 0.27; // ...and the incoming one pulls back out: no hard cut
const MIN_DIST = 0.45; // the lens never gets closer than this to the subject

export const direct = (t: number) => {
  let i = SHOTS.length - 1;
  while (i > 0 && t < SHOTS[i].from) i--;
  const s = SHOTS[i];
  const next = SHOTS[i + 1];
  const p = poseAt(s.base, s.beats, s.from, t, s.prms);
  let cam: Cam = withShake(p, p.shake);
  let k = 1;
  if (next && t > next.from - OUT) k = 1 - 0.3 * easeIn((t - (next.from - OUT)) / OUT);
  else if (i > 0 && t < s.from + IN) k = 0.7 + 0.3 * easeOut((t - s.from) / IN);
  const pos: [number, number, number] = [cam.pos[0], Math.max(0.08, cam.pos[1]), cam.pos[2]];
  const dx = pos[0] - s.focus[0];
  const dy = pos[1] - s.focus[1];
  const dz = pos[2] - s.focus[2];
  const d = Math.hypot(dx, dy, dz);
  if (d < MIN_DIST && d > 1e-4) {
    const f = MIN_DIST / d;
    pos[0] = s.focus[0] + dx * f;
    pos[1] = s.focus[1] + dy * f;
    pos[2] = s.focus[2] + dz * f;
  }
  cam = { ...cam, pos, fov: cam.fov * k };
  return { cam, shot: s, index: i, mood: s.mood, focus: s.focus, blur: s.blur ?? 1.4, sky: s.sky ?? true, exposure: s.exposure ?? 0 };
};
