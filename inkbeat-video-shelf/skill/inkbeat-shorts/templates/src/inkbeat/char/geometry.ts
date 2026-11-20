// Character geometry. Everything is built for a character of height h = 1 (soles to the top of the skull) from the
// numbers in family.ts; Character3D scales the root group by `height`. Head parts (head, ears, hair, hats, glasses)
// are head-local: origin at the head's widest row, before the per-character head scale. All builders are cached.
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  CHEEK_FULL,
  EAR,
  HEAD_BOT,
  HEAD_DEPTH,
  HEAD_EXP_CHIN,
  HEAD_EXP_TOP,
  HEAD_HW,
  HEAD_TOP,
  HEAD_WOBBLE,
  JAW_TAPER,
  SHOE,
  TORSO_DEPTH,
  TORSO_H,
  TORSO_R,
  TORSO_SHAPES,
} from "./family";
import type { TorsoKind } from "./family";

const D2R = Math.PI / 180;
export const sstep = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};
const hash = (n: number) => {
  const s = Math.sin(n * 91.7 + 47.3) * 24634.6345;
  return s - Math.floor(s);
};

// ------------------------------------------------------------------ helpers
/** Average normals across duplicated seam vertices (sphere / lathe seams, cap edges). */
export const smoothSeams = (g: THREE.BufferGeometry) => {
  g.computeVertexNormals();
  const p = g.attributes.position as THREE.BufferAttribute;
  const n = g.attributes.normal as THREE.BufferAttribute;
  const map = new Map<string, number[]>();
  for (let i = 0; i < p.count; i++) {
    const k = `${Math.round(p.getX(i) * 1e5)},${Math.round(p.getY(i) * 1e5)},${Math.round(p.getZ(i) * 1e5)}`;
    const a = map.get(k);
    if (a) a.push(i);
    else map.set(k, [i]);
  }
  const v = new THREE.Vector3();
  for (const ids of map.values()) {
    if (ids.length < 2) continue;
    v.set(0, 0, 0);
    for (const i of ids) v.add(new THREE.Vector3(n.getX(i), n.getY(i), n.getZ(i)));
    v.normalize();
    for (const i of ids) n.setXYZ(i, v.x, v.y, v.z);
  }
  n.needsUpdate = true;
  return g;
};

/** Geometry for an inverted hull: welded, smooth normals (hard edges get averaged normals). */
const hullCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
export const hullGeo = (g: THREE.BufferGeometry) => {
  const hit = hullCache.get(g);
  if (hit) return hit;
  const c = new THREE.BufferGeometry();
  c.setAttribute("position", (g.attributes.position as THREE.BufferAttribute).clone());
  if (g.index) c.setIndex(g.index.clone());
  const m = mergeVertices(c, 1e-4);
  m.computeVertexNormals();
  hullCache.set(g, m);
  return m;
};

// ------------------------------------------------------------------ head shape
export type HeadVariant = { seed: number; p1: number; p2: number; a1: number; a2: number };
export const headVariant = (seed: number): HeadVariant => ({
  seed,
  p1: hash(seed * 2.3 + 0.4) * Math.PI * 2,
  p2: hash(seed * 4.1 + 1.7) * Math.PI * 2,
  a1: HEAD_WOBBLE[0] + HEAD_WOBBLE[1] * hash(seed * 6.7 + 2.2),
  a2: HEAD_WOBBLE[2] + HEAD_WOBBLE[3] * hash(seed * 1.3 + 3.9),
});

/** Head surface point for a unit direction (head-local, origin at the widest row, +z = face). */
export const headPoint = (dx: number, dy: number, dz: number, hv: HeadVariant, out = new THREE.Vector3()) => {
  // superellipsoid: a rounded-square crown easing into a defined chin
  const n = HEAD_EXP_TOP + (HEAD_EXP_CHIN - HEAD_EXP_TOP) * sstep(0.05, -0.85, dy);
  const s = Math.pow(Math.pow(Math.abs(dx), n) + Math.pow(Math.abs(dy), n) + Math.pow(Math.abs(dz), n), -1 / n);
  let x = dx * s;
  let y = dy * s;
  let z = dz * s;
  const k = y > 0 ? HEAD_TOP : HEAD_BOT;
  const th = Math.atan2(y, x);
  const wob = 1 + hv.a1 * Math.sin(2 * th + hv.p1) + hv.a2 * Math.sin(4 * th + hv.p2);
  const low = sstep(0, -1, y); // 0 at the widest row, 1 at the chin
  const jaw = 1 - JAW_TAPER * low * low;
  const cheek = 1 + CHEEK_FULL * Math.exp(-Math.pow((y + 0.3) / 0.24, 2)) * Math.max(0, dz + 0.2);
  x *= HEAD_HW * wob * jaw * cheek;
  y *= HEAD_HW * k * wob;
  // the chin and jaw come forward a little; the back of the skull is fuller
  z *= HEAD_HW * HEAD_DEPTH * (1 + (wob - 1) * 0.4) * (1 - 0.1 * low * low) * (z < 0 ? 1.04 : 1);
  if (z > 0) z += HEAD_HW * 0.06 * low * sstep(0.3, 0.9, dz);
  return out.set(x, y, z);
};

const headCache = new Map<number, THREE.BufferGeometry>();
export const headGeo = (seed: number) => {
  const hit = headCache.get(seed);
  if (hit) return hit;
  const hv = headVariant(seed);
  const g = new THREE.SphereGeometry(1, 80, 60);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    // rotate the sphere seam (phi = 0 at -x) to the back of the head (-z)
    const x0 = p.getX(i);
    const z0 = p.getZ(i);
    headPoint(-z0, p.getY(i), x0, hv, v);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.deleteAttribute("uv");
  smoothSeams(g);
  headCache.set(seed, g);
  return g;
};

/** the head surface point in front of a face-plane point (x, y in hw, y up), found by a few fixed-point steps */
export const facePoint = (x: number, y: number, hv: HeadVariant) => {
  const tx = x * HEAD_HW;
  const ty = y * HEAD_HW;
  let dx = x;
  let dy = y;
  const v = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    const dz = Math.sqrt(Math.max(0.02, 1 - dx * dx - dy * dy));
    headPoint(dx, dy, dz, hv, v);
    dx *= v.x !== 0 ? Math.min(1.5, Math.max(0.5, tx / v.x)) : 1;
    dy *= v.y !== 0 ? Math.min(1.5, Math.max(0.5, ty / v.y)) : 1;
  }
  const dz = Math.sqrt(Math.max(0.02, 1 - dx * dx - dy * dy));
  return headPoint(dx, dy, dz, hv, new THREE.Vector3());
};

/** an ear: a flattened ellipsoid with a shallow bowl, placed on the side of the head */
const earCache = new Map<string, THREE.BufferGeometry>();
export const earGeo = (side: 1 | -1, seed: number) => {
  const key = side + "|" + seed;
  const hit = earCache.get(key);
  if (hit) return hit;
  const hv = headVariant(seed);
  const g = new THREE.SphereGeometry(1, 24, 18);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    // a shallow bowl on the outer face
    if (x > 0) x *= 0.5 + 0.5 * Math.min(1, (y * y + z * z) * 1.6);
    p.setXYZ(i, x * EAR.d * HEAD_HW, y * EAR.h * HEAD_HW * 0.5, z * EAR.w * HEAD_HW * 0.5);
  }
  g.deleteAttribute("uv");
  // built for the +x side: the top leans out, the outer face turns a little forward
  g.rotateZ(-0.12);
  g.rotateY(-0.25);
  if (side < 0) {
    g.scale(-1, 1, 1);
    const idx = g.index!;
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, a);
    }
  }
  const base = headPoint(side, EAR.y, -0.08, hv, new THREE.Vector3());
  g.translate(base.x + side * EAR.d * HEAD_HW * 0.1, base.y, base.z);
  smoothSeams(g);
  earCache.set(key, g);
  return g;
};

// ------------------------------------------------------------------ shells hugging the head (hair, beanie)
/** A shell between polar angles a0(th)..a1(th) (0 = top), th in [t0, t1] (0 = front, + toward +x).
 *  thick(s, th) = radial puff (fraction of the head radius) for s in 0..1 across the band. uv: u around, v 1 → 0. */
export const capGeo = (o: {
  seed: number;
  t0?: number;
  t1?: number;
  a0: (th: number) => number;
  a1: (th: number) => number;
  thick: (s: number, th: number) => number;
  nt?: number;
  na?: number;
}) => {
  const hv = headVariant(o.seed);
  const t0 = o.t0 ?? -Math.PI;
  const t1 = o.t1 ?? Math.PI;
  const nt = o.nt ?? 80;
  const na = o.na ?? 30;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i <= nt; i++) {
    const th = t0 + ((t1 - t0) * i) / nt;
    const a0 = o.a0(th);
    const a1 = o.a1(th);
    for (let j = 0; j <= na; j++) {
      const s = j / na;
      const a = a0 + (a1 - a0) * s;
      headPoint(Math.sin(a) * Math.sin(th), Math.cos(a), Math.sin(a) * Math.cos(th), hv, v);
      const f = 1 + o.thick(s, th);
      pos.push(v.x * f, v.y * f, v.z * f);
      uv.push(i / nt, 1 - s);
    }
  }
  for (let i = 0; i < nt; i++)
    for (let j = 0; j < na; j++) {
      const a = i * (na + 1) + j;
      const b = (i + 1) * (na + 1) + j;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return smoothSeams(g);
};

export type HairKind = "none" | "crop" | "swoop" | "curly" | "bob" | "bun" | "sides";
const fromFront = (th: number) => Math.abs(Math.atan2(Math.sin(th), Math.cos(th)));
const hairCache = new Map<string, THREE.BufferGeometry>();

/** Hair shell for a bare head. Tufts on the band give the silhouette (and its ink) a drawn, lumpy outline. */
export const hairGeo = (kind: HairKind, seed: number) => {
  const key = kind + "|" + seed;
  const hit = hairCache.get(key);
  if (hit) return hit;
  const ph = seed * 1.31;
  let g: THREE.BufferGeometry;
  if (kind === "sides") {
    // bald crown: a ring over the ears and around the back
    g = capGeo({
      seed,
      t0: Math.PI * 0.3,
      t1: Math.PI * 1.7,
      a0: (th) => (52 - 6 * sstep(1.6, 3.0, fromFront(th))) * D2R,
      a1: (th) => (96 + 18 * sstep(1.3, 2.8, fromFront(th)) + 2.5 * Math.sin(th * 7 + ph)) * D2R,
      thick: (s, th) => (0.05 + 0.018 * Math.pow(0.5 + 0.5 * Math.cos(th * 9 + ph), 2)) * Math.pow(Math.sin(Math.PI * s), 0.5) * sstep(1.0, 1.35, fromFront(th)) + 0.003,
      nt: 96,
      na: 26,
    });
  } else {
    const P = {
      crop: { front: 50, side: 92, back: 116, puff: 0.05, tuft: 0.02, freq: 6, bangs: 5 },
      swoop: { front: 46, side: 94, back: 118, puff: 0.07, tuft: 0.022, freq: 5, bangs: 0 },
      curly: { front: 44, side: 98, back: 120, puff: 0.085, tuft: 0.05, freq: 11, bangs: 7 },
      bob: { front: 46, side: 128, back: 134, puff: 0.08, tuft: 0.016, freq: 7, bangs: 3 },
      bun: { front: 40, side: 98, back: 112, puff: 0.05, tuft: 0.022, freq: 9, bangs: 0 },
      none: { front: 0, side: 0, back: 0, puff: 0, tuft: 0, freq: 1, bangs: 0 },
    }[kind];
    g = capGeo({
      seed,
      a0: () => 0,
      a1: (th) => {
        const f = fromFront(th);
        let a = P.front + (P.side - P.front) * sstep(0.35, 1.45, f) + (P.back - P.side) * sstep(1.9, 3.0, f);
        // bangs scallops across the forehead; the swoop dips on one side
        a += P.bangs * Math.abs(Math.sin(th * 5 + ph)) * (1 - sstep(0.6, 1.2, f));
        if (kind === "swoop") a += 13 * sstep(0.9, -0.1, th) * (1 - sstep(0.9, 1.4, f)) - 4 * sstep(0.0, 0.8, th) * (1 - sstep(0.8, 1.2, f));
        if (kind === "bob") a -= 10 * (1 - sstep(0.5, 1.0, f)); // bangs stay above the brows
        return (a + 2 * Math.sin(th * 3 + ph)) * D2R;
      },
      thick: (s, th) => {
        const f = fromFront(th);
        const body = P.puff * Math.pow(Math.sin(Math.PI * 0.5 + Math.PI * 0.5 * s), 0.6) * sstep(0, 0.12, 1 - s);
        const tuft = P.tuft * Math.pow(0.5 + 0.5 * Math.cos(s * Math.PI * (kind === "curly" ? 7 : 4) + th * P.freq + ph), 2.5) * sstep(0.03, 0.2, s) * (1 - sstep(0.7, 0.95, s));
        const sweep = kind === "swoop" ? 0.035 * sstep(0.2, -0.6, th) * (1 - sstep(1.0, 1.5, f)) * Math.sin(Math.PI * Math.min(1, s * 1.3)) : 0;
        const waves = kind === "bun" ? 0.028 * sstep(0.25, 1.0, f) * (1 - sstep(1.7, 2.5, f)) * Math.sin(Math.PI * Math.min(1, s * 1.15)) : 0;
        const part = kind === "bun" || kind === "bob" ? 1 - 0.75 * Math.exp(-Math.pow(th / 0.1, 2)) * (1 - sstep(0.25, 0.7, s)) * sstep(0.02, 0.12, s) : 1;
        return (body + tuft + sweep + waves) * part + 0.004;
      },
      nt: 128,
      na: 42,
    });
  }
  hairCache.set(key, g);
  return g;
};

/** the bun on top of a "bun" hairdo (head-local), a slightly squashed ball at the back of the crown */
export const bunGeo = (seed: number) => {
  const key = "bunball|" + seed;
  const hit = hairCache.get(key);
  if (hit) return hit;
  const hv = headVariant(seed);
  const at = headPoint(0, 0.72, -0.7, hv, new THREE.Vector3());
  const g = new THREE.SphereGeometry(HEAD_HW * 0.36, 28, 20);
  g.scale(1, 0.86, 0.9);
  g.translate(at.x, at.y + HEAD_HW * 0.1, at.z - HEAD_HW * 0.12);
  smoothSeams(g);
  hairCache.set(key, g);
  return g;
};

/** polar angle (deg from the top) where hair starts under each hat, just above the band's lower edge */
const HAT_HAIR_A0: Record<string, number> = { cap: 66, flat: 54, beanie: 74, sunhat: 60 };
/** hair under a hat: temples, over the ears, around the back to a soft nape; an ink line along its front edge and hem */
export const hattedHairGeo = (hat: string, kind: HairKind, seed: number) => {
  const key = "hatted|" + hat + "|" + kind + "|" + seed;
  const hit = hairCache.get(key);
  if (hit) return hit;
  const a0d = HAT_HAIR_A0[hat] ?? 62;
  const long = kind === "bob";
  const start = kind === "sides" ? 1.15 : 0.92;
  const a0 = () => a0d * D2R;
  const a1 = (th: number) => {
    const f = fromFront(th);
    const base = (long ? 122 : 86) + (long ? 12 : 32) * sstep(1.55, 2.8, f) + 4 * sstep(start, start + 0.4, f) * (1 - sstep(1.3, 1.9, f));
    return (base + 2.8 * Math.abs(Math.sin(th * 5 + seed * 1.3)) + 1.2 * Math.sin(th * 2 + seed)) * D2R;
  };
  const thick = (s: number, th: number) => {
    const f = fromFront(th);
    const puff = (kind === "curly" ? 0.058 : 0.05) + 0.014 * sstep(1.1, 1.6, f) * (1 - sstep(2.0, 2.6, f));
    const front = 0.5 + 0.5 * sstep(start, start + 0.2, f);
    return puff * sstep(0, 0.35, s) * (1 - 0.5 * sstep(0.7, 1, s)) * front + 0.003;
  };
  const t0 = start;
  const t1 = Math.PI * 2 - start;
  const g = capGeo({ seed, a0, a1, t0, t1, nt: 100, na: 24, thick });
  const hv = headVariant(seed);
  const v = new THREE.Vector3();
  const at = (th: number, s: number) => {
    const a = a0() + (a1(th) - a0()) * s;
    headPoint(Math.sin(a) * Math.sin(th), Math.cos(a), Math.sin(a) * Math.cos(th), hv, v);
    const k = 1 + thick(s, th) + 0.002;
    return new THREE.Vector3(v.x * k, v.y * k, v.z * k);
  };
  const line: THREE.Vector3[] = [];
  for (let j = 3; j <= 10; j++) line.push(at(t0 + 0.004, j / 10));
  for (let i = 1; i < 80; i++) line.push(at(t0 + ((t1 - t0) * i) / 80, 1));
  for (let j = 10; j >= 3; j--) line.push(at(t1 - 0.004, j / 10));
  g.userData.hem = line;
  hairCache.set(key, g);
  return g;
};
const hemCache = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
/** ink tube along a hatted hair shell's front edges and hem (head-local units) */
export const hairHemGeo = (hair: THREE.BufferGeometry, r = 0.0036) => {
  const hit = hemCache.get(hair);
  if (hit) return hit;
  const pts = hair.userData.hem as THREE.Vector3[] | undefined;
  if (!pts) return null;
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, "centripetal"), 260, r, 6, false);
  hemCache.set(hair, g);
  return g;
};

// ------------------------------------------------------------------ torso (lathe with a shaped cross-section)
export const torsoProfileAt = (t: number, kind: TorsoKind) => {
  if (t <= 0 || t >= 1) return 0;
  const P = TORSO_SHAPES[kind].profile;
  for (let i = 1; i < P.length; i++) {
    if (t <= P[i][0]) {
      const [t0, r0] = P[i - 1];
      const [t1, r1] = P[i];
      const u = (t - t0) / (t1 - t0);
      const k = (1 - Math.cos(u * Math.PI)) / 2; // cosine interpolation keeps the silhouette round
      return r0 + (r1 - r0) * k;
    }
  }
  return 0;
};

/** torso geometry for a kind and size; origin at the torso bottom (y = 0 … height) */
const torsoCache = new Map<string, THREE.BufferGeometry>();
export const torsoGeo = (kind: TorsoKind, width: number, depth: number, height: number) => {
  const key = [kind, width.toFixed(3), depth.toFixed(3), height.toFixed(3)].join("|");
  const hit = torsoCache.get(key);
  if (hit) return hit;
  const H = TORSO_H * height;
  const pts: THREE.Vector2[] = [];
  const N = 56;
  for (let i = 0; i <= N; i++) {
    const t = (1 - Math.cos((i / N) * Math.PI)) / 2; // denser near the round ends
    let r = torsoProfileAt(t, kind);
    if (i === 0 || i === N) r = 0.0001;
    pts.push(new THREE.Vector2(r * TORSO_R * width, t * H));
  }
  const g = new THREE.LatheGeometry(pts, 72, Math.PI, Math.PI * 2);
  // shaped cross-section: superellipse of the given exponent (2 = round)
  const ex = TORSO_SHAPES[kind].cross;
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-6) continue;
    const c = Math.abs(x / r);
    const s = Math.abs(z / r);
    const k = Math.pow(Math.pow(c, ex) + Math.pow(s, ex), -1 / ex);
    // squarer only through the middle; the rounded top and bottom stay round
    const t = p.getY(i) / H;
    const blend = sstep(0.02, 0.2, t) * (1 - sstep(0.86, 0.98, t));
    const f = 1 + (k - 1) * blend * 0.82;
    p.setX(i, x * f);
    p.setZ(i, z * f * TORSO_DEPTH * depth);
  }
  // uv.y = height fraction, so painted rows are true heights
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, p.getY(i) / H);
  smoothSeams(g);
  torsoCache.set(key, g);
  return g;
};

// ------------------------------------------------------------------ limbs, hands, shoes
/** a tube along points whose radius eases from r0 to r1; uv: u along, v around */
export const taperTube = (pts: THREE.Vector3[], r0: number, r1: number, seg = 32, radial = 14) => {
  const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
  const frames = curve.computeFrenetFrames(seg, false);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const u = i / seg;
    const c = curve.getPointAt(u);
    const r = r0 + (r1 - r0) * sstep(0, 1, u);
    const n = frames.normals[i];
    const b = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      pos.push(c.x + r * (ca * n.x + sa * b.x), c.y + r * (ca * n.y + sa * b.y), c.z + r * (ca * n.z + sa * b.z));
      uv.push(u, j / radial);
    }
  }
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = (i + 1) * (radial + 1) + j;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return smoothSeams(g);
};

export const sphere = (() => {
  let g: THREE.SphereGeometry | null = null;
  return () => (g ??= new THREE.SphereGeometry(1, 28, 20));
})();

/** a mitten hand: a slightly flattened ball (radius 1, scaled by the hand radius) */
export const handGeo = (() => {
  let g: THREE.BufferGeometry | null = null;
  return () => {
    if (g) return g;
    const s = new THREE.SphereGeometry(1, 28, 20);
    s.scale(0.92, 1.08, 0.82);
    g = smoothSeams(s);
    return g;
  };
})();

/** a cuff ring (sleeve end / pant hem): a short flared band around +y, radius 1 */
export const cuffGeo = (() => {
  let g: THREE.BufferGeometry | null = null;
  return () => {
    if (g) return g;
    const l = new THREE.LatheGeometry(
      [
        [0.82, -0.6],
        [1.0, -0.5],
        [1.06, 0],
        [1.0, 0.5],
        [0.82, 0.6],
      ].map(([r, y]) => new THREE.Vector2(r, y)),
      28,
    );
    g = smoothSeams(l);
    return g;
  };
})();

/** a small shoe (toe toward +z), origin under the ankle on the ground; the upper and the sole */
let shoeGeos: { upper: THREE.BufferGeometry; sole: THREE.BufferGeometry } | null = null;
export const shoeGeo = () => {
  if (shoeGeos) return shoeGeos;
  const u = new THREE.SphereGeometry(1, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.62);
  const p = u.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    let y = p.getY(i);
    const z = p.getZ(i);
    // a rounder, higher toe box and a lower heel
    const toe = sstep(-0.2, 0.9, z);
    y = Math.max(0, y) * (0.85 + 0.25 * (1 - toe)) + 0.0;
    p.setXYZ(i, x * SHOE.w * (1 + 0.12 * toe), y * SHOE.h + SHOE.sole * 0.6, z * SHOE.l + SHOE.fwd);
  }
  const upper = smoothSeams(u);
  const sh = new THREE.Shape();
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const toe = Math.sin(a) > 0 ? 1.1 : 1;
    const x = Math.cos(a) * SHOE.w * 1.06 * toe;
    const z = Math.sin(a) * SHOE.l * 1.04 + SHOE.fwd;
    if (i === 0) sh.moveTo(x, z);
    else sh.lineTo(x, z);
  }
  const sole = new THREE.ExtrudeGeometry(sh, { depth: SHOE.sole, bevelEnabled: true, bevelThickness: SHOE.sole * 0.25, bevelSize: SHOE.sole * 0.3, bevelSegments: 2, curveSegments: 8 });
  // shape y -> +z (toe forward), extrude depth -> -y; lift it onto the ground
  sole.rotateX(Math.PI / 2);
  sole.translate(0, SHOE.sole * 1.25, 0);
  sole.computeVertexNormals();
  shoeGeos = { upper, sole };
  return shoeGeos;
};

// ------------------------------------------------------------------ hats (head-local, before the head scale)
const lathe = (pts: [number, number][], seg = 64, zs = HEAD_DEPTH * 1.03) => {
  const g = new THREE.LatheGeometry(
    pts.map(([r, y]) => new THREE.Vector2(r, y)),
    seg,
    Math.PI,
    Math.PI * 2,
  );
  g.scale(1, 1, zs);
  return smoothSeams(g);
};

/** a curved bill in front; y = height of its root, len = how far it sticks out, droop = downward tilt (rad) */
export const billGeo = (y: number, len: number, rx: number, rz: number, droop: number, thick = 0.008, span = 70) => {
  const shape = new THREE.Shape();
  const n = 28;
  const A = span * D2R;
  for (let i = 0; i <= n; i++) {
    const a = -A + (2 * A * i) / n;
    const x = Math.sin(a) * rx * 1.03;
    const z = Math.cos(a) * (rz + len * Math.pow(Math.cos(a), 1.2));
    if (i === 0) shape.moveTo(x, z);
    else shape.lineTo(x, z);
  }
  for (let i = n; i >= 0; i--) {
    const a = -A + (2 * A * i) / n;
    shape.lineTo(Math.sin(a) * rx * 0.95, Math.cos(a) * rz * 0.9);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.4, bevelSize: thick * 0.5, bevelSegments: 2, curveSegments: 4 });
  g.rotateX(Math.PI / 2);
  g.translate(0, thick * 0.5, -rz * 0.9);
  // a slight side-to-side curve, like a worn cap bill
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) - 0.35 * Math.pow(p.getX(i) / (rx * 1.1), 2) * len * 0.35);
  g.rotateX(droop);
  g.translate(0, y, rz * 0.9);
  g.computeVertexNormals();
  return g;
};

export type HatPart = { geo: THREE.BufferGeometry; color: string; spec?: number; hull?: boolean; inkK?: number; cast?: boolean; rim?: number; tex?: "panels" | "rib" | "weave" | "tweed" | null };

const hatCache = new Map<string, HatPart[]>();
/** hat parts (geometry + color role). Color "hat" = the hat color, "band" = the band / accent color. */
export const hatParts = (hat: string, seed: number): HatPart[] => {
  const key = hat + "|" + seed;
  const hit = hatCache.get(key);
  if (hit) return hit;
  const parts: HatPart[] = [];
  const top = HEAD_TOP * HEAD_HW; // crown height above the widest row
  const R = HEAD_HW;
  switch (hat) {
    case "cap": {
      // a six-panel cap: a rounded crown, a top button, a long curved bill
      const c = new THREE.SphereGeometry(1, 64, 28, 0, Math.PI * 2, 0, Math.PI / 2);
      c.scale(R * 1.07, top * 0.98, R * 1.07 * HEAD_DEPTH * 1.04);
      c.translate(0, R * 0.36, -R * 0.02);
      parts.push({ geo: smoothSeams(c), color: "hat", spec: 0.25, hull: true, cast: true, tex: "panels" });
      parts.push({ geo: lathe([[R * 1.07, R * 0.3], [R * 1.09, R * 0.34], [R * 1.085, R * 0.44], [R * 1.06, R * 0.47]], 64, HEAD_DEPTH * 1.04 * 1.0), color: "band", spec: 0.15, hull: true });
      parts.push({ geo: billGeo(R * 0.34, R * 0.78, R * 1.06, R * 1.0, 0.16, 0.0075, 66), color: "hat", spec: 0.2, hull: true, cast: true });
      const b = new THREE.SphereGeometry(R * 0.085, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
      b.translate(0, R * 0.36 + top * 0.98 - R * 0.01, -R * 0.02);
      parts.push({ geo: b, color: "hat", spec: 0.2, hull: true, inkK: 0.6 });
      break;
    }
    case "flat": {
      // a flat cap: a low, wide crown pulled forward over a short stiff bill, a cloth button on top
      const c = new THREE.SphereGeometry(1, 48, 22, 0, Math.PI * 2, 0, Math.PI / 2);
      c.scale(R * 1.16, R * 0.5, R * 1.2);
      c.translate(0, R * 0.62, R * 0.04);
      c.rotateX(0.2);
      parts.push({ geo: smoothSeams(c), color: "hat", spec: 0.1, hull: true, cast: true, tex: "tweed" });
      parts.push({ geo: billGeo(R * 0.6, R * 0.42, R * 1.02, R * 1.02, 0.3, 0.0068, 54), color: "hat", spec: 0.1, hull: true, cast: true });
      const b = new THREE.SphereGeometry(R * 0.07, 12, 8);
      b.scale(1, 0.6, 1);
      b.translate(0, R * 1.12, R * 0.12);
      parts.push({ geo: b, color: "hat", hull: true, inkK: 0.6 });
      break;
    }
    case "beanie": {
      // a knit beanie hugging the head, a folded rib cuff, a pom-pom
      parts.push({
        geo: capGeo({ seed, a0: () => 0, a1: () => 74 * D2R, thick: (s) => 0.075 + 0.05 * (1 - s) * (1 - s), nt: 72, na: 24 }),
        color: "hat",
        spec: 0.05,
        hull: true,
        cast: true,
        tex: "rib",
      });
      parts.push({
        geo: capGeo({ seed, a0: () => 60 * D2R, a1: () => 80 * D2R, thick: (s) => 0.12 + 0.02 * Math.sin(Math.PI * s), nt: 72, na: 10 }),
        color: "hat",
        spec: 0.05,
        hull: true,
        cast: true,
        tex: "rib",
      });
      const pom = new THREE.IcosahedronGeometry(R * 0.26, 3);
      const pp = pom.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pp.count; i++) {
        const v = new THREE.Vector3(pp.getX(i), pp.getY(i), pp.getZ(i));
        const k = 1 + 0.09 * Math.sin(v.x * 140) * Math.sin(v.y * 150) * Math.sin(v.z * 130);
        pp.setXYZ(i, v.x * k, v.y * k, v.z * k);
      }
      pom.translate(0, top * 1.12 + R * 0.26, 0);
      parts.push({ geo: smoothSeams(mergeVertices(pom)), color: "band", spec: 0, hull: true, inkK: 0.7, cast: true });
      break;
    }
    case "sunhat": {
      // a soft sun hat: a rounded crown, a ribbon band, a wide brim that dips a little
      parts.push({
        geo: lathe([[R * 0.98, R * 0.36], [R * 1.0, R * 0.6], [R * 0.96, R * 0.92], [R * 0.82, R * 1.18], [R * 0.5, R * 1.3], [0, R * 1.33]]),
        color: "hat",
        spec: 0.08,
        hull: true,
        cast: true,
        tex: "weave",
      });
      parts.push({ geo: lathe([[R * 1.005, R * 0.37], [R * 1.02, R * 0.4], [R * 1.02, R * 0.56], [R * 1.0, R * 0.6]]), color: "band", spec: 0.25, hull: true });
      const brim: [number, number][] = [];
      for (let i = 0; i <= 10; i++) {
        const s = i / 10;
        brim.push([R * (0.97 + 0.95 * s), R * (0.4 - 0.2 * s * s)]);
      }
      for (let i = 10; i >= 0; i--) {
        const s = i / 10;
        brim.push([R * (0.97 + 0.95 * s), R * (0.4 - 0.2 * s * s) + R * 0.05]);
      }
      parts.push({ geo: lathe(brim, 72, HEAD_DEPTH * 1.08), color: "hat", spec: 0.05, hull: true, cast: true, tex: "weave", rim: 0 });
      break;
    }
    default:
      break;
  }
  hatCache.set(key, parts);
  return parts;
};

// ------------------------------------------------------------------ glasses (head-local)
/** round wire glasses: two rims, a bridge and temple arms, sitting just in front of the eyes */
export const glassesGeo = (seed: number, eyeX: number, eyeY: number) => {
  const key = "glasses|" + seed + "|" + eyeX + "|" + eyeY;
  const hit = hairCache.get(key);
  if (hit) return hit;
  const hv = headVariant(seed);
  const geos: THREE.BufferGeometry[] = [];
  const rimR = HEAD_HW * 0.2;
  const wire = HEAD_HW * 0.014;
  const centers: THREE.Vector3[] = [];
  for (const s of [-1, 1]) {
    const p = facePoint(s * eyeX, -eyeY, hv);
    p.z += HEAD_HW * 0.1;
    centers.push(p);
    const t = new THREE.TorusGeometry(rimR, wire, 8, 36);
    t.scale(1, 0.86, 1);
    t.rotateY(s * 0.16);
    t.translate(p.x, p.y, p.z);
    geos.push(t);
  }
  const bridge = new THREE.CatmullRomCurve3([
    centers[0].clone().add(new THREE.Vector3(rimR * 0.98, rimR * 0.2, 0)),
    new THREE.Vector3(0, centers[0].y + rimR * 0.42, centers[0].z + HEAD_HW * 0.04),
    centers[1].clone().add(new THREE.Vector3(-rimR * 0.98, rimR * 0.2, 0)),
  ]);
  geos.push(new THREE.TubeGeometry(bridge, 16, wire * 0.9, 6, false));
  for (const [i, s] of [[0, -1], [1, 1]] as [number, number][]) {
    const c = centers[i];
    const ear = headPoint(s, EAR.y + 0.05, -0.1, hv, new THREE.Vector3());
    const arm = new THREE.CatmullRomCurve3([
      c.clone().add(new THREE.Vector3(s * rimR, rimR * 0.15, -wire)),
      new THREE.Vector3(c.x + s * rimR * 1.6, c.y + rimR * 0.2, c.z - HEAD_HW * 0.35),
      new THREE.Vector3(ear.x * 1.06, ear.y + HEAD_HW * 0.06, ear.z * 0.5 + c.z * 0.15),
      new THREE.Vector3(ear.x * 1.04, ear.y + HEAD_HW * 0.02, ear.z),
    ]);
    geos.push(new THREE.TubeGeometry(arm, 20, wire * 0.8, 6, false));
  }
  const merged = mergeGeos(geos);
  hairCache.set(key, merged);
  return merged;
};

/** concatenate non-indexed / indexed geometries (position + normal only) */
export const mergeGeos = (geos: THREE.BufferGeometry[]) => {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const g0 of geos) {
    const g = g0;
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position as THREE.BufferAttribute;
    const n = g.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + base);
    else for (let i = 0; i < p.count; i++) idx.push(i + base);
    base += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
};
