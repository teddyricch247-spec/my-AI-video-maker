// objects/tree.js: prebuilt toon tree. makeTree(opts) -> { group, parts, update(t), meta, ...api }.
// Metres, origin = ground contact at the trunk centre, +y up, ~3.9 m tall at scale 1 (opts.height rescales). Pure function of t.
//   tree.grow(fn|number)     scale over time: a number, or t => 0..1+ (use backOut for a springy sprout)
//   tree.hits(times, dir)    impact times (s) and push direction [x,z] (world, e.g. the car's heading): the tree sways and sheds leaves
//   tree.update(t)           call every frame (or let a scene call it)
// Collision: meta.trunkRadius (m, at scale 1), meta.canopyBottom. Leaves that fall stay on the ground (12 per hit, deterministic).
import * as THREE from 'three';
import { inkMesh } from './character.js';
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const ball = (a = 22, b = 16) => new THREE.SphereGeometry(1, a, b);
export const TREE_STYLES = {
  round: { trunk: 0x8a5a33, leaves: [0x3dbb4c, 0x34a845, 0x4ccb58], blobs: [[0, 2.95, 0, 1.3, 0], [0.85, 2.5, 0.3, 0.85, 1], [-0.85, 2.55, -0.2, 0.9, 1], [0.2, 3.55, 0.1, 0.85, 2], [-0.2, 2.6, 0.85, 0.8, 0], [0.3, 2.5, -0.85, 0.8, 1]] },
  autumn: { trunk: 0x7a4b2a, leaves: [0xf2a33a, 0xe4572e, 0xffc857], blobs: [[0, 2.95, 0, 1.3, 0], [0.85, 2.5, 0.3, 0.85, 1], [-0.85, 2.55, -0.2, 0.9, 1], [0.2, 3.55, 0.1, 0.85, 2], [-0.2, 2.6, 0.85, 0.8, 0], [0.3, 2.5, -0.85, 0.8, 1]] },
  tall: { trunk: 0x8a5a33, leaves: [0x2f9e5a, 0x278a4c, 0x3fb86b], blobs: [[0, 2.6, 0, 0.95, 0], [0, 3.5, 0, 0.8, 2], [0.1, 4.3, 0, 0.6, 0], [0.55, 2.3, 0.2, 0.6, 1], [-0.55, 2.4, -0.1, 0.65, 1]] },
};
export function makeTree(opts = {}) {
  const st = TREE_STYLES[opts.style || 'round'], H = (opts.height ?? 3.9) / 3.9;
  const group = new THREE.Group(); group.name = 'tree'; const body = new THREE.Group(); group.add(body); body.scale.setScalar(H);
  const parts = {};
  const trunk = inkMesh(new THREE.CylinderGeometry(0.17, 0.27, 2.1, 14, 1, true), opts.trunk ?? st.trunk, 1); trunk.position.y = 1.05; body.add(trunk); parts.trunk = trunk;
  parts.canopy = [];
  for (const [x, y, z, r, c] of st.blobs) { const b = inkMesh(ball(), opts.leaves?.[c] ?? st.leaves[c], 1.1); b.scale.setScalar(r); b.position.set(x, y, z); body.add(b); parts.canopy.push(b); }
  const leaves = [];
  for (let h = 0; h < 8; h++) for (let i = 0; i < 12; i++) { const m = new THREE.Mesh(ball(8, 6), new THREE.MeshToonMaterial({ color: st.leaves[i % 2 ? 0 : 2], gradientMap: trunk.userData.mesh.material.gradientMap })); m.scale.set(0.13, 0.025, 0.08); m.visible = false; group.add(m); leaves.push({ m, h, i: i + h * 20 }); }
  let growFn = () => 1, hitT = [], push = [0, 1];
  const api = {
    group, parts, leaves,
    grow(f) { growFn = typeof f === 'function' ? f : () => f; return api; },
    hits(times, dir = [0, 1]) { hitT = times.slice(0, 8); const n = Math.hypot(dir[0], dir[1]) || 1; push = [dir[0] / n, dir[1] / n]; return api; },
    update(t) {
      body.scale.setScalar(H * Math.max(0.001, growFn(t)));
      let tx = 0, tz = 0; for (const th of hitT) { const d = t - th; if (d >= 0) { const a = 0.085 * Math.exp(-3.5 * d) * Math.sin(2 * Math.PI * 3.1 * d); tx += a * push[1]; tz += a * -push[0]; } }
      body.rotation.set(tx, 0, tz);
      for (const L of leaves) {
        const th = hitT[L.h], d = th === undefined ? -1 : t - th - 0.05; if (d < 0) { L.m.visible = false; continue; }
        const y0 = (2.2 + hash(L.i * 2.1) * 1.5) * H, ang = hash(L.i * 3.7) * 6.283, r0 = (0.3 + hash(L.i * 5.9) * 1.0) * H, y = Math.max(0.05, y0 - (d * 1.1 + d * d * 1.6)), air = y > 0.05 ? 1 : 0;
        const sway = air ? 0.5 * Math.sin(3.2 * d + L.i) : 0.5 * Math.sin(3.2 * (y0 / 2.6) + L.i);
        L.m.visible = true; L.m.position.set(Math.cos(ang) * (r0 + d * 0.7) + sway * 0.4, y, Math.sin(ang) * (r0 + d * 0.7)); L.m.rotation.set(air * (3 * d + L.i), L.i, air * 2.2 * d);
      }
    },
    meta: { name: 'tree', kind: 'prop', size_m: { height: 3.9 * H, canopyRadius: 1.6 * H }, trunkRadius: 0.22 * H, canopyBottom: 1.7 * H, styles: Object.keys(TREE_STYLES) },
  };
  api.update(0); return api;
}
