// Small building blocks for sets and props (toon materials; everything a pure function of t).
import React from "react";
import * as THREE from "three";
import { toonMaterial } from "../mat/materials";
import type { TexKind } from "../mat/materials";

import type { V3 } from "../types";
export type { V3 };

// ------------------------------------------------------------------ bounded caches (never keyed by Object3D.id)
const geoCache = new Map<string, THREE.BufferGeometry>();
const geo = (key: string, make: () => THREE.BufferGeometry) => {
  let g = geoCache.get(key);
  if (!g) {
    if (geoCache.size > 300) geoCache.clear();
    g = make();
    geoCache.set(key, g);
  }
  return g;
};
export const boxG = (w: number, h: number, d: number) => geo(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
export const cylG = (rt: number, rb: number, h: number, n = 24, open = false, a0 = 0, arc = Math.PI * 2) =>
  geo(`c${rt}|${rb}|${h}|${n}|${open}|${a0}|${arc}`, () => new THREE.CylinderGeometry(rt, rb, h, n, 1, open, a0, arc));
export const sphG = (r: number, n = 24) => geo(`s${r}|${n}`, () => new THREE.SphereGeometry(r, n, Math.max(8, Math.round(n * 0.6))));
export const coneG = (r: number, h: number, n = 16) => geo(`k${r}|${h}|${n}`, () => new THREE.ConeGeometry(r, h, n));
export const torG = (r: number, t: number, arc = Math.PI * 2) => geo(`t${r}|${t}|${arc}`, () => new THREE.TorusGeometry(r, t, 10, 28, arc));

type MP = { p?: V3; r?: V3; s?: V3 | number; c: string; tex?: TexKind; ts?: number; e?: string; ei?: number; cast?: boolean; recv?: boolean; op?: number; side?: THREE.Side };
const mat = (o: MP) => toonMaterial({ color: o.c, tex: o.tex, texScale: o.ts, emissive: o.e, emissiveIntensity: o.ei, transparent: o.op !== undefined && o.op < 1, opacity: o.op, side: o.side });
/** a toon-shaded mesh */
export const M: React.FC<MP & { g: THREE.BufferGeometry }> = ({ g, p, r, s, cast = true, recv = true, ...o }) => (
  <mesh geometry={g} material={mat(o)} position={p} rotation={r} scale={s} castShadow={cast} receiveShadow={recv} />
);
/** an unlit HDR core (lamp bulb, flame, glowing window): > 1.0 blooms */
const coreCache = new Map<string, THREE.MeshBasicMaterial>();
export const coreMat = (col: string, k: number, op = 1) => {
  const key = `${col}|${k.toFixed(2)}|${op.toFixed(2)}`;
  let m = coreCache.get(key);
  if (!m) {
    if (coreCache.size > 200) coreCache.clear();
    const c = new THREE.Color(col).multiplyScalar(k);
    m = new THREE.MeshBasicMaterial({ color: c, toneMapped: false, transparent: op < 1, opacity: op, depthWrite: op >= 1 });
    coreCache.set(key, m);
  }
  return m;
};

// ------------------------------------------------------------------ text tags (sound-off readability: 1–3 word tags on KEY objects only, unlit)
const texCache = new Map<string, THREE.CanvasTexture>();
export const canvasTex = (key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) => {
  let t = texCache.get(key);
  if (!t) {
    if (texCache.size > 120) texCache.clear();
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d")!, w, h);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    texCache.set(key, t);
  }
  return t;
};
const labelMats = new Map<string, THREE.Material>();
/** a bold painted text panel (lit, so it sits in the set's light); bg "none" = transparent paint on the surface */
export const Label: React.FC<{ text: string; p: V3; r?: V3; w: number; h: number; fg?: string; bg?: string; font?: number; stamp?: boolean }> = ({ text, p, r, w, h, fg = "#1a1416", bg = "#f4ead6", font = 0.62, stamp }) => {
  const key = `${text}|${fg}|${bg}|${w}|${h}|${font}|${stamp ? 1 : 0}`;
  let m = labelMats.get(key);
  if (!m) {
    if (labelMats.size > 80) labelMats.clear();
    const W = 1024;
    const H = Math.max(64, Math.round((W * h) / w));
    const tex = canvasTex(`L${key}`, W, H, (g) => {
      if (bg !== "none") {
        g.fillStyle = bg;
        g.fillRect(0, 0, W, H);
      }
      g.fillStyle = fg;
      g.textAlign = "center";
      g.textBaseline = "middle";
      let fs = H * font;
      g.font = `800 ${fs}px Poppins`;
      while (g.measureText(text).width > W * 0.9 && fs > 10) {
        fs *= 0.94;
        g.font = `800 ${fs}px Poppins`;
      }
      g.fillText(text, W / 2, H / 2 + fs * 0.04);
      if (stamp) {
        g.strokeStyle = fg;
        g.lineWidth = H * 0.07;
        g.strokeRect(H * 0.08, H * 0.08, W - H * 0.16, H - H * 0.16);
      }
    });
    // paint on a surface (bg "none": stamps, stencils, signs) is unlit at its true color so no key light can wash it out;
    // a label with its own background stays lit (it sits in the set's light). Cut-out (alphaTest), NOT transparent: a
    // transparent label skips the depth buffer and shows THROUGH anything in front of it (a prop, a character).
    // no mipmaps: a cut-out label's alpha would fall under the alphaTest at a distance and the text would vanish
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    m = bg === "none" ? new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 }) : new THREE.MeshToonMaterial({ map: tex });
    labelMats.set(key, m);
  }
  return (
    <mesh position={p} rotation={r} material={m} receiveShadow userData={{ outline: false }}>
      <planeGeometry args={[w, h]} />
    </mesh>
  );
};

// liquids: see core/liquid.tsx (thickLiquidMaterial, LiquidWave, LiquidPour, LiquidPool)

// ------------------------------------------------------------------ fire + smoke (deterministic flicker)
const h1 = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
/** a cartoon flame: three nested teardrops (sphere + cone tip), saturated cores ≤ 1.0 so the grade never burns them
 * to cream; wobbling with t */
const Drop: React.FC<{ r: number; col: string; k: number; p: V3; sc: V3 }> = ({ r, col, k, p, sc }) => (
  <group position={p} scale={sc}>
    <mesh geometry={sphG(r, 20)} material={coreMat(col, k)} />
    <mesh geometry={coneG(r * 0.98, r * 2.4, 20)} material={coreMat(col, k)} position={[0, r * 1.18, 0]} />
  </group>
);
export const Flame: React.FC<{ p: V3; s?: number; t: number; seed?: number }> = ({ p, s = 1, t, seed = 0 }) => {
  const w = (k: number) => 1 + 0.1 * Math.sin(t * (9 + k) + seed * 3.1 + k);
  return (
    <group position={p} scale={s}>
      <Drop r={0.42} col="#e8300a" k={0.8} p={[0, 0.42, 0]} sc={[w(1), w(0) * 1.05, w(2)]} />
      <Drop r={0.3} col="#ff7a10" k={0.9} p={[0.04, 0.34, 0.12]} sc={[w(4), w(3), w(4)]} />
      <Drop r={0.17} col="#ffc21a" k={1.0} p={[0, 0.24, 0.26]} sc={[1, w(5), 1]} />
      <pointLight position={[0, 0.9, 0.4]} color="#ff7a20" intensity={6 * s * w(6)} distance={6 * s} decay={2} />
    </group>
  );
};
/** rising smoke puffs (dark, soft, no ink at distance) */
export const Smoke: React.FC<{ p: V3; s?: number; t: number; seed?: number; n?: number; color?: string }> = ({ p, s = 1, t, seed = 0, n = 5, color = "#8a7a84" }) => (
  <group position={p} scale={s}>
    {Array.from({ length: n }, (_, i) => {
      const u = (t * 0.18 + i / n + h1(seed + i) * 0.1) % 1;
      return <M key={i} g={sphG(0.6, 16)} c={color} p={[Math.sin(i * 2.3 + seed) * 0.4 + u * 1.2, u * 6, Math.cos(i * 1.7) * 0.3]} s={0.35 + u * 1.2} cast={false} />;
    })}
  </group>
);
export { h1 };
