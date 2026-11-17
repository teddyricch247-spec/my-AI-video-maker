// GlowSprite: additive soft halo for practical lights (lamps, windows, candles, sun/moon flares).
import React, { useMemo } from "react";
import * as THREE from "three";
import type { V3 } from "../types";

let glowTex: THREE.DataTexture | null = null;
/** Radial falloff: hot core, medium halo, long faint tail; exactly 0 at the sprite edge. */
export const glowTexture = () => {
  if (glowTex) return glowTex;
  const N = 256;
  const d = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const r = Math.hypot((x + 0.5) / N - 0.5, (y + 0.5) / N - 0.5) * 2; // 0 center .. 1 edge
      const core = Math.exp(-(r * r) / 0.004);
      const halo = Math.exp(-(r * r) / 0.05) * 0.55;
      const tail = Math.exp(-r / 0.22) * 0.35;
      const edge = 1 - Math.min(1, Math.max(0, (r - 0.75) / 0.25));
      const a = Math.min(1, (core * 0.6 + halo + tail) * edge * edge);
      const i = (y * N + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.round(a * 255);
    }
  glowTex = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
  glowTex.minFilter = THREE.LinearMipmapLinearFilter;
  glowTex.magFilter = THREE.LinearFilter;
  glowTex.generateMipmaps = true;
  glowTex.needsUpdate = true;
  return glowTex;
};

export const GlowSprite: React.FC<{ p: V3; size: number; color: string; opacity?: number; depthTest?: boolean; renderOrder?: number }> = ({ p, size, color, opacity = 1, depthTest = true, renderOrder = 10 }) => {
  const mat = useMemo(
    () => new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }),
    [],
  );
  mat.color.set(color);
  mat.opacity = Math.min(1, Math.max(0, opacity));
  mat.depthTest = depthTest;
  if (opacity <= 0.005 || size <= 0) return null;
  return <sprite position={p} scale={[size, size, 1]} material={mat} renderOrder={renderOrder} />;
};
