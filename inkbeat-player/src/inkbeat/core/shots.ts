// Shot presets for a vertical (9:16) frame. Each returns a camera, the focus point, a depth-of-field strength and
// spots for FOREGROUND props (near the lens, to one side, so they fall soft in the depth of field and frame the hero).
//   heroLow  : a low lens (hip height), the hero fills ~40% of the frame height, 3/4 view, foreground props
//   medium   : waist-up-ish, lens at chest height, 3/4 view
//   closeUp  : head and shoulders, lens at eye height, longer lens
//   wide     : establishing, the hero ~18% of the frame, a high-ish lens
// `facing` is the character's yaw (the direction it faces); `side` (deg) puts the lens that far round from the face,
// so heads read 3/4 (20-35 deg is the sweet spot; never dead frontal in most shots).
import type { V3 } from "../types";
import { aim } from "./rig";
import type { Cam } from "./rig";

export type Shot = { cam: Cam; focus: V3; blur: number; fg: V3[] };
type ShotIn = { feet: V3; height: number; facing: number; side?: number; fov?: number; headAt?: number };

const D2R = Math.PI / 180;
const head = (o: ShotIn): V3 => [o.feet[0], o.feet[1] + o.height * (o.headAt ?? 0.86), o.feet[2]];
const place = (o: ShotIn, dist: number, lensY: number, sideDeg: number): V3 => {
  const a = o.facing + sideDeg * D2R;
  return [o.feet[0] + Math.sin(a) * dist, o.feet[1] + lensY, o.feet[2] + Math.cos(a) * dist];
};
/** the distance at which `span` meters fill `fill` of the frame height with a vertical fov */
const distFor = (span: number, fill: number, fov: number) => span / fill / (2 * Math.tan((fov * D2R) / 2));
/** foreground spots: between lens and hero at `k` of the way, offset sideways to `edge` of the frame half-width
 * (1.0 = centered on the frame edge, half cropped), so they sit low in a corner, soft, framing the hero. Keep them
 * SMALL (0.3-0.5 m): near the lens a barrel already fills half the frame. */
const fgSpots = (cam: V3, feet: V3, fov: number, k = 0.34, edge = 1.0): V3[] => {
  const dx = feet[0] - cam[0];
  const dz = feet[2] - cam[2];
  const L = Math.hypot(dx, dz) || 1;
  const rx = dz / L;
  const rz = -dx / L;
  const bx = cam[0] + dx * k;
  const bz = cam[2] + dz * k;
  const half = Math.tan(((fov * 9) / 16 / 2) * D2R) * L * k; // the frame half-width at that depth
  const o = half * edge;
  return [
    [bx + rx * o, feet[1], bz + rz * o],
    [bx - rx * o * 1.2, feet[1], bz - rz * o * 1.2],
  ];
};

export const heroLow = (o: ShotIn & { fill?: number }): Shot => {
  const fov = o.fov ?? 56;
  const d = distFor(o.height, o.fill ?? 0.4, fov);
  const pos = place(o, d, o.height * 0.36, o.side ?? 30);
  const h = head(o);
  return { cam: aim(pos, h, fov, 0.33), focus: h, blur: 2.2, fg: fgSpots(pos, o.feet, fov) };
};
export const medium = (o: ShotIn): Shot => {
  const fov = o.fov ?? 48;
  const d = distFor(o.height * 0.75, 0.62, fov);
  const pos = place(o, d, o.height * 0.72, o.side ?? 28);
  const h = head(o);
  return { cam: aim(pos, h, fov, 0.36), focus: h, blur: 1.6, fg: fgSpots(pos, o.feet, fov, 0.4, 1.0) };
};
export const closeUp = (o: ShotIn): Shot => {
  const fov = o.fov ?? 42;
  const d = distFor(o.height * 0.55, 0.5, fov);
  const pos = place(o, d, o.height * 0.84, o.side ?? 25);
  const h = head(o);
  return { cam: aim(pos, h, fov, 0.38), focus: h, blur: 2.6, fg: [] };
};
export const wide = (o: ShotIn): Shot => {
  const fov = o.fov ?? 62;
  const d = distFor(o.height, 0.18, fov);
  const pos = place(o, d, Math.max(1.6, o.height * 1.1), o.side ?? 20);
  const h = head(o);
  return { cam: aim(pos, h, fov, 0.5), focus: h, blur: 0.6, fg: fgSpots(pos, o.feet, fov, 0.3, 0.8) };
};
export const SHOTS = { heroLow, medium, closeUp, wide };
