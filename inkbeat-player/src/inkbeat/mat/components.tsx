// React components of the mat/ module.
import React from "react";
import * as THREE from "three";
import type { V3 } from "../types";
import { TexKind, toonMaterial } from "./materials";

export { SkyDome } from "./sky";
export type { SkyDomeProps } from "./sky";
export { GlowSprite, glowTexture } from "./glow";

export type ToonMeshProps = {
  p?: V3;
  r?: V3;
  s?: V3 | number;
  color: string;
  tex?: TexKind;
  texScale?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  children: React.ReactElement; // geometry
  // extras
  mapping?: "box" | "uv";
  emissive?: string;
  emissiveIntensity?: number;
  side?: THREE.Side;
  opacity?: number;
  seed?: number;
  renderOrder?: number;
  name?: string;
};

/** A mesh with the cached soft-toon material. Textures use object-space box mapping by default, so they keep
 * real-world density on any box/cylinder/sphere without UV work (texScale 2 = denser). */
export const ToonMesh: React.FC<ToonMeshProps> = ({ p, r, s, color, tex, texScale, castShadow = true, receiveShadow = true, children, mapping, emissive, emissiveIntensity, side, opacity, seed, renderOrder, name }) => (
  <mesh
    position={p}
    rotation={r}
    scale={s as never}
    castShadow={castShadow}
    receiveShadow={receiveShadow}
    renderOrder={renderOrder}
    name={name}
    material={toonMaterial({ color, tex, texScale, mapping, emissive, emissiveIntensity, side, opacity, transparent: opacity !== undefined && opacity < 1, seed })}
  >
    {children}
  </mesh>
);
