// Per-character light rig: a small face key ~40° off the lens on the scene key's side and a warm rim opposite, so
// heads always have a lit and a shadow side and separate from the background (heads read flat without it).
// Placed before every render from the camera and the scene key, so stills and video frames agree.
import { useFrame, useThree } from "@react-three/fiber";
import React from "react";
import * as THREE from "three";
import type { V3 } from "../types";
import type { MoodPreset } from "./moods";

export type CastLightProps = {
  /** the head center (standing adult ≈ y 1.75 × height/1.8) */
  at: V3;
  /** camera position */
  cam: V3;
  mood: MoodPreset;
  /** master multiplier (0 = off, keeps the lights mounted: a constant light count avoids shader recompiles) */
  k?: number;
  rimBack?: number;
  rimUp?: number;
  rimSide?: number;
  fillDist?: number;
  fillUp?: number;
  fillSide?: number;
};

const norm2 = (x: number, z: number): [number, number] => {
  const l = Math.hypot(x, z) || 1;
  return [x / l, z / l];
};

export const castLightRig = (at: V3, cam: V3, o: Partial<CastLightProps> = {}, keySide = -1) => {
  const [fx, fz] = norm2(cam[0] - at[0], cam[2] - at[2]); // toward the lens (horizontal)
  const sx = -fz; // screen-right of the lens looking at the anchor
  const sz = fx;
  const rb = o.rimBack ?? 0.85;
  const ru = o.rimUp ?? 0.55;
  const rs = o.rimSide ?? 0.35 * -keySide; // rim opposite the face key: the shadow side keeps a warm edge
  const fd = o.fillDist ?? 1.05;
  const fu = o.fillUp ?? 0.5;
  const fs = o.fillSide ?? 0.9 * keySide;
  const rim: V3 = [at[0] - fx * rb + sx * rs, at[1] + ru, at[2] - fz * rb + sz * rs];
  const fill: V3 = [at[0] + fx * fd + sx * fs, at[1] + fu, at[2] + fz * fd + sz * fs];
  return { rim, fill };
};

const keySideOf = (dir: V3, at: V3, cam: V3): number => {
  const [fx, fz] = norm2(cam[0] - at[0], cam[2] - at[2]);
  const s = dir[0] * -fz + dir[2] * fx; // dot(keyDir, screen-right)
  return Math.abs(s) < 1e-3 ? -1 : Math.sign(s);
};

export const CastLight: React.FC<CastLightProps> = ({ at, cam, mood, k = 1, ...o }) => {
  const rimRef = React.useRef<THREE.PointLight>(null);
  const fillRef = React.useRef<THREE.PointLight>(null);
  useThree();
  const P = castLightRig(at, cam, o, keySideOf(mood.lights.key.dir, at, cam));
  useFrame(() => {
    rimRef.current?.position.set(...P.rim);
    fillRef.current?.position.set(...P.fill);
  }, 0);
  return (
    <>
      <pointLight ref={rimRef} position={P.rim} color={mood.castLight.rim.color} intensity={mood.castLight.rim.intensity * k} distance={2.4} decay={2} />
      <pointLight ref={fillRef} position={P.fill} color={mood.castLight.fill.color} intensity={mood.castLight.fill.intensity * k} distance={3.0} decay={2} />
    </>
  );
};
