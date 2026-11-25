// One world through one camera: LookLights (hemisphere + shadowed key + rim + fill + fog + toon tint) for the mood,
// a lens-side fill, an optional sky dome, your scene, and the post chain (ink, grade, bloom, DOF, vignette).
// A pure function of its props: the camera is set every render, the shadow box is snapped (core/shadows.ts).
import { useFrame, useThree } from "@react-three/fiber";
import { ThreeCanvas } from "@remotion/three";
import React from "react";
import * as THREE from "three";
import { applyToon, LookLights, LookSky } from "../lookdev/LookRig";
import { PostFX } from "../post/PostFX";
import type { V3 } from "../types";
import { moodOf } from "./moods";
import type { MoodPreset } from "./moods";
import { shotLight } from "./shadows"; // also patches three's screen-locked PCF dither
import type { Cam } from "./shadows";

export type { Cam };

const CamSet: React.FC<{ cam: Cam; far: number }> = ({ cam, far }) => {
  const { camera } = useThree();
  const c = camera as THREE.PerspectiveCamera;
  c.fov = cam.fov;
  c.near = 0.02;
  c.far = far;
  c.position.set(...cam.pos);
  const dir = new THREE.Vector3(...cam.look).sub(c.position).normalize();
  c.up.copy(new THREE.Vector3(0, 1, 0).applyAxisAngle(dir, ((cam.roll ?? 0) * Math.PI) / 180));
  c.lookAt(...cam.look);
  c.updateProjectionMatrix();
  return null;
};
const ToonSync: React.FC<{ look: MoodPreset }> = ({ look }) => {
  useFrame(() => applyToon(look), 0);
  return null;
};
const CamFill: React.FC<{ cam: Cam; color: string; intensity: number }> = ({ cam, color, intensity }) => {
  const target = React.useMemo(() => new THREE.Object3D(), []);
  target.position.set(...cam.look);
  target.updateMatrixWorld();
  const d = new THREE.Vector3(...cam.pos).sub(new THREE.Vector3(...cam.look));
  const side = new THREE.Vector3(0, 1, 0).cross(d).normalize();
  const p = new THREE.Vector3(...cam.pos).addScaledVector(side, d.length() * 0.3).add(new THREE.Vector3(0, d.length() * 0.35, 0));
  return (
    <>
      <primitive object={target} />
      <directionalLight position={[p.x, p.y, p.z]} target={target} color={color} intensity={intensity} />
    </>
  );
};

export type ViewProps = {
  mood: string | MoodPreset;
  cam: Cam;
  t: number;
  /** subject point for depth of field */
  focus?: V3;
  /** max DOF blur px at 1080 wide: wide 0.6, medium 1.4, close 2.4, macro 3.0 */
  blur?: number;
  /** extra exposure (stops) */
  exposure?: number;
  /** draw the sky dome (exteriors) */
  sky?: boolean;
  width?: number;
  height?: number;
  children?: React.ReactNode;
  style?: React.CSSProperties;
};

export const View: React.FC<ViewProps> = ({ mood: m, cam, t, focus, blur = 1.4, exposure = 0, sky = true, width = 1080, height = 1920, children, style }) => {
  const mood = typeof m === "string" ? moodOf(m) : m;
  const L = shotLight(mood, cam);
  const fd = Math.max(0.2, new THREE.Vector3(...cam.pos).distanceTo(new THREE.Vector3(...(focus ?? cam.look))));
  const P = mood.post;
  const k = width / 1080; // post px values are authored at 1080 wide
  const post = {
    ...P,
    outline: { ...P.outline, widthPx: P.outline.widthPx * k },
    dof: { enabled: blur > 0, focusDistance: fd, focusRange: fd * 2.2, maxBlurPx: blur * k },
    bloom: { ...P.bloom, radiusPx: P.bloom.radiusPx * k },
    grade: { ...P.grade, exposure: P.grade.exposure + exposure },
  };
  return (
    <ThreeCanvas width={width} height={height} shadows flat style={{ position: "absolute", inset: 0, ...style }}>
      <CamSet cam={cam} far={600} />
      <LookLights look={L.look} center={L.center} extent={L.extent} fog />
      <ToonSync look={L.look} />
      <CamFill cam={cam} color={mood.camFill.color} intensity={mood.camFill.intensity} />
      {sky ? <LookSky look={L.look} t={t} cloudSeed={3} /> : null}
      {children}
      <PostFX settings={post} />
    </ThreeCanvas>
  );
};
