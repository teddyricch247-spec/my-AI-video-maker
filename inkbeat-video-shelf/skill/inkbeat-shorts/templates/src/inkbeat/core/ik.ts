// Props held IN the hand (never floating): the world position of a Character3D hand for a given arm pose (forward
// kinematics through the character's own arm chain, char/skeleton.ts), and an arm pose that lands the hand on a world
// target (deterministic grid search + refinement, memoized in a bounded cache). Put the prop at handWorld(...) and
// orient it from there. Pass the same `build` and `height` as the character, and its body yaw (bodyYawOf when the
// character uses faceCamera). Walking swings the arms, so solve hands on a standing pose.
//   const a = solveArm({ position, yaw, side: "R", target: cupHandle, height, build });
//   <Character3D ... pose={{ armR: a.arm, armRFwd: a.fwd }} />
import * as THREE from "three";
import type { Build } from "../char/family";
import { handLocal } from "../char/skeleton";
import type { ArmPose } from "../char/skeleton";
import type { V3 } from "../types";

/** world position of the hand center of an angle-posed arm. side "L"/"R" = the character's -x / +x arm. */
export const handWorld = (o: { position: V3; yaw: number; height?: number; pose: ArmPose; side: "L" | "R"; build?: Partial<Build> }): V3 => {
  const h = o.height ?? 1.7;
  const H = handLocal(o.pose, o.side, o.build);
  H.multiplyScalar(h).applyAxisAngle(new THREE.Vector3(0, 1, 0), o.yaw);
  return [o.position[0] + H.x, o.position[1] + H.y, o.position[2] + H.z];
};

const solveCache = new Map<string, { arm: [number, number]; fwd: number; err: number }>();
/** angle-pose an arm so its hand lands on `target` (err = remaining distance in meters; > 0.03 = out of reach) */
export const solveArm = (o: { position: V3; yaw: number; side: "L" | "R"; base?: ArmPose; target: V3; height?: number; build?: Partial<Build> }): { arm: [number, number]; fwd: number; err: number } => {
  const key = [JSON.stringify(o.build ?? {}), o.side, ...o.position, o.yaw, ...o.target, o.base?.lean ?? 0, o.base?.bob ?? 0, o.height ?? 1.7].map((v) => (typeof v === "number" ? v.toFixed(3) : v)).join("|");
  const hit = solveCache.get(key);
  if (hit) return hit;
  const f = (a: number, b: number, w: number) => {
    const pose: ArmPose = { ...(o.base ?? {}), ...(o.side === "L" ? { armL: [a, b] as [number, number], armLFwd: w } : { armR: [a, b] as [number, number], armRFwd: w }) };
    const hh = handWorld({ position: o.position, yaw: o.yaw, pose, side: o.side, height: o.height, build: o.build });
    return Math.hypot(hh[0] - o.target[0], hh[1] - o.target[1], hh[2] - o.target[2]);
  };
  let best = { a: 30, b: 30, w: 30, e: Infinity };
  for (let a = 0; a <= 170; a += 10) for (let b = 0; b <= 140; b += 14) for (let w = -40; w <= 170; w += 10) {
    const e = f(a, b, w);
    if (e < best.e) best = { a, b, w, e };
  }
  for (const st of [5, 2.5, 1.2])
    for (let i = 0; i < 3; i++)
      for (const [da, db, dw] of [[st, 0, 0], [-st, 0, 0], [0, st, 0], [0, -st, 0], [0, 0, st], [0, 0, -st]]) {
        const e = f(best.a + da, best.b + db, best.w + dw);
        if (e < best.e) best = { a: best.a + da, b: best.b + db, w: best.w + dw, e };
      }
  const r = { arm: [best.a, best.b] as [number, number], fwd: best.w, err: best.e };
  if (solveCache.size > 4000) solveCache.clear();
  solveCache.set(key, r);
  return r;
};

/** HOLD A PROP IN FRONT without covering the face. The family's chin sits at about 0.7 of the height (lower on kids),
 * so a hand raised to ~0.6 h puts a book or a phone in front of the face. Keep held props at chest or belly height
 * (up ≈ 0.42–0.5 h; kids ≈ 0.38–0.44 h), a little forward and to the side, and let the camera look down a touch.
 * Returns the arm pose to pass to Character3D and the hand position to put the prop at. */
export const holdInFront = (o: { position: V3; yaw: number; height?: number; side?: "L" | "R"; forward?: number; up?: number; out?: number; build?: Partial<Build> }) => {
  const h = o.height ?? 1.7;
  const side = o.side ?? "R";
  const s = side === "R" ? 1 : -1;
  const f: V3 = [Math.sin(o.yaw), 0, Math.cos(o.yaw)];
  const r: V3 = [Math.cos(o.yaw), 0, -Math.sin(o.yaw)]; // the character's +x side
  const fw = (o.forward ?? 0.2) * h;
  const ou = (o.out ?? 0.09) * h * s;
  const target: V3 = [o.position[0] + f[0] * fw + r[0] * ou, o.position[1] + (o.up ?? 0.46) * h, o.position[2] + f[2] * fw + r[2] * ou];
  const a = solveArm({ position: o.position, yaw: o.yaw, side, target, height: h, build: o.build });
  const pose = side === "R" ? { armR: a.arm, armRFwd: a.fwd } : { armL: a.arm, armLFwd: a.fwd };
  const hand = handWorld({ position: o.position, yaw: o.yaw, pose, side, height: h, build: o.build });
  return { pose, hand, err: a.err };
};
