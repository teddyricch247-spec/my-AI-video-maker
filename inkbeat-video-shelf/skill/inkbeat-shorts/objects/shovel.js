// objects/shovel.js: hand prop for the `dig` / `hold` acts. Units metres, origin = blade tip (ground contact), +y up the shaft, faces +z.
// makeShovel() -> { group, parts:{shaft,blade,grip}, grips:{A,B}, update(t), meta }.  Give grips.A / grips.B to character.carry(group, A, B).
import * as THREE from 'three';
import { inkMesh } from './character.js';
export function makeShovel(opts = {}) {
  const L = opts.length ?? 1.05, wood = opts.wood ?? '#b9854a', metal = opts.metal ?? '#9fb2c4', band = opts.band ?? '#e8452c';
  const group = new THREE.Group(); group.name = 'shovel'; const parts = {};
  const bladeH = 0.26, bladeW = 0.2;
  const bg = new THREE.SphereGeometry(1, 20, 12); // blade: a flattened, slightly pointed scoop
  const blade = inkMesh(bg, metal, 0.9); blade.scale.set(bladeW / 2, bladeH / 2, 0.012); blade.position.set(0, bladeH / 2, 0); group.add(blade); parts.blade = blade;
  const tip = inkMesh(new THREE.ConeGeometry(1, 1, 16), metal, 0.9); tip.scale.set(bladeW * 0.3, 0.07, 0.012); tip.rotation.x = Math.PI; tip.position.set(0, 0.012, 0); group.add(tip);
  const socket = inkMesh(new THREE.CylinderGeometry(0.03, 0.04, 0.09, 14), metal, 0.8); socket.position.y = bladeH + 0.02; group.add(socket);
  const shaft = inkMesh(new THREE.CylinderGeometry(0.019, 0.019, L - bladeH, 12), wood, 0.8); shaft.position.y = bladeH + (L - bladeH) / 2; group.add(shaft); parts.shaft = shaft;
  const grip = inkMesh(new THREE.TorusGeometry(0.05, 0.016, 8, 20), wood, 0.8); grip.position.y = L; grip.rotation.x = Math.PI / 2; group.add(grip); parts.grip = grip; // D-handle
  const stripe = inkMesh(new THREE.CylinderGeometry(0.0215, 0.0215, 0.05, 12), band, 0); stripe.position.y = L - 0.1; group.add(stripe);
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return { group, parts, grips: { A: new THREE.Vector3(0, L - 0.04, 0), B: new THREE.Vector3(0, L * 0.58, 0) }, update() {}, meta: { name: 'shovel', kind: 'prop', length: L, sockets: [], parts: Object.keys(parts) } };
}
