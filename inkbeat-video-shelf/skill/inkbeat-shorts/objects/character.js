// objects/character.js: the inkbeat character. ONE body (BODY) for the whole cast; a character is only
// look = skin + hair + face + outfit.  Contract: makeCharacter(opts) -> {group, parts, sockets, update(t), act(weights,t), ...}
// Units metres, origin = ground between the feet, faces +z, every pose is a PURE function of t (no Math.random/Date).
// Numbers come from templates/src/inkbeat/char/family.ts (h = 1 = soles to top of skull, scaled by `height`).
import * as THREE from 'three';
import { INK, outlineUniforms, toon } from '../pipeline/lib/toon.js';

const V3 = THREE.Vector3, Q = THREE.Quaternion;
const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const hash = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }; // seeded, deterministic

// ------------------------------------------------------------------ family numbers (family.ts)
export const FAMILY = {
  HEAD_HW: 0.135, HEAD_TOP: 1.06, HEAD_BOT: 1.2, HEAD_DEPTH: 0.94, JAW_TAPER: 0.22, CHEEK_FULL: 0.045,
  NECK_LEN: 0.035, NECK_R: 0.044, TORSO_TUCK: 0.012, TORSO_H: 0.29, TORSO_R: 0.14, TORSO_DEPTH: 0.72,
  SHOULDER_T: 0.83, SHOULDER_IN: 0.78, HIP_T: 0.11, HIP_X: 0.4,
  UPPER_ARM: 0.125, FOREARM: 0.112, ARM_R: [0.026, 0.021], LEG_R: [0.034, 0.027], HAND_R: 0.031, THUMB: 0.44,
  ANKLE_Y: 0.05, FOOT_X: 0.44, SHOE: { w: 0.03, h: 0.042, l: 0.058, fwd: 0.022, sole: 0.011 },
  EYE_X: 0.36, EYE_Y: -0.03, NOSE_Y: 0.3, MOUTH_Y: 0.62, FACE_SPAN: 1.3,
};
const F = FAMILY;
const TORSO_PROFILE = [[0, 0], [0.035, 0.66], [0.11, 0.86], [0.3, 0.88], [0.55, 0.93], [0.76, 1.0], [0.88, 0.97], [0.95, 0.74], [1, 0]];
const TORSO_CROSS = 2.9;

/** THE body. Every character of the cast shares this; only `look` differs. (Adult, stocky-toon, ~1.65 m.) */
export const BODY = { headScale: 1.05, torsoWidth: 1.02, torsoDepth: 1.0, torsoHeight: 0.82, limb: 1.15, armLength: 1.05, hand: 1.1, neck: 1.0 };

// ink thickness multipliers per part (family.ts INK_PARTS, a bit heavier: characters carry more ink than the set)
const INKK = { head: 1.2, hair: 0.95, torso: 1.15, limb: 0.8, hand: 0.8, shoe: 1.0, ear: 0.7, prop: 0.9 };

// ------------------------------------------------------------------ ink + material helpers
const hullCache = new Map();
function hullMat(k) {
  const key = k.toFixed(2);
  if (!hullCache.has(key)) {
    hullCache.set(key, new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { uPx: outlineUniforms.uPx, uInk: { value: new THREE.Color(INK) }, uK: { value: k } },
      vertexShader: `uniform vec2 uPx; uniform float uK; void main(){ vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.);
        vec3 n=normalize(normalMatrix*normal); vec2 d=(projectionMatrix*vec4(n,0.)).xy; d=length(d)>1e-5?normalize(d):vec2(0.);
        p.xy+=d*uPx*uK*p.w; gl_Position=p; }`,
      fragmentShader: `uniform vec3 uInk; void main(){
 gl_FragColor=vec4(uInk,1.);
 #include <colorspace_fragment>
}`,
    }));
  }
  return hullCache.get(key);
}
/** toon mesh + ink hull. k = ink multiplier (0 = no ink). Returns a Group (group.userData.mesh = the visible mesh). */
export function inkMesh(geo, color, k = 1, { shadow = true } = {}) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(geo, toon(color)); m.castShadow = shadow; m.receiveShadow = true; g.add(m); g.userData.mesh = m;
  if (k > 0) g.add(new THREE.Mesh(geo, hullMat(k)));
  return g;
}

// ------------------------------------------------------------------ geometry helpers (smooth, welded, outward-facing)
function weld(geo) {
  const p = geo.attributes.position, map = new Map(), pos = [], remap = new Uint32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const key = Math.round(x * 1e5) + ',' + Math.round(y * 1e5) + ',' + Math.round(z * 1e5);
    let j = map.get(key); if (j === undefined) { j = pos.length / 3; map.set(key, j); pos.push(x, y, z); } remap[i] = j;
  }
  const src = geo.index, n = src ? src.count : p.count, out = [];
  for (let i = 0; i < n; i += 3) {
    const a = remap[src ? src.getX(i) : i], b = remap[src ? src.getX(i + 1) : i + 1], c = remap[src ? src.getX(i + 2) : i + 2];
    if (a !== b && b !== c && a !== c) out.push(a, b, c);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(out);
  g.computeVertexNormals();
  // make sure normals point away from the shape's centre (lathe winding depends on point order)
  const nrm = g.attributes.normal, pp = g.attributes.position; let s = 0;   // outward = away from the vertical axis (every shape here is built around y)
  for (let i = 0; i < pp.count; i++) s += nrm.getX(i) * pp.getX(i) + nrm.getZ(i) * pp.getZ(i);
  if (s < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.computeVertexNormals(); }
  return g;
}
/** the egg head: crown radius, jaw radius, taper to a chin, fuller cheeks. Centre = origin. Optionally a partial shell. */
function eggGeo(hw, { top = F.HEAD_TOP, bot = F.HEAD_BOT, depth = F.HEAD_DEPTH, thetaLen = Math.PI, seg = 44 } = {}) {
  const g = new THREE.SphereGeometry(1, seg, Math.round(seg * 0.7), 0, TAU, 0, thetaLen), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let X = x, Y = y * (y >= 0 ? top : bot), Z = z * depth;
    if (y < 0) { const k = Math.pow(-y, 1.6); X *= 1 - F.JAW_TAPER * k; Z *= 1 - F.JAW_TAPER * 0.6 * k; }
    const cf = Math.exp(-Math.pow((y + 0.2) / 0.28, 2)); X *= 1 + F.CHEEK_FULL * cf;
    p.setXYZ(i, X * hw, Y * hw, Z * hw);
  }
  return weld(g);
}
/** tapered capsule hanging from y=0 (top cap centre) to y=-len (bottom cap centre): arms, legs */
function tube(r0, r1, len, seg = 16) {
  const pts = [], n = 6;
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI / 2; pts.push(new THREE.Vector2(Math.sin(a) * r1, -len - Math.cos(a) * r1)); } // bottom cap, ascending
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI / 2; pts.push(new THREE.Vector2(Math.cos(a) * r0, Math.sin(a) * r0)); }        // top cap
  return weld(new THREE.LatheGeometry(pts, seg));
}
function ball(r = 1, w = 20, h = 14) { return weld(new THREE.SphereGeometry(r, w, h)); }
function hermite(tab, t) {
  const n = tab.length; let i = 0; while (i < n - 2 && t > tab[i + 1][0]) i++;
  const [t0, r0] = tab[i], [t1, r1] = tab[i + 1];
  const m = (j) => { const a = tab[Math.max(j - 1, 0)], b = tab[Math.min(j + 1, n - 1)]; return (b[1] - a[1]) / (b[0] - a[0] || 1); };
  const h = t1 - t0, s = clamp((t - t0) / h, 0, 1), s2 = s * s, s3 = s2 * s;
  return Math.max(0, (2 * s3 - 3 * s2 + 1) * r0 + (s3 - 2 * s2 + s) * h * m(i) + (-2 * s3 + 3 * s2) * r1 + (s3 - s2) * h * m(i + 1));
}
function squarify(g, n, depthK) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), z = p.getZ(i); const r = Math.hypot(x, z); if (r < 1e-6) continue;
    const a = Math.atan2(x, z), rho = Math.pow(Math.pow(Math.abs(Math.sin(a)), n) + Math.pow(Math.abs(Math.cos(a)), n), -1 / n);
    p.setXYZ(i, x * rho, p.getY(i), z * rho * depthK);
  }
}
/** the torso shell (or a band / front wedge of it, for clothing details). Origin = torso bottom. */
function torsoGeo(R, TH, depthK, { t0 = 0, t1 = 1, inflate = 0, constant = false, phi = null, seg = 44 } = {}) {
  const pts = [], N = Math.max(6, Math.round(52 * (t1 - t0)));
  for (let i = 0; i <= N; i++) {
    const u = i / N, t = lerp(t0, t1, u);
    let r = hermite(TORSO_PROFILE, t) * R * (1 + inflate * (constant ? 1 : Math.sin(Math.PI * u)));
    pts.push(new THREE.Vector2(Math.max(r, 1e-4), t * TH));
  }
  const g = phi ? new THREE.LatheGeometry(pts, 14, -phi, phi * 2) : new THREE.LatheGeometry(pts, seg);
  squarify(g, TORSO_CROSS, depthK);
  return weld(g);
}
const torusGeo = (R, r, seg = 28) => new THREE.TorusGeometry(R, r, 8, seg);

// ------------------------------------------------------------------ face (a canvas decal on a shell that hugs the head)
const FACE_PX = 512, SC = FACE_PX / (2 * F.FACE_SPAN); // px per head half-width
const EXPR = {
  neutral: { mouth: 'smile', raise: 0, tilt: 0, open: 1, squint: 0 },
  happy: { mouth: 'grin', raise: 0.12, tilt: 0.05, open: 0.92, squint: 0.3 },
  shocked: { mouth: 'O', raise: 0.55, tilt: 0, open: 1.15, squint: 0, pupil: 0.72 },
  sad: { mouth: 'frown', raise: 0.05, tilt: -0.4, open: 0.85, squint: 0 },
  angry: { mouth: 'grit', raise: -0.14, tilt: 0.5, open: 0.8, squint: 0.1 },
  worried: { mouth: 'wavy', raise: 0.2, tilt: -0.45, open: 0.95, squint: 0 },
};
export const EXPRESSIONS = Object.keys(EXPR);

function drawFace(c, st, fs) {
  const ctx = c.getContext('2d'); ctx.clearRect(0, 0, FACE_PX, FACE_PX);
  const X = (v) => FACE_PX / 2 + v * SC, Y = (v) => FACE_PX / 2 + v * SC;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const ink = '#2a1442', lw = (v) => Math.max(1.5, v * SC);
  const e = EXPR[st.expr] || EXPR.neutral;
  // blush + freckles
  if (fs.blush > 0) for (const s of [-1, 1]) {
    const g = ctx.createRadialGradient(X(s * 0.58), Y(0.38), 0, X(s * 0.58), Y(0.38), 0.24 * SC);
    g.addColorStop(0, `rgba(236,100,110,${0.55 * fs.blush})`); g.addColorStop(1, 'rgba(236,100,110,0)');
    ctx.fillStyle = g; ctx.fillRect(X(s * 0.58) - 0.3 * SC, Y(0.38) - 0.3 * SC, 0.6 * SC, 0.6 * SC);
  }
  if (fs.freckles) { ctx.fillStyle = 'rgba(90,50,30,0.55)'; for (let s = -1; s <= 1; s += 2) for (let i = 0; i < 7; i++) {
    const a = hash(i * 3 + fs.seed) , b = hash(i * 7 + fs.seed + 1); ctx.beginPath(); ctx.arc(X(s * (0.38 + a * 0.3)), Y(0.22 + b * 0.2), 0.018 * SC, 0, TAU); ctx.fill(); } }
  // eyes
  const eyeOpen = clamp(e.open * (1 - st.blink) * (1 - e.squint * 0.45), 0, 1.3);
  for (const s of [-1, 1]) {
    const cx = s * F.EYE_X, cy = F.EYE_Y, rx = fs.eyeRX, ry = fs.eyeRY * eyeOpen;
    if (eyeOpen < 0.16) { // closed: a curved lash line
      ctx.strokeStyle = ink; ctx.lineWidth = lw(0.05); ctx.beginPath(); ctx.moveTo(X(cx - rx), Y(cy + 0.02)); ctx.quadraticCurveTo(X(cx), Y(cy + 0.1), X(cx + rx), Y(cy + 0.02)); ctx.stroke();
    } else {
      ctx.save(); ctx.beginPath(); ctx.ellipse(X(cx), Y(cy), rx * SC, ry * SC, 0, 0, TAU); ctx.clip();
      ctx.fillStyle = '#fbfbf5'; ctx.fillRect(X(cx - rx), Y(cy - ry), rx * 2 * SC, ry * 2 * SC);
      const ix = cx + st.look[0] * rx * 0.42, iy = cy + st.look[1] * ry * 0.35 + 0.015, ir = fs.irisR * (e.pupil ? 0.92 : 1);
      ctx.fillStyle = fs.eyeColor; ctx.beginPath(); ctx.ellipse(X(ix), Y(iy), ir * SC, ir * 1.28 * SC * Math.min(1, eyeOpen + 0.15), 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#1b1020'; ctx.beginPath(); ctx.ellipse(X(ix), Y(iy), ir * (e.pupil || 0.5) * SC, ir * (e.pupil || 0.5) * 1.28 * SC, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(X(ix - ir * 0.32), Y(iy - ir * 0.5), ir * 0.3 * SC, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.beginPath(); ctx.arc(X(ix + ir * 0.4), Y(iy + ir * 0.55), ir * 0.14 * SC, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = ink; ctx.lineWidth = lw(0.026); ctx.beginPath(); ctx.ellipse(X(cx), Y(cy), rx * SC, ry * SC, 0, 0, TAU); ctx.stroke();
      // heavy upper lid
      ctx.lineWidth = lw(0.05); ctx.beginPath(); ctx.ellipse(X(cx), Y(cy), rx * SC, ry * SC, 0, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
      if (fs.lash) { ctx.lineWidth = lw(0.04); ctx.beginPath(); ctx.moveTo(X(cx + s * rx * 0.92), Y(cy - ry * 0.3)); ctx.lineTo(X(cx + s * (rx + 0.1)), Y(cy - ry * 0.62)); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(X(cx + s * rx * 0.7), Y(cy - ry * 0.7)); ctx.lineTo(X(cx + s * (rx + 0.04)), Y(cy - ry * 1.0)); ctx.stroke(); }
      if (e.squint > 0.1) { ctx.fillStyle = fs.skinShade; ctx.globalAlpha = 0.55; ctx.beginPath(); ctx.ellipse(X(cx), Y(cy + ry * 1.0), rx * 1.05 * SC, ry * 0.5 * SC, 0, 0, Math.PI); ctx.fill(); ctx.globalAlpha = 1; }
    }
    // brows: inner end is toward x = 0; tilt > 0 pulls the inner end down (angry), < 0 up (sad / worried)
    const by = cy - 0.36 - e.raise * 0.22, half = 0.2 * fs.browLen, inX = cx - s * half, outX = cx + s * half;
    const inY = by + e.tilt * 0.12, outY = by - e.tilt * 0.07 + fs.browAngle;
    ctx.strokeStyle = fs.browColor; ctx.lineWidth = lw(0.062 * fs.browThick);
    ctx.beginPath(); ctx.moveTo(X(inX), Y(inY)); ctx.quadraticCurveTo(X(cx), Y((inY + outY) / 2 - 0.06 - fs.browArch), X(outX), Y(outY)); ctx.stroke();
  }
  // mouth
  const my = F.MOUTH_Y, mw = fs.mouthW;
  const talk = st.open;
  ctx.strokeStyle = ink; ctx.fillStyle = '#5b1e2e'; ctx.lineWidth = lw(0.045);
  const mouthShape = (w, h, topCurve) => { ctx.beginPath(); ctx.moveTo(X(-w), Y(my - 0.02)); ctx.quadraticCurveTo(X(0), Y(my - 0.02 + topCurve), X(w), Y(my - 0.02));
    ctx.quadraticCurveTo(X(w * 0.6), Y(my + h), X(0), Y(my + h * 1.05)); ctx.quadraticCurveTo(X(-w * 0.6), Y(my + h), X(-w), Y(my - 0.02)); ctx.closePath(); };
  const teeth = (w, h) => { ctx.save(); ctx.clip(); ctx.fillStyle = '#f8f8f2'; ctx.fillRect(X(-w), Y(my - 0.04), w * 2 * SC, h * SC); ctx.fillStyle = '#e2727c'; ctx.beginPath(); ctx.ellipse(X(0), Y(my + h * 2.4), w * 0.6 * SC, h * 1.5 * SC, 0, 0, TAU); ctx.fill(); ctx.restore(); };
  let shape = e.mouth;
  if (talk > 0.08 && shape !== 'O') shape = 'talk';
  if (shape === 'smile') { ctx.beginPath(); ctx.moveTo(X(-mw * 0.8), Y(my - 0.03)); ctx.quadraticCurveTo(X(0), Y(my + 0.14), X(mw * 0.8), Y(my - 0.03)); ctx.stroke(); }
  else if (shape === 'grin') { mouthShape(mw, 0.2, 0.03); ctx.fill(); teeth(mw, 0.075); mouthShape(mw, 0.2, 0.03); ctx.stroke(); }
  else if (shape === 'talk') { const h = 0.05 + talk * 0.24; mouthShape(mw * (0.8 + 0.18 * (1 - talk)), h, 0.03); ctx.fill(); teeth(mw, Math.min(0.07, h * 0.4)); mouthShape(mw * (0.8 + 0.18 * (1 - talk)), h, 0.03); ctx.stroke(); }
  else if (shape === 'O') { ctx.beginPath(); ctx.ellipse(X(0), Y(my + 0.07), 0.1 * SC, 0.14 * SC, 0, 0, TAU); ctx.fill(); ctx.stroke(); }
  else if (shape === 'frown') { ctx.beginPath(); ctx.moveTo(X(-mw * 0.7), Y(my + 0.1)); ctx.quadraticCurveTo(X(0), Y(my - 0.06), X(mw * 0.7), Y(my + 0.1)); ctx.stroke(); }
  else if (shape === 'grit') { ctx.beginPath(); ctx.rect(X(-mw * 0.75), Y(my - 0.01), mw * 1.5 * SC, 0.11 * SC); ctx.fillStyle = '#f8f8f2'; ctx.fill(); ctx.stroke();
    ctx.lineWidth = lw(0.02); ctx.beginPath(); for (let i = -2; i <= 2; i++) { ctx.moveTo(X(i * mw * 0.3), Y(my - 0.01)); ctx.lineTo(X(i * mw * 0.3), Y(my + 0.1)); } ctx.stroke(); }
  else if (shape === 'wavy') { ctx.beginPath(); ctx.moveTo(X(-mw * 0.7), Y(my + 0.05)); for (let i = 1; i <= 6; i++) ctx.lineTo(X(-mw * 0.7 + (mw * 1.4 * i) / 6), Y(my + 0.05 + (i % 2 ? -0.03 : 0.03))); ctx.stroke(); }
  if (fs.dimple && (shape === 'smile' || shape === 'grin')) { ctx.lineWidth = lw(0.03); for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(X(s * (mw * 0.95)), Y(my - 0.04), 0.04 * SC, Math.PI * (s > 0 ? 1.1 : 1.9), Math.PI * (s > 0 ? 1.9 : 1.1), s < 0); ctx.stroke(); } }
}

// ------------------------------------------------------------------ hair
function darker(hex, k = 0.7) { const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString(); }
function hairCap(hw, color, { cover = 0.49, tilt = 0.5, grow = 1.07 } = {}) {
  const g = inkMesh(eggGeo(hw * grow, { thetaLen: Math.PI * cover }), color, INKK.hair, { shadow: false }); g.rotation.x = -tilt; return g;
}
function swoopHair(hw, c) {
  const G = new THREE.Group(); G.add(hairCap(hw, c.hair, { cover: 0.5, tilt: 0.52 }));
  const q = inkMesh(ball(1), c.hair, INKK.hair, { shadow: false }); q.scale.set(0.62 * hw, 0.38 * hw, 0.95 * hw); q.position.set(0.28 * hw, 0.86 * hw, 0.42 * hw); q.rotation.set(-0.32, -0.28, -0.42); G.add(q);   // the quiff
  const q2 = inkMesh(ball(1), c.hair, INKK.hair, { shadow: false }); q2.scale.set(0.42 * hw, 0.28 * hw, 0.6 * hw); q2.position.set(-0.3 * hw, 0.9 * hw, 0.3 * hw); q2.rotation.set(-0.2, 0.3, 0.5); G.add(q2);
  const back = inkMesh(ball(1, 28, 18), c.hair, INKK.hair, { shadow: false }); back.scale.set(1.02 * hw, 0.84 * hw, 0.88 * hw); back.position.set(0, 0.1 * hw, -0.2 * hw); G.add(back); // hair over the back of the head
  for (const s of [-1, 1]) { const sb = inkMesh(ball(1), c.hair, INKK.hair, { shadow: false }); sb.scale.set(0.13 * hw, 0.3 * hw, 0.2 * hw); sb.position.set(s * 0.98 * hw, 0.18 * hw, 0.05 * hw); G.add(sb); } // sideburns
  return G;
}
function puffHair(hw, c) {
  const G = new THREE.Group(); G.add(hairCap(hw, c.hair, { cover: 0.46, tilt: 0.42, grow: 1.06 }));
  const spots = [[0, 1.12, -0.22, 0.78], [0.62, 1.0, -0.2, 0.52], [-0.62, 1.0, -0.2, 0.52], [0.9, 0.62, -0.28, 0.42], [-0.9, 0.62, -0.28, 0.42], [0.35, 1.32, -0.35, 0.46],
    [-0.35, 1.32, -0.35, 0.46], [0, 0.55, -0.98, 0.58], [0.55, 0.45, -0.8, 0.44], [-0.55, 0.45, -0.8, 0.44], [0, 1.45, 0.0, 0.42]];
  for (const [x, y, z, r] of spots) { const s = inkMesh(ball(1, 18, 12), c.hair, INKK.hair, { shadow: false }); s.scale.setScalar(r * hw); s.position.set(x * hw, y * hw, z * hw); G.add(s); }
  const band = inkMesh(torusGeo(hw * 0.9, hw * 0.07, 40), c.accent, 0.6, { shadow: false }); band.rotation.x = Math.PI / 2 + 0.28; band.position.set(0, 0.56 * hw, -0.04 * hw); band.scale.set(1, 0.93, 1); G.add(band); // headband hugging the head above the brows
  return G;
}
const HAIR_STYLES = { swoop: swoopHair, puff: puffHair };

// ------------------------------------------------------------------ the character factory
export function makeCharacter(opts = {}) {
  const look = opts.look || {}, B = { ...BODY, ...(opts.build || {}) }, K = opts.height ?? 1.65, name = opts.name || 'char';
  const skin = look.skin || '#d39a72', O = { top: '#2e8a86', inner: '#efe6d2', bottom: '#3b3d46', shoes: '#6e2e2a', sole: '#e8d6a8', trim: '#e8d6a8', style: 'jacket', ...(look.outfit || {}) };
  const H = { style: 'swoop', color: '#3d2a22', accent: '#c94a3a', ...(look.hair || {}) };
  const FS = { eyeColor: '#3a2a24', eyeRX: 0.15, eyeRY: 0.19, irisR: 0.11, lash: false, blush: 0.3, freckles: false, browThick: 1, browLen: 1, browAngle: 0, browArch: 0, mouthW: 0.24, nose: 1, noseLen: 1, dimple: false, seed: 1, ...(look.face || {}) };
  FS.browColor = FS.browColor || darker(H.color, 0.75); FS.skinShade = darker(skin, 0.8);

  // ---- measurements (metres)
  const hs = B.headScale, hw = F.HEAD_HW * hs * K, R = F.TORSO_R * B.torsoWidth * K, TH = F.TORSO_H * B.torsoHeight * K, depthK = F.TORSO_DEPTH * B.torsoDepth;
  const neckL = F.NECK_LEN * B.neck * K, headH = (F.HEAD_TOP + F.HEAD_BOT) * hw;
  const yChin = K - headH, yTorsoTop = yChin - neckL + F.TORSO_TUCK * K, yTorsoBot = yTorsoTop - TH, yHip = yTorsoBot + F.HIP_T * TH;
  const ankleY = F.ANKLE_Y * K, legLen = yHip - ankleY, thighL = legLen * 0.52, shinL = legLen * 0.48;
  const shoulderY = yTorsoBot + F.SHOULDER_T * TH, shoulderX = R * F.SHOULDER_IN * hermite(TORSO_PROFILE, F.SHOULDER_T);
  const upperL = F.UPPER_ARM * B.armLength * K, foreL = F.FOREARM * B.armLength * K;
  const yChest = yTorsoBot + 0.55 * TH, yNeck = yTorsoTop - 0.01 * K, yHeadO = yChin + 0.12 * headH, yHc = F.HEAD_BOT * hw - 0.12 * headH;
  const armR0 = F.ARM_R[0] * B.limb * K, armR1 = F.ARM_R[1] * B.limb * K, legR0 = F.LEG_R[0] * B.limb * K, legR1 = F.LEG_R[1] * B.limb * K;
  const handR = F.HAND_R * B.hand * K, hipX = F.HIP_X * R * 1.15, footX = F.FOOT_X * R * 1.35;

  // ---- skeleton
  const group = new THREE.Group(); group.name = name;
  const parts = { root: group };
  const J = (n, parent, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.name = n; g.position.set(x, y, z); parent.add(g); parts[n] = g; return g; };
  const hips = J('hips', group, 0, yHip, 0), spine = J('spine', hips), chest = J('chest', spine, 0, yChest - yHip, 0), neck = J('neck', chest, 0, yNeck - yChest, 0), head = J('head', neck, 0, yHeadO - yNeck, 0);
  const sides = [['L', 1], ['R', -1]];
  for (const [S, s] of sides) {
    const sh = J('shoulder' + S, chest, s * shoulderX, shoulderY - yChest, 0), el = J('elbow' + S, sh, 0, -upperL, 0), hd = J('hand' + S, el, 0, -foreL, 0);
    const hp = J('hip' + S, hips, s * hipX, 0, 0), kn = J('knee' + S, hp, 0, -thighL, 0), ft = J('foot' + S, kn, 0, -shinL, 0);
  }

  // ---- body meshes
  const add = (obj, parent, x = 0, y = 0, z = 0) => { obj.position.set(x, y, z); parent.add(obj); return obj; };
  const torsoColor = O.style === 'jacket' || O.style === 'sweater' ? O.top : O.inner;
  parts.torso = add(inkMesh(torsoGeo(R, TH, depthK), torsoColor, INKK.torso), spine, 0, yTorsoBot - yHip, 0);
  const pelvis = inkMesh(ball(1), O.bottom, 0); pelvis.scale.set(R * 0.92, 0.07 * K, R * depthK * 0.9); add(pelvis, hips, 0, -0.012 * K, 0); parts.pelvis = pelvis;
  const neckMesh = inkMesh(new THREE.CylinderGeometry(F.NECK_R * K, F.NECK_R * K * 1.1, neckL + 0.05 * K, 16), skin, INKK.limb); add(neckMesh, neck, 0, (neckL + 0.05 * K) / 2 - 0.02 * K, 0);
  // outfit details on the torso (the same shell, a band or a front wedge: they cannot clip)
  const torsoAt = (g, c, k = 0) => { const m = inkMesh(g, c, k, { shadow: false }); return add(m, spine, 0, yTorsoBot - yHip, 0); };
  if (O.style === 'jacket') {
    torsoAt(torsoGeo(R, TH, depthK, { t0: 0.1, t1: 0.9, inflate: 0.018, constant: true, phi: 0.3 }), O.inner);                    // open jacket: the shirt shows in front
    const zip = torsoAt(torsoGeo(R, TH, depthK, { t0: 0.02, t1: 0.88, inflate: 0.03, constant: true, phi: 0.045 }), O.trim);           // placket line
    torsoAt(torsoGeo(R, TH, depthK, { t0: 0.0, t1: 0.1, inflate: 0.012 }), O.bottom);                                                // dark hem band
    const collar = inkMesh(torusGeo(F.NECK_R * K * 1.5, 0.017 * K), O.top, 0.7); collar.rotation.x = Math.PI / 2; add(collar, spine, 0, yTorsoTop - yHip - 0.004 * K, 0.004 * K);
    const nr = inkMesh(torusGeo(F.NECK_R * K * 1.2, 0.012 * K), O.inner, 0); nr.rotation.x = Math.PI / 2; add(nr, spine, 0, yTorsoTop - yHip + 0.008 * K, 0.004 * K);
  } else { // sweater: rib collar, hem and a kangaroo pocket + a chest stripe
    torsoAt(torsoGeo(R, TH, depthK, { t0: 0.0, t1: 0.16, inflate: 0.03 }), O.trim, 0.0);
    torsoAt(torsoGeo(R, TH, depthK, { t0: 0.5, t1: 0.62, inflate: 0.022 }), O.inner, 0);
    const rib = inkMesh(torusGeo(F.NECK_R * K * 1.32, 0.02 * K), O.trim, 0.7); rib.rotation.x = Math.PI / 2; add(rib, spine, 0, yTorsoTop - yHip - 0.002 * K, 0.004 * K);
    const pk = inkMesh(new THREE.SphereGeometry(1, 20, 12), O.trim, 0, { shadow: false }); pk.scale.set(0.072 * K, 0.036 * K, 0.008 * K); add(pk, spine, 0, yTorsoBot - yHip + TH * 0.2, R * depthK * 0.9);
  }

  // arms
  const sleeve = O.top, cuff = O.style === 'jacket' ? O.trim : O.trim;
  for (const [S, s] of sides) {
    const sh = parts['shoulder' + S], el = parts['elbow' + S], hd = parts['hand' + S];
    const sball = inkMesh(ball(1), sleeve, 0); sball.scale.setScalar(armR0 * 1.08); add(sball, sh);
    parts['upperArm' + S] = add(inkMesh(tube(armR0, armR0 * 0.88, upperL), sleeve, INKK.limb), sh);
    parts['forearm' + S] = add(inkMesh(tube(armR0 * 0.9, armR1, foreL), sleeve, INKK.limb), el);
    const eb = inkMesh(ball(1), sleeve, 0); eb.scale.setScalar(armR0 * 0.9); add(eb, el);
    const cf = inkMesh(torusGeo(armR1 * 1.05, 0.009 * K), cuff, 0.5); cf.rotation.x = Math.PI / 2; add(cf, hd, 0, 0.012 * K, 0);
    const palm = inkMesh(ball(1, 18, 12), skin, INKK.hand); palm.scale.set(handR * 0.95, handR * 1.1, handR * 0.8); add(palm, hd, 0, -handR * 0.95, 0);
    const thumb = inkMesh(ball(1, 12, 8), skin, INKK.hand); thumb.scale.set(handR * 0.36, handR * 0.62, handR * 0.38); thumb.position.set(-s * handR * 0.78, -handR * 0.9, handR * 0.34); thumb.rotation.z = -s * 0.5; hd.add(thumb);
    parts['palm' + S] = palm;
  }
  // legs + shoes
  const SH = F.SHOE;
  for (const [S, s] of sides) {
    const hp = parts['hip' + S], kn = parts['knee' + S], ft = parts['foot' + S];
    const hb = inkMesh(ball(1), O.bottom, 0); hb.scale.setScalar(legR0 * 1.08); add(hb, hp);
    parts['thigh' + S] = add(inkMesh(tube(legR0, legR0 * 0.86, thighL), O.bottom, INKK.limb), hp);
    parts['shin' + S] = add(inkMesh(tube(legR0 * 0.86, legR1, shinL), O.bottom, INKK.limb), kn);
    const kb = inkMesh(ball(1), O.bottom, 0); kb.scale.setScalar(legR0 * 0.86); add(kb, kn);
    const cf = inkMesh(torusGeo(legR1 * 1.08, 0.012 * K), O.trim, 0.5); cf.rotation.x = Math.PI / 2; add(cf, ft, 0, 0.025 * K, 0);
    const up = inkMesh(ball(1, 20, 14), O.shoes, INKK.shoe); up.scale.set(SH.w * K, SH.h * K * 0.78, SH.l * K); add(up, ft, 0, -ankleY + SH.sole * K * 1.6 + SH.h * K * 0.74, SH.fwd * K);
    const sole = inkMesh(ball(1, 20, 10), O.sole, INKK.shoe * 0.8); sole.scale.set(SH.w * K * 1.1, SH.sole * K, SH.l * K * 1.08); add(sole, ft, 0, -ankleY + SH.sole * K, SH.fwd * K); parts['shoe' + S] = up;
    const toe = inkMesh(ball(1, 12, 8), O.shoes, 0); toe.scale.set(SH.w * K * 0.7, SH.h * K * 0.45, SH.l * K * 0.45); add(toe, ft, 0, -ankleY + SH.sole * K * 1.7 + SH.h * K * 0.35, (SH.fwd + SH.l * 0.62) * K);
  }

  // ---- head: skin egg, ears, nose, face decal, hair
  const headG = new THREE.Group(); head.add(headG); headG.position.y = yHc; parts.skull = headG;
  headG.add(inkMesh(eggGeo(hw), skin, INKK.head));
  for (const s of [-1, 1]) { const ear = inkMesh(ball(1), skin, INKK.ear); ear.scale.set(0.1 * hw, 0.24 * hw, 0.16 * hw); ear.position.set(s * hw * 1.0, -0.1 * hw, -0.04 * hw); headG.add(ear); }
  const noseY = -F.NOSE_Y * hw, noseZ = F.HEAD_DEPTH * hw * Math.sqrt(1 - Math.pow(noseY / (F.HEAD_BOT * hw), 2));
  const nose = inkMesh(ball(1, 16, 12), skin, 0, { shadow: false }); nose.scale.set(0.15 * hw * FS.nose, 0.2 * hw * FS.nose, 0.2 * hw * FS.noseLen); nose.position.set(0, noseY + 0.05 * hw, noseZ + 0.02 * hw); headG.add(nose); parts.nose = nose;
  // face decal
  const canvas = (typeof document !== 'undefined') ? document.createElement('canvas') : { width: 0, height: 0, getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {} }), set: () => true }) };
  canvas.width = canvas.height = FACE_PX;
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const egg = eggGeo(hw * 1.007), ep = egg.attributes.position, ix = egg.index.array, keep = [];
  for (let i = 0; i < ix.length; i += 3) { const zc = (ep.getZ(ix[i]) + ep.getZ(ix[i + 1]) + ep.getZ(ix[i + 2])) / 3; if (zc > 0.1 * hw) keep.push(ix[i], ix[i + 1], ix[i + 2]); }
  egg.setIndex(keep); const uv = new Float32Array(ep.count * 2);
  for (let i = 0; i < ep.count; i++) { uv[i * 2] = ep.getX(i) / (2 * F.FACE_SPAN * hw) + 0.5; uv[i * 2 + 1] = ep.getY(i) / (2 * F.FACE_SPAN * hw) + 0.5; }
  egg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const faceMesh = new THREE.Mesh(egg, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  faceMesh.renderOrder = 2; headG.add(faceMesh); parts.face = faceMesh;
  const hair = (HAIR_STYLES[H.style] || swoopHair)(hw, { hair: H.color, accent: H.accent }); headG.add(hair); parts.hair = hair;
  // sockets
  const sockets = {};
  const sock = (n, parent, x, y, z) => { const g = new THREE.Group(); g.name = 'socket' + n; g.position.set(x, y, z); parent.add(g); sockets[n] = g; parts['socket' + n] = g; return g; };
  sock('HandL', parts.handL, 0, -handR * 1.0, 0); sock('HandR', parts.handR, 0, -handR * 1.0, 0);
  sock('Head', head, 0, yHc + F.HEAD_TOP * hw * 0.9, 0); sock('Back', chest, 0, 0, -R * depthK * 1.05);

  // ================================================================== face state (pure function of t)
  const faceState = { expr: 'neutral', exprFn: null, talkFn: null, key: '' };
  const blinkAt = (t) => { const P = 3.1 + hash(FS.seed) * 1.6, ph = (t + hash(FS.seed + 5) * P) % P; return ph < 0.15 ? Math.sin(Math.PI * ph / 0.15) : 0; };
  function updateFace(t, look) {
    const expr = faceState.exprFn ? faceState.exprFn(t) : faceState.expr;
    const blink = Math.round(blinkAt(t) * 4) / 4, open = faceState.talkFn ? Math.round(clamp(faceState.talkFn(t), 0, 1) * 4) / 4 : 0;
    const lx = Math.round(look[0] * 4) / 4, ly = Math.round(look[1] * 4) / 4, key = `${expr}|${blink}|${open}|${lx}|${ly}`;
    if (key === faceState.key) return; faceState.key = key;
    drawFace(canvas, { expr, blink, open, look: [lx, ly] }, FS); tex.needsUpdate = true;
  }

  // ================================================================== poses
  // pose = { fk:{'joint.rx|ry|rz|px|py|pz':number}, foot:{L,R:{t:[x,y,z] (root space), pitch, yaw, w}}, hand:{L,R:{t:[x,y,z], w}} }
  const standY = -0.012 * K;
  const footRest = (S) => [(S === 'L' ? 1 : -1) * footX, ankleY, 0];
  const newPose = () => ({ fk: {}, foot: {}, hand: {}, wTotal: 0 });
  const prop = { obj: null, gripA: null, gripB: null }; // carried prop (set by carry())

  const ACTS = {
    idle(t) {
      const p = newPose(), ph = hash(FS.seed) * TAU;
      Object.assign(p.fk, {
        'chest.rx': 0.014 * Math.sin(TAU * 0.27 * t + ph), 'spine.rz': 0.02 * Math.sin(TAU * 0.13 * t + ph), 'hips.rz': 0.022 * Math.sin(TAU * 0.11 * t + ph), 'hips.px': 0.006 * K * Math.sin(TAU * 0.11 * t + ph),
        'head.ry': 0.1 * Math.sin(TAU * 0.12 * t + ph) + 0.05 * Math.sin(TAU * 0.31 * t), 'head.rz': 0.035 * Math.sin(TAU * 0.17 * t + ph + 1), 'head.rx': 0.03 * Math.sin(TAU * 0.21 * t + ph),
        'hips.py': standY, 'shoulderL.rz': 0.17 + 0.015 * Math.sin(TAU * 0.27 * t + ph), 'shoulderR.rz': -0.17 - 0.015 * Math.sin(TAU * 0.27 * t + ph + 0.6),
        'shoulderL.rx': 0.05, 'shoulderR.rx': 0.05, 'elbowL.rx': -0.16, 'elbowR.rx': -0.16, 'handL.rx': 0.1, 'handR.rx': 0.1,
      });
      for (const S of ['L', 'R']) p.foot[S] = { t: footRest(S), pitch: 0, yaw: S === 'L' ? 0.08 : -0.08, w: 1 };
      return p;
    },
    walk(t, a) { return gait(t, a, false); },
    run(t, a) { return gait(t, a, true); },
    wave(t, a) {
      const p = newPose(), f = Math.sin(TAU * 1.9 * t), up = sstep((a.t0 === undefined ? 1 : (t - a.t0) / 0.3));
      Object.assign(p.fk, { 'shoulderR.rz': lerp(-0.17, -1.62, up), 'shoulderR.rx': -0.1 * up, 'elbowR.rz': lerp(0, -0.95 + 0.42 * f, up), 'elbowR.rx': -0.08 * up, 'handR.rz': 0.25 * f * up, 'chest.rz': 0.04 * up, 'head.rz': -0.06 * up });
      return p;
    },
    point(t, a) {
      const p = newPose(), k = K / 1.65, tgt = a.target || [-shoulderX - 0.06 * k, shoulderY + 0.04 * k, 0.45 * k]; // root space; default: straight ahead at shoulder height
      p.hand.R = { t: tgt, w: 1 }; Object.assign(p.fk, { 'handR.rx': 0.0, 'spine.ry': 0.08, 'head.ry': -0.1 });
      return p;
    },
    talk(t) { // gesture while talking: both hands, small nods, brows live in the face
      const p = newPose(), s1 = Math.sin(TAU * 0.9 * t), s2 = Math.sin(TAU * 1.3 * t + 1), s3 = Math.sin(TAU * 0.7 * t + 2);
      Object.assign(p.fk, { 'shoulderL.rx': -0.55 + 0.15 * s1, 'shoulderR.rx': -0.5 + 0.15 * s2, 'shoulderL.rz': 0.35 + 0.1 * s2, 'shoulderR.rz': -0.35 - 0.1 * s1, 'elbowL.rx': -1.15 + 0.25 * s2, 'elbowR.rx': -1.2 + 0.25 * s1,
        'handL.rz': 0.4 * s3, 'handR.rz': -0.4 * s3, 'head.rx': 0.05 * s1, 'head.ry': 0.1 * s3, 'chest.ry': 0.07 * s2 });
      return p;
    },
    react(t, a) { // surprise: a quick hop back, hands thrown up beside the head
      const p = newPose(), u = clamp((t - (a.t0 || 0)) / 0.5, 0, 1), e = u < 0.3 ? sstep(u / 0.3) : 1 - 0.15 * sstep((u - 0.3) / 0.7);
      Object.assign(p.fk, { 'hips.pz': -0.05 * K * e, 'hips.py': standY + 0.03 * K * Math.sin(Math.PI * clamp(u * 1.6, 0, 1)), 'spine.rx': -0.18 * e, 'head.rx': -0.12 * e,
        'shoulderL.rz': lerp(0.17, 2.35, e), 'shoulderR.rz': lerp(-0.17, -2.35, e), 'shoulderL.rx': -0.25 * e, 'shoulderR.rx': -0.25 * e,
        'elbowL.rx': -0.5 * e, 'elbowR.rx': -0.5 * e, 'handL.rz': 0.3 * e, 'handR.rz': -0.3 * e });
      for (const S of ['L', 'R']) p.foot[S] = { t: [(S === 'L' ? 1 : -1) * footX * 1.25, ankleY, -0.02 * K * e], pitch: 0, yaw: 0, w: 1 };
      return p;
    },
    sit(t, a) { // sit on a seat `a.seat` metres high (default: a chair, 0.45 m at K = 1.65); shins vertical, thighs forward, hands on the knees
      const p = newPose(), k = K / 1.65, seat = (a.seat ?? 0.45) * k, hipY = seat + 0.07 * K, ph = hash(FS.seed) * TAU;
      const sinPhi = clamp((hipY - ankleY - shinL) / thighL, -0.8, 0.8), cosPhi = Math.sqrt(1 - sinPhi * sinPhi), kneeZ = thighL * cosPhi, kneeY = hipY - thighL * sinPhi;
      Object.assign(p.fk, { 'hips.py': hipY - yHip, 'hips.pz': -0.03 * K, 'spine.rx': 0.05 + 0.012 * Math.sin(TAU * 0.27 * t + ph), 'head.rx': -0.04, 'head.ry': 0.08 * Math.sin(TAU * 0.12 * t + ph) });
      for (const [S, s] of sides) {
        p.foot[S] = { t: [s * footX * 1.15, ankleY, kneeZ - 0.03 * K], pitch: 0, yaw: s * 0.1, w: 1 };
        p.hand[S] = { t: [s * (hipX + 0.035 * K), kneeY + 0.045 * K, kneeZ * 0.72], w: 1 };
      }
      return p;
    },
    hold(t, a) { // both hands on the carried prop, held in front of the chest: the MIDPOINT of the two grips goes to a.at (root space; default = a shovel/staff stood in front, top at chest height, "leaning on it"). a.rx/a.yaw/a.rz tilt it
      const p = newPose(); if (!prop.obj) return p;
      const k = K / 1.65, q = a.at || [0, 0.5 * K, 0.27 * k], o = prop.obj, mid = prop.gripA.clone().add(prop.gripB).multiplyScalar(0.5).multiply(o.scale);
      o.rotation.set(a.rx ?? -0.1, a.yaw ?? 0, a.rz ?? 0, 'YXZ'); o.updateMatrix();
      o.position.set(0, 0, 0); mid.applyQuaternion(o.quaternion); o.position.set(q[0] - mid.x, q[1] - mid.y, q[2] - mid.z); o.updateMatrix();
      handsOnProp(p, 1); Object.assign(p.fk, { 'spine.rx': 0.04, 'head.rx': -0.03 }); return p;
    },
    dig(t, a) { return dig(t, a); },
    plant(t, a) { // crouch, lean in, press the soil down with both hands
      const p = newPose(), u = Math.sin(TAU * 0.8 * t) * 0.5 + 0.5, k = (v) => v * K;
      Object.assign(p.fk, { 'hips.py': standY - k(0.2), 'hips.pz': -k(0.09), 'spine.rx': 0.6, 'chest.rx': 0.15, 'head.rx': -0.45 + 0.04 * Math.sin(TAU * 0.4 * t), 'neck.rx': -0.2 });
      p.hand.L = { t: [k(0.05), k(0.035) + k(0.05) * u, k(0.4)], w: 1 }; p.hand.R = { t: [-k(0.05), k(0.035) + k(0.05) * u, k(0.4)], w: 1 };
      for (const S of ['L', 'R']) p.foot[S] = { t: [(S === 'L' ? 1 : -1) * footX * 1.7, ankleY, 0.03 * K], pitch: 0, yaw: S === 'L' ? 0.35 : -0.35, w: 1 };
      return p;
    },
  };
  const PRIORITY = ['idle', 'walk', 'run', 'plant', 'sit', 'talk', 'react', 'hold', 'dig', 'point', 'wave'];

  // ---- gait: feet planted in the world while the group moves at speed v (no sliding)
  const GAIT = { walk: { f: 0.9, Ls: 0.82 * K, duty: 0.6, lift: 0.045 * K, arm: 0.42, lean: 0.03, bob: 0.016 * K, elbow: -0.35 },
    run: { f: 1.45, Ls: 0.98 * K, duty: 0.36, lift: 0.1 * K, arm: 0.7, lean: 0.16, bob: 0.032 * K, elbow: -1.35 } };
  function gait(t, a, run) {
    const g = GAIT[run ? 'run' : 'walk'], rate = a.rate || 1, f = g.f * rate, p = newPose(), phi = (((t * f + (a.phase || 0)) % 1) + 1) % 1;
    const feet = (S, ph) => {
      let dz, dy, pitch;
      if (ph < g.duty) { const s = ph / g.duty; dz = g.Ls * g.duty * (0.5 - s); dy = 0; pitch = lerp(-0.22, 0.55, sstep((s - 0.55) / 0.45)) * (run ? 0.8 : 1); if (s < 0.25) pitch = lerp(-0.22, 0, s / 0.25); }
      else { const s = (ph - g.duty) / (1 - g.duty), e = sstep(s); dz = -g.Ls * g.duty / 2 + g.Ls * g.duty * e; dy = g.lift * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.8)), 1.1); pitch = lerp(0.55, -0.22, sstep(s * 1.25)) * (run ? 0.8 : 1); }
      return { t: [(S === 'L' ? 1 : -1) * footX * (run ? 0.85 : 1), ankleY + dy + Math.max(0, pitch) * 0.03 * K, dz], pitch, yaw: 0, w: 1 };
    };
    p.foot.L = feet('L', phi); p.foot.R = feet('R', (phi + 0.5) % 1);
    const s2 = Math.cos(2 * TAU * (phi - g.duty / 2)), sw = Math.sin(TAU * phi);
    Object.assign(p.fk, {
      'hips.py': (run ? -0.05 * K - 0.03 * K * s2 : standY - 0.012 * K + g.bob * 0.5 * s2), 'hips.px': 0.014 * K * Math.cos(TAU * (phi - g.duty / 2)) * (run ? 0.5 : 1), 'hips.ry': 0.1 * Math.cos(TAU * phi), 'hips.rz': 0.03 * Math.sin(TAU * phi),
      'spine.ry': -0.14 * Math.cos(TAU * phi), 'spine.rx': g.lean, 'chest.ry': -0.06 * Math.cos(TAU * phi), 'head.ry': -0.1 * Math.cos(TAU * phi), 'head.rx': -g.lean * 0.5,
      'shoulderL.rx': g.arm * Math.cos(TAU * phi), 'shoulderR.rx': -g.arm * Math.cos(TAU * phi), 'shoulderL.rz': run ? 0.12 : 0.2, 'shoulderR.rz': run ? -0.12 : -0.2,
      'elbowL.rx': g.elbow - 0.25 * Math.max(0, -Math.cos(TAU * phi)) * (run ? 1 : 0.5), 'elbowR.rx': g.elbow - 0.25 * Math.max(0, Math.cos(TAU * phi)) * (run ? 1 : 0.5),
    });
    return p;
  }

  // ---- dig: a shovel carried in both hands, blade in the soil ahead; one loop = stab, lever, toss
  const kfs = [ // phase, tip x,y,z (metres at K=1.65), pitch (+ = handle top tips forward), roll, yaw, spine lean
    [0.00, [0.00, 0.30, 0.46], -0.50, 0.0, 0.0, 0.25], [0.26, [0.00, -0.05, 0.60], -0.30, 0.0, 0.0, 0.45], [0.42, [0.00, -0.07, 0.60], -0.22, 0.0, 0.0, 0.55],
    [0.64, [0.03, 0.28, 0.40], -0.80, 0.0, 0.0, 0.2], [0.82, [0.40, 0.42, 0.36], -0.66, -0.6, 0.35, 0.1], [1.00, [0.00, 0.30, 0.46], -0.50, 0.0, 0.0, 0.25],
  ];
  function kf(ph) {
    let i = 0; while (i < kfs.length - 2 && ph > kfs[i + 1][0]) i++;
    const A = kfs[i], Bk = kfs[i + 1], u = sstep((ph - A[0]) / (Bk[0] - A[0]));
    const L = (j) => lerp(A[j], Bk[j], u), v = [0, 1, 2].map((m) => lerp(A[1][m], Bk[1][m], u));
    return { tip: v, pitch: L(2), roll: L(3), yaw: L(4), lean: L(5) };
  }
  function handsOnProp(p, w) {
    if (!prop.obj) return;
    prop.obj.updateMatrix(); const gA = prop.gripA.clone().applyMatrix4(prop.obj.matrix), gB = prop.gripB.clone().applyMatrix4(prop.obj.matrix);
    // the top grip goes to the right hand (character's right = -x)
    const a = gA.x <= gB.x ? gA : gB, b = gA.x <= gB.x ? gB : gA; // lower x = right side
    p.hand.R = { t: [a.x, a.y, a.z], w }; p.hand.L = { t: [b.x, b.y, b.z], w };
  }
  function dig(t, a) {
    const p = newPose(), k = K / 1.65, c = kf((((t * 0.62 + (a.phase || 0)) % 1) + 1) % 1);
    if (!prop.obj) return p;
    prop.obj.position.set(c.tip[0] * k, c.tip[1] * k, c.tip[2] * k); prop.obj.rotation.set(c.pitch, c.yaw, c.roll, 'YXZ'); prop.obj.updateMatrix();
    handsOnProp(p, 1);
    Object.assign(p.fk, { 'spine.rx': c.lean, 'chest.rx': 0.12, 'hips.py': standY - 0.03 * K * (c.lean - 0.2), 'hips.pz': -0.02 * K, 'head.rx': -c.lean * 0.7 });
    for (const S of ['L', 'R']) p.foot[S] = { t: [(S === 'L' ? 1 : -1) * footX * 1.5, ankleY, (S === 'L' ? 0.0 : -0.06) * K], pitch: 0, yaw: S === 'L' ? 0.15 : -0.15, w: 1 };
    return p;
  }

  // ================================================================== IK (two-bone, analytic)
  const _u = new V3(), _pp = new V3(), _d = new V3(), _s = new V3(), _x = new V3(), _y = new V3(), _z = new V3(), _m = new THREE.Matrix4(), _q = new Q(), _q2 = new Q(), _v = new V3();
  /** target relative to the upper joint, in the parent's frame -> upper-joint quaternion + bend angle; pole = direction the middle joint points */
  function solve2(l1, l2, tgt, pole, outQ) {
    const d0 = tgt.length(), d = clamp(d0, Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4); _u.copy(tgt).divideScalar(d0 || 1);
    const A = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1)), Bi = Math.acos(clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1));
    _pp.copy(pole).addScaledVector(_u, -pole.dot(_u)); if (_pp.lengthSq() < 1e-8) _pp.set(0, 0, 1).addScaledVector(_u, -_u.z); _pp.normalize();
    _d.copy(_u).multiplyScalar(Math.cos(A)).addScaledVector(_pp, Math.sin(A));           // upper segment direction
    _s.copy(_u).addScaledVector(_d, -_u.dot(_d)); if (_s.lengthSq() < 1e-8) _s.copy(_pp).negate(); _s.normalize(); // side the lower segment bends toward
    _y.copy(_d).negate(); _z.copy(_s); _x.crossVectors(_y, _z).normalize(); _z.crossVectors(_x, _y).normalize();
    _m.makeBasis(_x, _y, _z); outQ.setFromRotationMatrix(_m);
    return Math.PI - Bi; // bend (0 = straight)
  }
  const POLE = { armL: new V3(0.45, -1, -0.3), armR: new V3(-0.45, -1, -0.3), leg: new V3(0, 0, 1) };
  const toLocal = (obj, rootPt, out) => { out.copy(rootPt).applyMatrix4(group.matrixWorld); return obj.worldToLocal(out); };
  const ikState = { reach: { L: null, R: null }, look: null };

  function apply(pose, t) {
    const fk = (k) => pose.fk[k] || 0;
    // 1) torso, head and FK arms
    hips.position.set(fk('hips.px'), yHip + fk('hips.py'), fk('hips.pz'));
    for (const n of ['hips', 'spine', 'chest', 'neck', 'head', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'handL', 'handR']) parts[n].rotation.set(fk(n + '.rx'), fk(n + '.ry'), fk(n + '.rz'), 'XYZ');
    // look-at: head takes most of the turn, the eyes the rest
    let eyeLook = [0, 0];
    group.updateMatrixWorld(true);
    if (ikState.look) {
      toLocal(neck, ikState.look, _v); const yaw = Math.atan2(_v.x, _v.z), hz = Math.hypot(_v.x, _v.z), pitch = Math.atan2(-(_v.y - (yHeadO - yNeck + yHc)), hz);
      const hy = clamp(yaw, -1.1, 1.1) * 0.75, hx = clamp(pitch, -0.5, 0.5) * 0.7; head.rotation.y += hy; head.rotation.x += hx;
      eyeLook = [clamp((yaw - hy) / 0.5, -1, 1), clamp((pitch - hx) / 0.4, -1, 1)];
    }
    group.updateMatrixWorld(true);
    // 2) legs: foot targets in root space
    for (const [S] of sides) {
      const ft = pose.foot[S]; if (!ft) continue; const hp = parts['hip' + S], kn = parts['knee' + S], fo = parts['foot' + S];
      _v.set(ft.t[0], ft.t[1], ft.t[2]); toLocal(hips, _v, _v); _v.sub(hp.position);
      const bend = solve2(thighL, shinL, _v, POLE.leg, _q); hp.quaternion.copy(_q); kn.rotation.set(-bend, 0, 0); // same convention as the elbow: -bend about x
      // foot keeps its own pitch/yaw relative to the ground
      group.updateMatrixWorld(true); kn.getWorldQuaternion(_q2); _q2.invert(); const gq = new Q().setFromEuler(new THREE.Euler(ft.pitch, ft.yaw || 0, 0, 'YXZ')); group.getWorldQuaternion(_q); fo.quaternion.copy(_q2).multiply(_q).multiply(gq);
    }
    group.updateMatrixWorld(true);
    // 3) arms: IK (blended with FK by weight)
    for (const [S, s] of sides) {
      const ik = pose.hand[S], rc = ikState.reach[S]; let target = null, w = 0;
      if (ik && ik.w > 0) { target = _v.set(ik.t[0], ik.t[1], ik.t[2]).clone(); w = ik.w; }
      if (rc) { const tg = group.worldToLocal(rc.target.clone()); if (target) target.lerp(tg, rc.w); else target = tg; w = Math.max(w, rc.w); }
      if (!target || w <= 0) continue;
      const sh = parts['shoulder' + S], el = parts['elbow' + S]; toLocal(chest, target, _v); _v.sub(sh.position);
      { const dl = _v.length(); if (dl > 1e-4) _v.multiplyScalar(Math.max(0.01, dl - handR * 0.95) / dl); } // the PALM (not the wrist) lands on the target
      const bend = solve2(upperL, foreL, _v, POLE['arm' + S], _q);
      sh.quaternion.slerp(_q, w); el.rotation.x = lerp(el.rotation.x, -bend, w); el.rotation.y = lerp(el.rotation.y, 0, w); el.rotation.z = lerp(el.rotation.z, 0, w);
    }
    group.updateMatrixWorld(true);
    return eyeLook;
  }
  // knee sign: the shin must flex backward, i.e. rotate about +x by +bend; solve2 gave bend >= 0 for "bend toward target side" = local +z for the
  // frame we built, and a rotation of -bend about x moves the hanging shin toward +z. For legs the knee points forward, so the frame's +z is the
  // side the shin returns toward (backward), hence the same -bend works for both arms and legs.

  function blend(weights, t) {
    const pose = newPose(); pose.hand = {}; pose.foot = {};
    const names = PRIORITY.filter((n) => weights[n] !== undefined && (typeof weights[n] === 'number' ? weights[n] > 0 : weights[n].w > 0));
    if (!names.includes('idle')) names.unshift('idle'); // idle is always the base
    for (const n of names) {
      const a = typeof weights[n] === 'number' ? { w: weights[n] } : weights[n], w = n === 'idle' ? 1 : clamp(a.w ?? 1, 0, 1);
      const p = ACTS[n](t, a);
      for (const k in p.fk) pose.fk[k] = lerp(pose.fk[k] || 0, p.fk[k], w);
      for (const S in p.foot) { const f = p.foot[S], o = pose.foot[S]; pose.foot[S] = !o ? { ...f } : { t: o.t.map((v, i) => lerp(v, f.t[i], w)), pitch: lerp(o.pitch, f.pitch, w), yaw: lerp(o.yaw || 0, f.yaw || 0, w), w: 1 }; }
      for (const S in p.hand) { const h = p.hand[S], o = pose.hand[S]; if (!o) pose.hand[S] = { t: h.t.slice(), w: h.w * w }; else { const wn = o.w * (1 - w) + h.w * w, den = o.w * (1 - w) + h.w * w || 1; pose.hand[S] = { t: o.t.map((v, i) => (v * o.w * (1 - w) + h.t[i] * h.w * w) / den), w: wn }; } }
      for (const S in pose.hand) if (!p.hand[S] && n !== 'idle' && p.fk && Object.keys(p.fk).some((k) => k.startsWith('shoulder' + S) || k.startsWith('elbow' + S))) pose.hand[S].w *= 1 - w; // an FK arm act takes the arm back from IK
    }
    return pose;
  }

  // ================================================================== public API
  const state = { acts: { idle: 1 } };
  // a carried prop rides in the right hand (like a tool at the side) and blends into the two-hand grip of `hold`/`dig` by their weight: no pop
  const gripW = (w) => { let g = 0; for (const n of ['hold', 'dig']) { const v = w[n]; g = Math.max(g, v === undefined ? 0 : typeof v === 'number' ? v : (v.w ?? 1)); } return clamp(g, 0, 1); };
  const CARRY_Q = new Q().setFromEuler(new THREE.Euler(-0.12, 0, 0.05)), _cm = new THREE.Matrix4(), _cp = new V3(), _cq = new Q(), _cs = new V3(), _dp = new V3(), _dq = new Q();
  function parkProp(g) {
    if (!prop.obj) return; const o = prop.obj;
    if (g > 0.999) return; // fully gripped: the act already placed it
    if (g > 0) { _dp.copy(o.position); _dq.copy(o.quaternion); }
    const off = prop.gripB.clone().multiply(o.scale).negate().applyQuaternion(CARRY_Q);
    group.updateMatrixWorld(true); _cm.compose(off, CARRY_Q, o.scale); _cm.premultiply(sockets.HandR.matrixWorld);
    _cm.premultiply(new THREE.Matrix4().copy(group.matrixWorld).invert()); _cm.decompose(_cp, _cq, _cs);
    if (g > 0) { o.position.lerpVectors(_cp, _dp, g); o.quaternion.slerpQuaternions(_cq, _dq, g); } else { o.position.copy(_cp); o.quaternion.copy(_cq); }
    o.updateMatrix();
  }
  function act(weights, t) {
    state.acts = weights; const pose = blend(weights, t), look = apply(pose, t); parkProp(gripW(weights)); updateFace(t, look); api.lastPose = pose; return pose;
  }
  const api = {
    group, parts, sockets, name, K, look: { skin, outfit: O, hair: H, face: FS },
    meta: { name, kind: 'character', height: K, speeds: { walk: GAIT.walk.Ls * GAIT.walk.f, run: GAIT.run.Ls * GAIT.run.f }, acts: Object.keys(ACTS), expressions: EXPRESSIONS, sockets: Object.keys(sockets) },
    act, update(t) { act(state.acts, t); },
    setActs(w) { state.acts = w; },
    /** ground speed (m/s) the group must travel at while `walk`/`run` plays at `rate`, so the feet do not slide */
    speed(kind = 'walk', rate = 1) { return GAIT[kind].Ls * GAIT[kind].f * rate; },
    /** expression: a name, or a function t -> name (pure) */
    expression(e) { if (typeof e === 'function') { faceState.exprFn = e; } else { faceState.exprFn = null; faceState.expr = EXPR[e] ? e : 'neutral'; } return api; },
    /** mouth: a function t -> 0..1 openness (pure), or null */
    talk(fn) { faceState.talkFn = fn; return api; },
    /** helper: build a talk function from word timings [[start,end],...] (seconds) */
    talkFromWords(words) { return (t) => { for (const [a, b] of words) if (t >= a && t <= b) { const e = Math.min(1, (t - a) / 0.05, (b - t) / 0.06); return e * (0.45 + 0.55 * Math.abs(Math.sin(TAU * 3.4 * (t - a)))); } return 0; }; },
    /** world point the head and eyes follow (null = off) */
    lookAt(p) { ikState.look = p ? (p.isVector3 ? p : new V3(...p)) : null; return api; },
    /** hand `side` ('L'|'R') reaches a WORLD point (two-bone IK) until cleared with null; w = 0..1 */
    reach(side, p, w = 1) { ikState.reach[side] = p ? { target: p.isVector3 ? p : new V3(...p), w } : null; return api; },
    /** parent an object to a socket ('HandR','HandL','Head','Back') */
    attach(obj, socket) { (sockets[socket] || sockets.HandR).add(obj); return obj; },
    /** let the hold/dig acts grip a prop: gripA/gripB = two points in the prop's local frame */
    carry(obj, gripA, gripB) { obj.parent !== group && group.add(obj); prop.obj = obj; prop.gripA = gripA.clone ? gripA.clone() : new V3(...gripA); prop.gripB = gripB.clone ? gripB.clone() : new V3(...gripB); return api; },
    dims: { hw, R, TH, yHip, yChin, legLen, thighL, shinL, upperL, foreL, shoulderX, shoulderY, ankleY, footX, handR },
  };
  api.update(0);
  return api;
}

// ------------------------------------------------------------------ the cast (same BODY, different look)
export const CAST = {
  // Sam: light-medium skin, short espresso hair with a swept quiff, hazel eyes, thick brows, a teal open jacket over a cream tee
  sam: { name: 'sam', look: {
    skin: '#d9a47a', hair: { style: 'swoop', color: '#3d2a22' },
    face: { eyeColor: '#5a6b3f', eyeRX: 0.14, eyeRY: 0.175, irisR: 0.1, browThick: 1.35, browLen: 1.05, browArch: 0.02, blush: 0.2, nose: 1.0, noseLen: 1.1, mouthW: 0.25, seed: 3 },
    outfit: { style: 'jacket', top: '#2e8a86', inner: '#efe6d2', bottom: '#3b3d46', shoes: '#6e2e2a', sole: '#e8d6a8', trim: '#e8d6a8' } } },
  // Ada: deep-brown skin, big curly puff with a headband, round dark eyes with lashes, freckles, a mustard sweater, cobalt jeans, cream trainers
  ada: { name: 'ada', look: {
    skin: '#8e5a3c', hair: { style: 'puff', color: '#2b2130', accent: '#d6a137' },
    face: { eyeColor: '#2a1d1a', eyeRX: 0.16, eyeRY: 0.205, irisR: 0.118, lash: true, freckles: true, browThick: 0.85, browLen: 0.95, browAngle: -0.01, blush: 0.4, nose: 0.8, noseLen: 0.8, mouthW: 0.23, dimple: true, seed: 8 },
    outfit: { style: 'sweater', top: '#d6a137', inner: '#efe6d2', bottom: '#3d5fbf', shoes: '#efe6d2', sole: '#b0503c', trim: '#a8771f' } } },
};
// Kid (~1.25 m: bigger head, shorter limbs) and Elder (~1.55 m: broader, grey swoop). Same BODY numbers; only `height`, `build` and `look` differ.
CAST.kid = { name: 'kid', height: 1.25, build: { headScale: 1.2, torsoHeight: 0.9, limb: 1.05, armLength: 0.95 }, look: {
  skin: '#f0b98e', hair: { style: 'puff', color: '#7a4220', accent: '#4aa3df' },
  face: { eyeColor: '#3f6fa8', eyeRX: 0.17, eyeRY: 0.225, irisR: 0.125, lash: false, freckles: true, browThick: 0.9, browLen: 0.9, blush: 0.5, nose: 0.7, noseLen: 0.7, mouthW: 0.22, dimple: true, seed: 5 },
  outfit: { style: 'sweater', top: '#e8452c', inner: '#fff3d6', bottom: '#2f5fa8', shoes: '#f6f1e4', sole: '#4a8f3a', trim: '#fff3d6' } } };
CAST.elder = { name: 'elder', height: 1.55, build: { torsoWidth: 1.1, torsoHeight: 0.86, headScale: 1.0, limb: 1.1 }, look: {
  skin: '#e3b08a', hair: { style: 'swoop', color: '#d9d6cf' },
  face: { eyeColor: '#5a4636', eyeRX: 0.13, eyeRY: 0.15, irisR: 0.095, browThick: 1.5, browLen: 1.1, browArch: 0.03, blush: 0.15, nose: 1.25, noseLen: 1.3, mouthW: 0.26, seed: 11 },
  outfit: { style: 'jacket', top: '#7a4b8c', inner: '#efe6d2', bottom: '#4a4034', shoes: '#3b2a22', sole: '#d8c9a0', trim: '#d8c9a0' } } };
export const makeSam = (extra = {}) => makeCharacter({ ...CAST.sam, ...extra });
export const makeKid = (extra = {}) => makeCharacter({ ...CAST.kid, ...extra });
export const makeElder = (extra = {}) => makeCharacter({ ...CAST.elder, ...extra });
/** makeCast('sam') -> a character from the cast by name (sam, ada, kid, elder) */
export const makeCast = (name, extra = {}) => { if (!CAST[name]) throw new Error('unknown cast member ' + name + ' (have: ' + Object.keys(CAST).join(', ') + ')'); return makeCharacter({ ...CAST[name], ...extra }); };
export const makeAda = (extra = {}) => makeCharacter({ ...CAST.ada, ...extra });
