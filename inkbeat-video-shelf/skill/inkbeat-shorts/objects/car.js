// objects/car.js: prebuilt toon car. makeCar(opts) -> { group, parts, update(t), meta, ...api }.
// Metres, origin = ground contact at the car centre, faces +z (drives toward +z), 1.9 w x 1.35 h x 4.2 l. Pure function of t.
//   opts: { color, glass }   car.path(fn)    t => { x, z, yaw, dist }   (dist = signed metres rolled: wheels spin by dist)
//   car.crash(tHit)          hood pops up, nose bobs, smoke rises from the hood after tHit
//   car.update(t)            call every frame
// crashPath(opts) builds the path for "drives down a lane, veers into a target, bounces, reverses away" (the tree_road scene).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { inkMesh } from './character.js';
const clamp = (x, a, b) => Math.min(b, Math.max(a, x)), lerp = (a, b, k) => a + (b - a) * k;
const sstep = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const rb = (w, h, l, r) => new RoundedBoxGeometry(w, h, l, 4, r), ball = (r = 1, a = 24, b = 16) => new THREE.SphereGeometry(r, a, b);
export const CAR_COLORS = { red: 0xe63946, yellow: 0xffb703, blue: 0x3a86ff, green: 0x2ec27e, white: 0xf4f1ff, orange: 0xff7b2c, purple: 0x8e5cf0 };
export function makeCar(opts = {}) {
  const color = typeof opts.color === 'string' && CAR_COLORS[opts.color] ? CAR_COLORS[opts.color] : (opts.color ?? CAR_COLORS.red);
  const group = new THREE.Group(); group.name = 'car'; const body = new THREE.Group(); group.add(body); const parts = {};
  const put = (name, geo, c, k, x, y, z) => { const m = inkMesh(geo, c, k); m.position.set(x, y, z); body.add(m); if (name) parts[name] = m; return m; };
  put('chassis', rb(1.8, 0.62, 4.1, 0.22), color, 0.9, 0, 0.66, 0);
  put('cabin', rb(1.5, 0.6, 2.0, 0.24), color, 0.9, 0, 1.18, -0.3);
  put('glass', rb(1.56, 0.34, 2.06, 0.13), opts.glass ?? 0x23406b, 0.4, 0, 1.2, -0.3);
  put('grille', rb(0.8, 0.2, 0.1, 0.04), 0x2a2438, 0.4, 0, 0.62, 2.06);
  put('bumperF', rb(1.9, 0.2, 0.2, 0.08), 0x3b3550, 0.6, 0, 0.42, 2.02); put('bumperB', rb(1.9, 0.2, 0.2, 0.08), 0x3b3550, 0.6, 0, 0.42, -2.02);
  for (const s of [-1, 1]) { put(s < 0 ? 'headR' : 'headL', ball(0.15), 0xfff6b0, 0.5, s * 0.62, 0.74, 1.98); put(s < 0 ? 'tailR' : 'tailL', ball(0.12), 0xe63946, 0.4, s * 0.66, 0.76, -2.0); }
  const hood = new THREE.Group(); hood.position.set(0, 0.99, 0.72); body.add(hood); parts.hood = hood;
  const hm = inkMesh(rb(1.72, 0.14, 1.35, 0.06), color, 0.9); hm.position.set(0, 0, 0.68); hood.add(hm);
  const wheels = [];
  for (const sx of [-1, 1]) for (const sz of [-1.3, 1.3]) {
    const w = new THREE.Group(); w.position.set(sx * 0.9, 0.36, sz); group.add(w);
    const tire = inkMesh(ball(1, 20, 14), 0x2b2838, 0.9); tire.scale.set(0.17, 0.36, 0.36); w.add(tire);
    const spin = new THREE.Group(); w.add(spin);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 16), tire.userData.mesh.material.clone()); hub.material.color.set(0xd9d6e6); hub.rotation.z = Math.PI / 2; hub.position.x = sx * 0.14; spin.add(hub);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.06), tire.userData.mesh.material.clone()); bar.material.color.set(0x3b3550); bar.position.x = sx * 0.17; spin.add(bar);
    wheels.push(spin);
  }
  parts.wheels = wheels;
  const puffs = []; for (let i = 0; i < 6; i++) { const p = inkMesh(ball(1, 14, 10), i % 2 ? 0xb9b4c9 : 0xf2f0fa, 0.6, { shadow: false }); p.visible = false; body.add(p); puffs.push(p); }
  let pathFn = () => ({ x: 0, z: 0, yaw: 0, dist: 0 }), tHit = Infinity;
  const api = {
    group, parts, body,
    path(f) { pathFn = f; return api; },
    crash(t) { tHit = t; return api; },
    update(t) {
      const p = pathFn(t), imp = t >= tHit ? 1 : 0, dt = imp ? t - tHit : 0;
      group.position.set(p.x, 0, p.z); group.rotation.y = p.yaw; wheels.forEach((w) => { w.rotation.x = (p.dist || 0) / 0.36; });
      hood.rotation.x = imp * (-0.55 * (1 - Math.exp(-14 * dt)) + 0.07 * Math.sin(30 * dt) * Math.exp(-5 * dt));
      body.rotation.x = imp * 0.06 * Math.exp(-6 * dt) * Math.sin(22 * dt);
      body.rotation.z = imp ? 0 : clamp(-p.yaw * 0.12, -0.06, 0.06);
      body.position.y = imp * 0.05 * Math.exp(-8 * dt) * Math.abs(Math.sin(18 * dt));
      puffs.forEach((pf, i) => { if (!imp || dt < 0.1) { pf.visible = false; return; } const ph = ((dt - 0.1) * 0.9 + i / puffs.length) % 1, sc = 0.32 * Math.pow(Math.sin(Math.PI * ph), 0.7) + 0.02; pf.visible = sc > 0.04; pf.position.set(0.18 * Math.sin(i * 2.3), 1.15 + 1.4 * ph, 1.35 - 0.5 * ph); pf.scale.setScalar(sc); });
    },
    meta: { name: 'car', kind: 'prop', size_m: { width: 1.9, height: 1.35, length: 4.2 }, frontZ: 2.1, wheelRadius: 0.36, colors: Object.keys(CAR_COLORS), parts: Object.keys(parts) },
  };
  api.update(0); return api;
}
// crashPath({ target:[x,z], trunkRadius, hit, lane, speed, veer, heading }) -> { path(t), center:[x,z] (car centre at impact), contact:[x,z], heading, dir:[x,z] }
// The car drives +z along `lane`, veers over `veer` s into `target` (heading `heading` rad at impact, negative = toward -x), stops, bounces, then reverses away.
export function crashPath({ target, trunkRadius = 0.22, hit, lane = 1.7, speed = 18, veer = 1.15, heading = -0.4 }) {
  const fx = Math.sin(heading), fz = Math.cos(heading), reach = 2.1 + trunkRadius;
  const cx = target[0] - reach * fx, cz = target[1] - reach * fz, e = speed * Math.tan(heading) * veer / (cx - lane);
  const path = (t) => {
    const dt = t - hit;
    if (dt <= 0) {
      const k = clamp((t - (hit - veer)) / veer, 0, 1), x = lane + (cx - lane) * Math.pow(k, e);
      const dx = k > 0 ? e * (cx - lane) * Math.pow(Math.min(k, 1), e - 1) / veer : 0;
      return { x, z: cz - speed * (hit - t), yaw: Math.atan2(dx, speed), dist: speed * t };
    }
    const D = 1.0 * (1 - Math.exp(-9 * dt)), tb = 0.6, bt = Math.max(0, dt - tb), B = 0.5 * 20 * bt * bt, s = sstep(bt / 1.6);
    let dx = lerp(-fx, 0.04, s), dz = lerp(-fz, -1, s); const n = Math.hypot(dx, dz); dx /= n; dz /= n;
    return { x: cx - fx * D + dx * B, z: cz - fz * D + dz * B, yaw: lerp(heading, Math.atan2(-dx, -dz), sstep(bt / 0.5)), dist: speed * hit - D - B };
  };
  return { path, center: [cx, cz], contact: [target[0] - trunkRadius * fx, target[1] - trunkRadius * fz], heading, dir: [fx, fz] };
}
