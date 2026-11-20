// Thick liquids (mud, lava, oil, paint, tar, goo).
// A big liquid mass reads as "liquid" only with ALL of these; any one missing and it reads as a wall, a cone or a dome:
//   1. a dark floor: the material marks its pixels (scene alpha 0.4) and the grade skips most of the mood lift there,
//      so near-black stays near-black instead of turning mid plum-brown;
//   2. glossy specular: small, hard-edged (banded) highlights broken up by flow ridges, plus slow glossy streaks;
//   2b. a thin-edge glow: where the liquid is seen at a grazing angle (lips, crests, the edge of a pour) it is thin
//      and the light comes through it, so it turns a warm translucent `edge` color instead of staying black;
//   3. a shape that moves: a rolling front with a thicker curled lip, a hollow under it, churning bulges along the
//      width, drips falling off the lip, a toe that runs ahead; a pour that bulges as it flows;
//   4. settling: `settle` 0..1 lowers and spreads every mass (a wave becomes a sheet, a pour becomes a pool).
// Modifies three.js shader chunks (MIT, (c) three.js authors); see THIRD_PARTY_NOTICES.md
import React, { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { V3 } from "../types";

// ------------------------------------------------------------------ material
let streakTex: THREE.CanvasTexture | null = null;
const streaks = () => {
  if (streakTex) return streakTex;
  const W = 256;
  const H = 512;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, W, H);
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9; i++) {
    const x0 = rnd() * W;
    const w = 1.5 + rnd() * 3;
    const a = 0.2 + rnd() * 0.45;
    const grd = g.createLinearGradient(0, 0, 0, H);
    const y0 = rnd();
    grd.addColorStop(0, `rgba(255,236,200,0)`);
    grd.addColorStop(Math.min(0.95, y0 * 0.5 + 0.1), `rgba(255,236,200,${a})`);
    grd.addColorStop(Math.min(0.98, y0 * 0.5 + 0.45), `rgba(255,236,200,${a * 0.7})`);
    grd.addColorStop(1, `rgba(255,236,200,0)`);
    g.strokeStyle = grd;
    g.lineWidth = w;
    g.lineCap = "round";
    g.beginPath();
    for (let y = 0; y <= H; y += 16) {
      const x = x0 + Math.sin(y * 0.02 + i) * 6;
      if (y === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  streakTex = new THREE.CanvasTexture(c);
  streakTex.wrapS = streakTex.wrapT = THREE.RepeatWrapping;
  streakTex.colorSpace = THREE.SRGBColorSpace;
  return streakTex;
};

const matCache = new Map<string, THREE.MeshPhongMaterial>();
/** a glossy dark liquid. `flow` scrolls the gloss streaks (pass time × speed; all liquids in a frame share it). */
/** `edgeK`: strength of the thin-edge glow (0.9 for big masses; less on thin shapes like a pour, where most of the
 * visible surface is at a grazing angle and the whole shape would turn the edge color) */
export const thickLiquidMaterial = (o: { color?: string; glint?: string; edge?: string; edgeK?: number; specK?: number; streak?: number; flow?: number; spec?: boolean } = {}) => {
  const color = o.color ?? "#3a2a3a";
  const glint = o.glint ?? "#ffd8b0";
  const spec = o.spec ?? true;
  // the thin-edge color: the body color, much brighter and a little more saturated (pass `edge` to set it)
  const edge = o.edge ?? "#" + new THREE.Color(color).offsetHSL(0, 0.15, 0.22).getHexString();
  const edgeK = o.edgeK ?? 0.9;
  const specK = o.specK ?? 1;
  const key = `${color}|${glint}|${edge}|${edgeK}|${specK}|${o.streak ?? 0.32}|${spec}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshPhongMaterial({ color, specular: spec ? new THREE.Color(glint).multiplyScalar(specK) : "#000000", shininess: 22, emissive: glint, emissiveMap: streaks(), emissiveIntensity: o.streak ?? 0.32 });
    const uFlow = { value: 0 };
    const uEdge = { value: new THREE.Color(edge).multiplyScalar(edgeK) };
    m.userData.uFlow = uFlow;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uFlow = uFlow;
      sh.uniforms.uEdge = uEdge;
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uFlow;\nuniform vec3 uEdge;")
        .replace(
          "#include <emissivemap_fragment>",
          `#ifdef USE_EMISSIVEMAP
  vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv + vec2( 0.0, uFlow ) );
  totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,
        )
        // a soft broad sheen (a hard toon band breaks into square blobs on a curved, ridged surface and reads as windows)
        .replace(
          "#include <aomap_fragment>",
          `{ float sl = max( max( reflectedLight.directSpecular.r, reflectedLight.directSpecular.g ), reflectedLight.directSpecular.b );
  reflectedLight.directSpecular = specular * smoothstep( 0.05, 0.9, sl ) * 0.75;
  float rimF = 1.0 - max( dot( normal, normalize( vViewPosition ) ), 0.0 );
  // thin edges glow with the translucent edge color (soft), the very silhouette gets a thin wet highlight (hard)
  totalEmissiveRadiance += uEdge * smoothstep( 0.45, 0.85, rimF );
  reflectedLight.directSpecular += specular * smoothstep( 0.86, 0.9, rimF ) * 0.6; }
#include <aomap_fragment>`,
        )
        // liquid marker for the grade (see post/shaders.ts uLiq)
        .replace("#include <dithering_fragment>", "#include <dithering_fragment>\n  gl_FragColor.a = 0.4;");
    };
    m.customProgramCacheKey = () => "thick-liquid-2";
    if (matCache.size > 40) matCache.clear();
    matCache.set(key, m);
  }
  (m.userData.uFlow as { value: number }).value = o.flow ?? 0;
  return m;
};

/** dispose a per-frame geometry when it is replaced */
const useGeo = (make: () => THREE.BufferGeometry, deps: unknown[]) => {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const g = useMemo(make, deps);
  useEffect(() => () => g.dispose(), [g]);
  return g;
};

// ------------------------------------------------------------------ the rolling wave
const WAVE_PROFILE: [number, number][] = [
  [-1.4, 0], [-0.9, 0.18], [-0.45, 0.55], [-0.12, 0.88], [0.12, 1.0], [0.38, 0.96], [0.56, 0.84],
  [0.62, 0.7], [0.58, 0.57], [0.46, 0.52], [0.34, 0.58], [0.24, 0.6], [0.14, 0.5], [0.12, 0.34],
  [0.2, 0.16], [0.42, 0.05], [0.66, 0],
];
/** a rolling front: height h, width w, facing +z (yaw it). settle 0..1 lowers and spreads it. */
export const LiquidWave: React.FC<{ p: V3; w: number; h: number; t: number; yaw?: number; seed?: number; settle?: number; color?: string; glint?: string; edge?: string; drips?: number; splash?: number }> = ({ p, w, h, t, yaw = 0, seed = 1, settle = 0, color, glint, edge, drips = 5, splash = 8 }) => {
  const tq = Math.round(t * 60) / 60;
  const geo = useGeo(() => {
    const sh = new THREE.Shape();
    sh.moveTo(WAVE_PROFILE[0][0], WAVE_PROFILE[0][1]);
    sh.splineThru(WAVE_PROFILE.slice(1).map(([x, y]) => new THREE.Vector2(x, y)));
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 1, steps: 140, curveSegments: 80, bevelEnabled: false });
    const pos = g.attributes.position as THREE.BufferAttribute;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      const X = (0.5 - pz) * w; // (0.5 - pz): swapping two axes mirrors the mesh; negating one keeps the faces outward
      const e = Math.min(1, Math.abs(X) / (w / 2));
      const k = 1 - 0.6 * e * e * e;
      let Y = py * h * k;
      let Z = px * h * (0.75 + 0.25 * k);
      // churn along the width: the front bulges and the crest rises and falls, rolling slowly
      const yk = Y / h;
      Y += h * 0.05 * Math.sin(X * 0.8 + seed + tq * 1.1) * yk;
      Z += h * 0.07 * Math.sin(X * 0.5 - tq * 0.7 + seed * 2) * yk;
      // flow ridges running straight down the face (no change with height): the gloss stretches into long vertical
      // streaks, which is what reads as "liquid"; short bumps would catch the light as square blobs instead
      const ridge = Math.sin(X * 3.1 + Math.sin(X * 0.9 + seed) * 1.6 - tq * 0.4) + 0.35 * Math.sin(X * 6.7 + seed * 2);
      Z += h * 0.012 * ridge * Math.sin(Math.PI * Math.min(1, yk * 1.1));
      Y *= 1 - 0.88 * settle;
      Z *= 1 + 0.7 * settle;
      pos.setXYZ(i, X, Y, Z);
      uv[i * 2] = X * 0.18;
      uv[i * 2 + 1] = yk * 1.4 - (Z / h) * 0.35;
    }
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  }, [w, h, seed, settle, tq]);
  const m = thickLiquidMaterial({ color, glint, edge, flow: -t * 0.05 });
  const md = thickLiquidMaterial({ color, glint, edge, flow: -t * 0.05, spec: false });
  // flying droplets are thin all through, so they take the translucent edge color (a dark droplet reads as a speck)
  const edgeCol = edge ?? "#" + new THREE.Color(color ?? "#3a2a3a").offsetHSL(0, 0.15, 0.22).getHexString();
  const mDrop = thickLiquidMaterial({ color: edgeCol, glint, edge: glint, flow: -t * 0.05 }); // drips: no highlight (a lit blob reads as an eye)
  return (
    <group position={p} rotation={[0, yaw, 0]}>
      <mesh geometry={geo} material={m} castShadow receiveShadow />
      {/* drips falling off the lip, slowly */}
      {settle < 0.5
        ? Array.from({ length: drips }, (_, i) => {
            const X = (-0.4 + (0.8 * (i + 0.5)) / drips) * w + Math.sin(i * 7.3 + seed) * 0.3;
            const ph = (t * 0.45 + i * 0.37 + seed * 0.11) % 1;
            const y = h * (0.55 - ph * 0.5);
            const s = h * (0.015 + 0.008 * ((i * 13) % 3));
            return <mesh key={i} geometry={dropG} material={md} position={[X, y, h * 0.6]} scale={[s, s * (1.6 + ph * 1.4), s]} castShadow />;
          })
        : null}
      {/* splash: small droplets thrown forward and up off the crest on slow arcs */}
      {settle < 0.5
        ? Array.from({ length: splash }, (_, i) => {
            const X = (-0.45 + (0.9 * (i + 0.5)) / splash) * w + Math.sin(i * 3.7 + seed) * 0.4;
            const ph = (t * 0.6 + i * 0.29 + seed * 0.07) % 1;
            const z = h * (0.62 + ph * 0.35);
            const y = h * (0.9 + ph * 0.25 - ph * ph * 0.55);
            const s = h * (0.014 + 0.008 * ((i * 7) % 3)) * (1 - ph * 0.4);
            return <mesh key={`s${i}`} geometry={dropG} material={mDrop} position={[X, y, z]} scale={s} />;
          })
        : null}
    </group>
  );
};
const dropG = new THREE.SphereGeometry(1, 16, 12);

// ------------------------------------------------------------------ a pour (a stream from a spout or off a ledge)
/** a thick stream from `from` to `to`, arching by `arch` (m, up), radius r0 -> r1, bulges flowing along it */
export const LiquidPour: React.FC<{ from: V3; to: V3; r0: number; r1: number; t: number; arch?: number; out?: V3; color?: string; glint?: string; edge?: string }> = ({ from, to, r0, r1, t, arch = 1, out, color, glint, edge }) => {
  const tq = Math.round(t * 60) / 60;
  const geo = useGeo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const c = out ? new THREE.Vector3(...out) : a.clone().lerp(b, 0.35).add(new THREE.Vector3(0, arch, 0));
    const curve = new THREE.QuadraticBezierCurve3(a, c, b);
    const TS = 120;
    const RS = 20;
    const g = new THREE.TubeGeometry(curve, TS, 1, RS, false);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const P = new THREE.Vector3();
    for (let i = 0; i <= TS; i++) {
      const u = i / TS;
      curve.getPointAt(u, P);
      const r = (r0 + (r1 - r0) * u * u) * (1 + 0.06 * Math.sin(u * 22 - tq * 3.2)) * (1 + 0.5 * Math.max(0, u - 0.88) / 0.12);
      for (let j = 0; j <= RS; j++) {
        const k = i * (RS + 1) + j;
        const v = new THREE.Vector3(pos.getX(k), pos.getY(k), pos.getZ(k)).sub(P).multiplyScalar(r).add(P);
        pos.setXYZ(k, v.x, v.y, v.z);
        uv.setXY(k, (j / RS) * 2, u * 3);
      }
    }
    g.computeVertexNormals();
    return g;
  }, [from.join(), to.join(), r0, r1, arch, out?.join(), tq]);
  // a pour is a thin curved tube: most of it faces the light at some angle, so its sheen and edge glow are kept low
  const m = thickLiquidMaterial({ color, glint, edge, edgeK: 0.3, specK: 0.3, streak: 0.12, flow: -t * 0.35 });
  return (
    <group>
      <mesh geometry={geo} material={m} castShadow receiveShadow />
      <mesh geometry={dropG} material={m} position={from} scale={r0 * 1.05} />
    </group>
  );
};

// ------------------------------------------------------------------ a pool / sheet with a thick rolling rim
/** a spreading pool: radius r, depth d, a thick rounded rim (the advancing front), lobed outline. settle spreads it. */
export const LiquidPool: React.FC<{ p: V3; r: number; d?: number; t: number; seed?: number; settle?: number; sx?: number; sz?: number; color?: string; glint?: string; edge?: string }> = ({ p, r, d = 0.12, t, seed = 1, settle = 0, sx = 1, sz = 1, color, glint, edge }) => {
  const tq = Math.round(t * 30) / 30;
  const geo = useGeo(() => {
    const R = r * (1 + 0.5 * settle);
    const D = d * (1 - 0.5 * settle);
    const prof = [
      new THREE.Vector2(0.0001, D),
      new THREE.Vector2(R * 0.6, D),
      new THREE.Vector2(R * 0.82, D * 1.15),
      new THREE.Vector2(R * 0.93, D * 1.55),
      new THREE.Vector2(R * 0.99, D * 1.2),
      new THREE.Vector2(R, D * 0.5),
      new THREE.Vector2(R * 0.97, 0),
    ];
    // a lathe profile must run rim -> center (bottom -> top) or its faces point down and the pool is culled from above
    const g = new THREE.LatheGeometry(prof.reverse(), 72);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const a = Math.atan2(z, x);
      const f = 1 + 0.12 * Math.sin(3 * a + seed) + 0.07 * Math.sin(7 * a - seed * 1.7 + tq * 0.4);
      const rr = Math.hypot(x, z);
      const y = pos.getY(i) + (rr < R * 0.7 ? Math.sin(rr * 5 - tq * 1.5) * D * 0.08 : 0);
      pos.setXYZ(i, x * f * sx, y, z * f * sz);
    }
    g.computeVertexNormals();
    return g;
  }, [r, d, seed, settle, sx, sz, tq]);
  // a flat sheet is seen at a grazing angle almost everywhere: a strong edge glow would turn the whole pool amber
  const m = thickLiquidMaterial({ color, glint, edge, edgeK: 0.18, specK: 0.7, flow: -t * 0.03 });
  return <mesh geometry={geo} material={m} position={p} receiveShadow castShadow />;
};
