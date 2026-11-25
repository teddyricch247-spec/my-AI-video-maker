// Stable shadows. Import this module once, before any material compiles (View.tsx does).
//
// 1. PCF dither patch. three r186 rotates its PCF soft-shadow taps by interleavedGradientNoise(gl_FragCoord): a
//    screen-locked stipple in every penumbra that crawls over the set as soon as the camera moves. A fixed rotation
//    keeps the same hardware-PCF taps (a smooth 1-texel soft edge), now locked to the shadow map: stable and crisp.
// 2. Shadow box. If the key's shadow box follows the look point and resizes with the camera distance every frame,
//    the shadow-map texel grid slides across the set and every shadow edge crawls. The extent is quantized to 2 m
//    steps and the center is snapped to whole shadow texels in the light's own view plane (light at center + dir·60,
//    looking at the center, up = +y), so a static object's shadow is pixel-identical from frame to frame.
// Modifies three.js shader chunks (MIT, (c) three.js authors); see THIRD_PARTY_NOTICES.md
import * as THREE from "three";
import type { V3 } from "../types";
import type { MoodPreset } from "./moods";

const IGN = "interleavedGradientNoise( gl_FragCoord.xy )";
if (THREE.ShaderChunk.shadowmap_pars_fragment.includes(IGN)) {
  (THREE.ShaderChunk as Record<string, string>).shadowmap_pars_fragment = THREE.ShaderChunk.shadowmap_pars_fragment.split(IGN).join("0.0");
}

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export const snapShadowCenter = (c: V3, dir: V3, extent: number, mapSize: number): V3 => {
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const f: V3 = [-dir[0] / l, -dir[1] / l, -dir[2] / l]; // light → target
  let r: V3 = [-f[2], 0, f[0]]; // right = f × up(0,1,0)
  const rl = Math.hypot(r[0], r[2]);
  if (rl < 1e-4) return c;
  r = [r[0] / rl, 0, r[2] / rl];
  const u: V3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]]; // up' = right × f
  const texel = (2 * extent) / mapSize;
  const dr = c[0] * r[0] + c[1] * r[1] + c[2] * r[2];
  const du = c[0] * u[0] + c[1] * u[1] + c[2] * u[2];
  const er = Math.round(dr / texel) * texel - dr;
  const eu = Math.round(du / texel) * texel - du;
  return [c[0] + r[0] * er + u[0] * eu, c[1] + r[1] * er + u[1] * eu, c[2] + r[2] * er + u[2] * eu];
};

export type Cam = { pos: V3; look: V3; fov: number; roll?: number };
export type ShotLight = { look: MoodPreset; center: V3; extent: number };

/** the shadow box for a lens: extent from the lens→look distance (2 m steps, 4–16 m), center snapped to texels */
export const shotLight = (mood: MoodPreset, cam: Cam, keyDir?: V3): ShotLight => {
  const look = keyDir ? { ...mood, lights: { ...mood.lights, key: { ...mood.lights.key, dir: keyDir } } } : mood;
  const d = dist(cam.pos, cam.look);
  const extent = clamp(Math.ceil((d * 1.2 + 3) / 2) * 2, 4, 16);
  const c0: V3 = [Math.round(cam.look[0] * 2) / 2, Math.round(cam.look[1] * 2) / 2, Math.round(cam.look[2] * 2) / 2];
  return { look, center: snapShadowCenter(c0, look.lights.key.dir, extent, look.lights.key.mapSize), extent };
};
