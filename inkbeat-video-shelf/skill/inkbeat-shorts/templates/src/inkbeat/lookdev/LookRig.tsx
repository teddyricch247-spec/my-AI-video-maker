// Scene-side half of a look: global lights, fog, toon tint and sky from a LookPreset (see presets.ts).
// Practical lights stay in the sets; use look.lights.practical / .window as their recommended values.
import React from "react";
import * as THREE from "three";
import { setToonLook } from "../mat/materials";
import { SkyDome } from "../mat/components";
import type { V3 } from "../types";
import { LookPreset, skyProps } from "./presets";

const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Push the look's toon tint into the shared toon-material uniforms (call during render). */
export const applyToon = (look: LookPreset) => setToonLook({ ...look.toon });

/**
 * Hemisphere floor + shadow-casting key + rim + fill + FogExp2, and the toon tint.
 * `center` = middle of the shadowed area (the subject), `extent` = half-size of the key's shadow box (m).
 */
export const LookLights: React.FC<{ look: LookPreset; center?: V3; extent?: number; fog?: boolean }> = ({ look, center = [0, 0, 0], extent = 16, fog = true }) => {
  applyToon(look);
  const L = look.lights;
  const kd = norm(L.key.dir);
  const rd = norm(L.rim.dir);
  const fd = norm(L.fill.dir);
  const D = 60;
  const at = (d: V3): V3 => [center[0] + d[0] * D, center[1] + d[1] * D, center[2] + d[2] * D];
  const target = React.useMemo(() => new THREE.Object3D(), []);
  target.position.set(...center);
  target.updateMatrixWorld();
  // the shadow box props only reach the shadow camera's fields: three rebuilds its projection once, when the shadow
  // map is created, so without this the box stays at the FIRST rendered frame's extent (per render tab → frames
  // shaded differently by whichever tab drew them)
  const keyRef = React.useRef<THREE.DirectionalLight>(null);
  React.useLayoutEffect(() => {
    const l = keyRef.current;
    if (!l) return;
    const c = l.shadow.camera;
    c.left = -extent;
    c.right = extent;
    c.top = extent;
    c.bottom = -extent;
    c.near = 1;
    c.far = D * 2 + extent;
    c.updateProjectionMatrix();
  });
  return (
    <>
      <primitive object={target} />
      <hemisphereLight args={[L.hemi.sky, L.hemi.ground, L.hemi.intensity]} color={L.hemi.sky} groundColor={L.hemi.ground} intensity={L.hemi.intensity} />
      {L.key.intensity > 0.001 ? (
        <directionalLight
          ref={keyRef}
          position={at(kd)}
          target={target}
          color={L.key.color}
          intensity={L.key.intensity}
          castShadow={L.key.castShadow}
          shadow-mapSize-width={L.key.mapSize}
          shadow-mapSize-height={L.key.mapSize}
          shadow-camera-left={-extent}
          shadow-camera-right={extent}
          shadow-camera-top={extent}
          shadow-camera-bottom={-extent}
          shadow-camera-near={1}
          shadow-camera-far={D * 2 + extent}
          shadow-bias={L.key.shadowBias}
          shadow-normalBias={L.key.shadowNormalBias}
        />
      ) : null}
      {L.rim.intensity > 0.001 ? <directionalLight position={at(rd)} target={target} color={L.rim.color} intensity={L.rim.intensity} /> : null}
      {L.fill.intensity > 0.001 ? <directionalLight position={at(fd)} target={target} color={L.fill.color} intensity={L.fill.intensity} /> : null}
      {fog ? <fogExp2 attach="fog" args={[look.fog.color, look.fog.density]} color={look.fog.color} density={look.fog.density} /> : null}
    </>
  );
};

/** SkyDome driven by look.sky. Extra SkyDome props (cloudSeed, cloudStyle…) can be passed through. */
export const LookSky: React.FC<{ look: LookPreset; t: number; cloudSeed?: number; cloudStyle?: "mixed" | "puffy" | "streak" }> = ({ look, t, cloudSeed, cloudStyle }) => (
  <SkyDome {...skyProps(look, t)} cloudSeed={cloudSeed} cloudStyle={cloudStyle} />
);
