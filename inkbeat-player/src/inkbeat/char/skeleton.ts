// The character's layout and arm chain, shared by Character3D (drawing) and core/ik.ts (props in the hand), so a hand
// placed by IK is exactly where the drawn hand is. All lengths are fractions of the character's height (h = 1).
import * as THREE from "three";
import {
  ARM_PLANE_DEG,
  buildOf,
  FOREARM,
  HEAD_BOT,
  HEAD_HW,
  HEAD_TOP,
  HIP_T,
  NECK_LEN,
  SHOULDER_IN,
  SHOULDER_T,
  TORSO_H,
  TORSO_R,
  TORSO_TUCK,
  UPPER_ARM,
} from "./family";
import type { Build } from "./family";
import { torsoProfileAt } from "./geometry";

export type ArmPose = {
  /** [shoulder, elbow] in degrees: 0 = hanging straight down, + = raised outward / forward in the arm plane */
  armL?: [number, number];
  armR?: [number, number];
  /** turns the arm plane forward (+, in front of the body), degrees */
  armLFwd?: number;
  armRFwd?: number;
  /** whole-body lean about the feet, degrees (+ = forward) */
  lean?: number;
  /** body bob in 1/430 h steps (small hops, nods of the body) */
  bob?: number;
};

const D2R = Math.PI / 180;
const X_AXIS = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

export type Layout = {
  b: Build;
  headH: number; // head height
  chinY: number;
  headY: number; // head origin (widest row)
  torsoTop: number;
  torsoY0: number; // torso bottom
  torsoH: number;
  hipY: number;
  shoulderY: number;
  shoulderX: number;
  upper: number;
  fore: number;
  neckY0: number;
  neckY1: number;
};

const layoutCache = new Map<string, Layout>();
/** where everything sits for a build (cached) */
export const layoutOf = (build?: Partial<Build>): Layout => {
  const b = buildOf(build);
  const key = JSON.stringify(b);
  const hit = layoutCache.get(key);
  if (hit) return hit;
  const hs = b.headScale;
  const headH = (HEAD_TOP + HEAD_BOT) * HEAD_HW * hs;
  const chinY = 1 - headH;
  const headY = chinY + HEAD_BOT * HEAD_HW * hs;
  const torsoTop = chinY + TORSO_TUCK - (b.neck - 1) * NECK_LEN;
  const torsoH = TORSO_H * b.torsoHeight;
  const torsoY0 = torsoTop - torsoH;
  const shoulderY = torsoY0 + SHOULDER_T * torsoH;
  const l: Layout = {
    b,
    headH,
    chinY,
    headY,
    torsoTop,
    torsoY0,
    torsoH,
    hipY: torsoY0 + HIP_T * torsoH,
    shoulderY,
    shoulderX: torsoRadius(shoulderY, torsoY0, torsoH, b) * SHOULDER_IN,
    upper: UPPER_ARM * b.armLength,
    fore: FOREARM * b.armLength,
    neckY0: torsoTop - torsoH * 0.2,
    neckY1: chinY + HEAD_BOT * HEAD_HW * hs * 0.45,
  };
  if (layoutCache.size > 200) layoutCache.clear();
  layoutCache.set(key, l);
  return l;
};

const torsoRadius = (y: number, y0: number, h: number, b: Build) => TORSO_R * b.torsoWidth * torsoProfileAt((y - y0) / h, b.torso);
/** torso half-width (x) at height y above the soles */
export const torsoRadiusAt = (y: number, l: Layout) => torsoRadius(y, l.torsoY0, l.torsoH, l.b);

/** shoulder, elbow and hand center of one arm in the upper-body frame (before stoop, bob, lean and yaw) */
export const armChain = (pose: ArmPose, side: "L" | "R", l: Layout) => {
  const s = side === "L" ? -1 : 1;
  const ang = (side === "L" ? pose.armL : pose.armR) ?? [6, 6];
  const fw = (ARM_PLANE_DEG + ((side === "L" ? pose.armLFwd : pose.armRFwd) ?? 0)) * D2R;
  const out = new THREE.Vector3(s * Math.cos(fw), 0, Math.sin(fw));
  const r1 = ang[0] * D2R;
  const r2 = (ang[0] + ang[1]) * D2R;
  const S = new THREE.Vector3(s * l.shoulderX, l.shoulderY, 0.004);
  const E = S.clone().addScaledVector(out, l.upper * Math.sin(r1)).addScaledVector(UP, -l.upper * Math.cos(r1));
  const H = E.clone().addScaledVector(out, l.fore * Math.sin(r2)).addScaledVector(UP, -l.fore * Math.cos(r2));
  return { S, E, H };
};

/** upper-body frame → character frame (h = 1, before yaw): stoop about the hips, bob, then lean about the feet */
export const toCharacter = (p: THREE.Vector3, l: Layout, pose: ArmPose) => {
  const q = p.clone();
  if (l.b.stoop) {
    q.y -= l.hipY;
    q.applyAxisAngle(X_AXIS, l.b.stoop * D2R);
    q.y += l.hipY;
  }
  q.y += (pose.bob ?? 0) / 430;
  q.applyAxisAngle(X_AXIS, (pose.lean ?? 0) * D2R);
  return q;
};

/** the hand center in the character frame (h = 1, before yaw); the drawn hand sits exactly here when not walking */
export const handLocal = (pose: ArmPose, side: "L" | "R", build?: Partial<Build>) => {
  const l = layoutOf(build);
  return toCharacter(armChain(pose, side, l).H, l, pose);
};
