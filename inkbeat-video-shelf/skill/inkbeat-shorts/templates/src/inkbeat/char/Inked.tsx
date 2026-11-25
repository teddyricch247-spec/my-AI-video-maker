// A lit mesh plus its inverted-hull ink outline.
import React from "react";
import * as THREE from "three";
import { hullGeo } from "./geometry";
import { hullMat } from "./material";

export type InkedProps = {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  ink?: number; // hull width in character units (h = 1); 0 = no hull
  under?: number; // extra hull width on the underside (0.5 = 1.5x under the chin)
  cast?: boolean;
  receive?: boolean;
  position?: [number, number, number] | THREE.Vector3;
  rotation?: [number, number, number];
  quaternion?: THREE.Quaternion;
  scale?: number | [number, number, number];
  renderOrder?: number;
};

export const Inked: React.FC<InkedProps> = ({ geo, mat, ink = 0.007, under = 0.5, cast = true, receive = true, position, rotation, quaternion, scale, renderOrder }) => (
  <group position={position} rotation={rotation} quaternion={quaternion} scale={scale}>
    <mesh geometry={geo} material={mat} castShadow={cast} receiveShadow={receive} renderOrder={renderOrder} />
    {ink > 0 ? <mesh geometry={hullGeo(geo)} material={hullMat(ink, under)} /> : null}
  </group>
);
