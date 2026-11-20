// preview cell for objects/car.js and objects/tree.js (used by objects/preview.js). query: what=car|tree, color=, style=, cam=front|three|side|back|top, crash=<seconds after impact>, grow=0..1, hit=<seconds after impact>
import * as THREE from 'three';
import { toon } from '../lib/toon.js';
import { makeCar, crashPath } from '../../objects/car.js';
import { makeTree } from '../../objects/tree.js';
export function build(ctx) {
  const q = new URLSearchParams(location.search), what = q.get('what') || 'car', cv = q.get('cam') || 'three';
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x8fd3f4);
  scene.add(new THREE.HemisphereLight(0xdff3ff, 0x5a8a4a, 1.0));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.4); sun.position.set(4, 7, 6); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 24 }); sun.shadow.bias = -0.0015; sun.shadow.normalBias = 0.04; scene.add(sun);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 48), toon(0x58b447)); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const cam = new THREE.PerspectiveCamera(36, ctx.w / ctx.h, 0.1, 100); let obj, r = 7, ty = 1.0;
  if (what === 'car') {
    const color = q.get('color') || 'red', car = makeCar({ color }); const c = +q.get('crash');
    if (q.has('crash')) { const T = [-1.6, 1.3], cp = crashPath({ target: T, hit: 0 }); const tr = makeTree(); tr.group.position.set(T[0], 0, T[1]); scene.add(tr.group); tr.hits([0], cp.dir).update(c);
      scene.add(car.group); car.path(cp.path).crash(0); car.update(c); const mx = (T[0] + cp.center[0]) / 2, mz = (T[1] + cp.center[1]) / 2; cam.position.set(mx + 4.5, 2.0, mz + 7.5); cam.lookAt(mx, 1.2, mz); cam.fov = 40; cam.updateProjectionMatrix(); return { scene, camera: cam, update() {} }; }
    car.path(() => ({ x: 0, z: 0, yaw: 0, dist: 0 })); car.update(0); obj = car; r = 8.5; ty = 0.8;
  } else {
    const tree = makeTree({ style: q.get('style') || 'round' }); const g = q.get('grow'); if (g !== null) tree.grow(+g); tree.update(0); obj = tree; r = 11; ty = 1.9;
    if (q.has('hit')) { tree.hits([0], [0, 1]).update(+q.get('hit')); }
  }
  scene.add(obj.group);
  const ang = { front: 0, three: 0.75, side: Math.PI / 2, back: Math.PI }[cv] ?? 0.75, top = cv === 'top';
  return { scene, camera: cam, update() { cam.position.set(Math.sin(ang) * r, top ? r * 0.8 : ty + 0.35, Math.cos(ang) * r); cam.lookAt(0, ty, 0); } };
}
