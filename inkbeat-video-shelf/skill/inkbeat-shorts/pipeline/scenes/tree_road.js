// tree_road: "If you plant a tree beside an empty road, cars will steer right into it..." (first 12 s)
// Sam plants a tree, a car veers across the road into it, the road runs on for miles, a second car hits it too.
// Everything is a pure function of t. World: road runs along z (cars drive toward +z), tree on the car's right (-x).
import * as THREE from 'three';
import { toon } from '../lib/toon.js';
import { makeRig, applyPose, calm } from '../lib/rig.js';
import { makeSam, inkMesh } from '../../objects/character.js';
import { makeCar, crashPath } from '../../objects/car.js';
import { makeTree } from '../../objects/tree.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x)), lerp = (a, b, k) => a + (b - a) * k;
const sstep = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const backOut = (x) => { x = clamp(x, 0, 1); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const ball = (r = 1, a = 24, b = 16) => new THREE.SphereGeometry(r, a, b);

// ---------------------------------------------------------------- layout and timing
export const words = [];
const TREE = new THREE.Vector2(-4.7, -8.4);            // tree xz (beside the road, on the cars' right)
const LANE = 1.7, V = 18, VEER = 1.15;                  // lane x, car speed m/s, seconds spent veering
const PSI_H = -0.40;                                    // car heading at impact (turned toward the tree)
const HIT = [3.96, 10.78];                              // impact times ("into it." / "hits it")
const PATHS = HIT.map((hit) => crashPath({ target: [TREE.x, TREE.y], hit, lane: LANE, speed: V, veer: VEER, heading: PSI_H }));
const P_HIT = new THREE.Vector2(...PATHS[0].contact), FWD_H = new THREE.Vector2(...PATHS[0].dir);

function starShape(rOut, rIn, n) { const s = new THREE.Shape(); for (let i = 0; i < n * 2; i++) { const a = (i / (n * 2)) * Math.PI * 2, r = i % 2 ? rIn : rOut; i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r); } s.closePath(); return s; }

// ---------------------------------------------------------------- scene
export function build(ctx) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x86d0f4);
  scene.add(new THREE.HemisphereLight(0xdff1ff, 0x4c8a3c, 0.95));
  const sun = new THREE.DirectionalLight(0xfff0d0, 2.4), target = new THREE.Object3D(); target.position.set(-3, 0, -8); scene.add(target);
  sun.position.set(3, 10, 0); sun.target = target; sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 32 }); sun.shadow.bias = -0.0012; sun.shadow.normalBias = 0.05; scene.add(sun);

  // ground, road, markings
  const ground = new THREE.Mesh(new THREE.CircleGeometry(800, 40), toon(0x58b447)); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const flat = (w, l, c, x, y, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), toon(c)); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true; scene.add(m); return m; };
  flat(7.4, 500, 0x57516f, 0, 0.03, -230);                                              // asphalt
  flat(0.16, 500, 0xf4f1ff, -3.15, 0.06, -230); flat(0.16, 500, 0xf4f1ff, 3.15, 0.06, -230);   // edge lines
  for (let i = 0; i < 60; i++) flat(0.16, 2.6, 0xffd23f, 0, 0.06, 6 - i * 7);          // centre dashes
  // grass tufts and flowers (tiny, so the tree stays the only real object)
  for (let i = 0; i < 70; i++) {
    const side = hash(i * 3.1) > 0.5 ? 1 : -1, x = side * (4.6 + hash(i * 1.7) * 9), z = 4 - hash(i * 5.3) * 34;
    if (Math.hypot(x - TREE.x, z - TREE.y) < 1.1) continue;
    const m = new THREE.Mesh(ball(1, 8, 6), toon(hash(i * 9.9) > 0.8 ? 0xffe066 : 0x3d9a38)); m.scale.set(0.16, 0.1, 0.16); m.position.set(x, 0.05, z); scene.add(m);
  }
  // far hills and clouds (no ink, flat colour)
  const hillCol = [0x5fbf72, 0x66c27f, 0x56b46a];
  for (let i = 0; i < 9; i++) { const m = new THREE.Mesh(ball(1, 20, 12), toon(hillCol[i % 3])); m.scale.set(70 + hash(i) * 70, 14 + hash(i + 7) * 20, 40); m.position.set(-420 + i * 105, 0, -430 - hash(i + 3) * 40); scene.add(m); }
  for (const [x, y, z, s] of [[-70, 70, -320, 1], [90, 90, -380, 1.3], [-190, 62, -430, 1.1], [20, 110, -460, 1.5], [200, 78, -340, 1.1]]) {
    for (const [dx, dy, r] of [[0, 0, 14], [14, -3, 10], [-14, -3, 10], [6, 6, 9]]) { const m = new THREE.Mesh(ball(1, 14, 10), toon(0xffffff)); m.scale.set(r * s, r * s * 0.7, r * s * 0.7); m.position.set(x + dx * s, y + dy * s, z); scene.add(m); }
  }

  // tree and falling leaves
  const tree = makeTree(); tree.group.position.set(TREE.x, 0, TREE.y); scene.add(tree.group);
  tree.grow((t) => (t < 1.05 ? 0.2 : 0.2 + 0.8 * backOut((t - 1.05) / 0.7))).hits(HIT, PATHS[0].dir);   // sapling, springs up once Sam steps back, sways + sheds leaves on each hit

  // impact dust + comic star
  const dust = []; HIT.forEach((th, hi) => { for (let i = 0; i < 7; i++) { const m = inkMesh(ball(1, 14, 10), i % 2 ? 0xeeeaf6 : 0xd9d3e6, 0.7, { shadow: false }); m.visible = false; scene.add(m); dust.push({ m, th, i: i + hi * 20 }); } });
  const starG = new THREE.Group(); scene.add(starG);
  const starBack = new THREE.Mesh(new THREE.ShapeGeometry(starShape(1.0, 0.55, 9)), new THREE.MeshBasicMaterial({ color: 0x2a1442 })); starBack.scale.setScalar(1.14); starBack.position.z = -0.01; starG.add(starBack);
  starG.add(new THREE.Mesh(new THREE.ShapeGeometry(starShape(1.0, 0.55, 9)), new THREE.MeshBasicMaterial({ color: 0xffd23f })));
  const starIn = new THREE.Mesh(new THREE.ShapeGeometry(starShape(0.55, 0.3, 9)), new THREE.MeshBasicMaterial({ color: 0xffffff })); starIn.position.z = 0.01; starIn.rotation.z = 0.2; starG.add(starIn);
  starG.visible = false;

  // cars
  const cars = [makeCar({ color: 'red' }), makeCar({ color: 'yellow' })]; cars.forEach((c, i) => { scene.add(c.group); c.path(PATHS[i].path).crash(HIT[i]); });

  // Sam plants the tree, then runs off
  const sam = makeSam(); scene.add(sam.group); sam.expression('happy');
  const SAM0 = new THREE.Vector2(TREE.x - 0.28, TREE.y - 0.28), vRun = sam.speed('run');

  // camera: wide plant -> empty road -> wide car approach -> push on impact -> crane over the long road -> tree alone -> repeat the shot -> impact
  const cam = new THREE.PerspectiveCamera(60, ctx.w / ctx.h, 0.3, 1200);
  const WIDE = { pos: [-1.0, 1.4, 2.0], look: [-2.5, 1.0, -14], fov: 62 }, PUSH = { pos: [-2.0, 1.2, -1.5], look: [-4.2, 1.0, -10.3], fov: 52 };
  const beats = [
    { pos: [0.2, 1.7, -3.2], look: [-4.5, 1.6, -8.2], fov: 56 },                                  // plant
    { at: 1.7, dur: 0.8, pos: [-0.6, 1.1, -3.5], look: [0.4, 0.9, -60], fov: 60, roll: 0.02 },     // "empty road"
    { at: 2.45, dur: 0.8, ...WIDE, roll: -0.02 },                                                  // "cars will steer"
    { at: 3.15, dur: 0.75, ...PUSH, roll: 0.03 },                                                  // "right into it"
    { at: 4.18, dur: 0.95, pos: [-0.6, 9.5, 15], look: [0.2, 0.0, -90], fov: 58, roll: 0 },         // "the road runs dead straight for miles"
    { at: 6.35, dur: 0.9, pos: [3.8, 1.7, -2.5], look: [-4.7, 2.0, -8.4], fov: 50, roll: -0.02 },   // "and the only thing beside it"
    { at: 7.9, dur: 0.9, pos: [-0.2, 1.5, -4.2], look: [-4.7, 2.0, -8.4], fov: 46, roll: 0.02 },   // "this one tree"
    { at: 9.25, dur: 0.8, ...WIDE, roll: -0.02 },                                                  // "but somehow somebody"
    { at: HIT[1] - 0.8, dur: 0.75, ...PUSH, roll: 0.03 },                                          // "hits it"
    { at: 11.05, dur: 0.9, pos: [-0.5, 2.1, -0.4], look: [-4.2, 1.3, -9.5], fov: 54, roll: -0.03 },  // "every week."
  ];
  // 16:9: the same shots as calm cuts (no moves, no roll); the rig divides the fovs by 1.4 for the wide frame
  const rig = ctx.landscape ? makeRig(calm(beats), { drift: 0, arc: 0, fps: ctx.fps }) : makeRig(beats, { drift: 0.035, arc: 0.02, fps: ctx.fps });

  const shake = (t) => { let sx = 0, sy = 0, sr = 0; for (const th of HIT) { const d = t - th; if (d >= 0 && d < 0.6) { const a = Math.exp(-8 * d); sx += 0.07 * a * Math.sin(d * 96); sy += 0.06 * a * Math.cos(d * 83); sr += 0.012 * a * Math.sin(d * 70); } } return [sx, sy, sr]; };

  return { scene, camera: cam, update(t) {
    // --- Sam
    const plantW = sstep((t - 0.05) / 0.2) * (1 - sstep((t - 1.0) / 0.3)), runW = sstep((t - 1.15) / 0.25);
    const s = (t - 1.2) / 0.35, runDist = t < 1.2 ? 0 : s < 1 ? vRun * 0.35 * (s * s * s - s * s * s * s / 2) : vRun * 0.35 * 0.5 + vRun * (t - 1.55);
    sam.group.position.set(SAM0.x - runDist, 0, SAM0.y); sam.group.rotation.y = lerp(0.785, -Math.PI / 2, sstep((t - 1.15) / 0.3));
    sam.act({ plant: plantW, run: runW }, t);

    // --- tree and cars (objects/tree.js, objects/car.js)
    tree.update(t); cars.forEach((c) => c.update(t));

    // --- dust burst
    for (const D of dust) {
      const d = t - D.th; if (d < 0 || d > 0.9) { D.m.visible = false; continue; }
      const ang = (D.i % 20) / 7 * 6.283 + 0.4, sp = 1.6 + hash(D.i * 4.1) * 1.8, q = 1 - Math.exp(-4.5 * d), sc = 0.1 + 0.3 * Math.sin(Math.PI * clamp(d / 0.9, 0, 1)) * (0.7 + hash(D.i) * 0.5);
      D.m.visible = true; D.m.position.set(P_HIT.x + Math.cos(ang) * sp * q * 0.55, 0.35 + 0.8 * q - 0.7 * d * d, P_HIT.y + Math.sin(ang) * sp * q * 0.55); D.m.scale.setScalar(sc); }

    // --- camera
    const pose = rig(t), [sx, sy, sr] = shake(t);
    pose.pos = [pose.pos[0] + sx, pose.pos[1] + sy, pose.pos[2]]; pose.roll += sr; applyPose(cam, pose);
    // --- comic star at the contact point, facing the camera, pops for 0.32 s
    const hit = HIT.map((th) => t - th).find((d) => d >= 0 && d < 0.32);
    starG.visible = hit !== undefined;
    if (hit !== undefined) {
      const k = backOut(hit / 0.12) * (1 - sstep((hit - 0.2) / 0.12));
      starG.position.set(P_HIT.x, 1.15, P_HIT.y); starG.quaternion.copy(cam.quaternion); starG.translateZ(1.2); starG.scale.setScalar(0.85 * k + 0.001); starG.rotateZ(hit * 2);
    }
  } };
}
