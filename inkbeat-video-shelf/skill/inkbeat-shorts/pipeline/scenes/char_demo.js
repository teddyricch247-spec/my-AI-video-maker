// WORKED EXAMPLE: how to use the prebuilt characters (objects/character.js) inside a scene. Copy this file, rename it, edit the story.
// Pattern: create characters once in build(); in update(t) set position/rotation as a PURE function of t, then call ch.act({...}, t).
import * as THREE from 'three';
import { toon } from '../lib/toon.js';
import { makeRig, applyPose, calm } from '../lib/rig.js';
import { makeSam, makeAda } from '../../objects/character.js';
import { makeShovel } from '../../objects/shovel.js';
const clamp = (x, a, b) => Math.min(b, Math.max(a, x)), lerp = (a, b, k) => a + (b - a) * k, sstep = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
export const words = [[0.15, 'meet'], [0.6, 'sam'], [1.9, 'and'], [2.2, 'ada'], [3.2, 'one'], [3.55, 'digs'], [4.2, 'one'], [4.5, 'waves'], [5.6, 'wow!']];
export function build(ctx) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x3f9fe0);
  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x3d6a3a, 0.9));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.3); sun.position.set(3, 5, 4); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 16 }); sun.shadow.bias = -0.0015; sun.shadow.normalBias = 0.04; scene.add(sun);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 48), toon(0x3f9a3a)); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  const sam = makeSam(), ada = makeAda(); scene.add(sam.group, ada.group);           // 1. make them
  const sv = makeShovel(); sam.carry(sv.group, sv.grips.A, sv.grips.B);                // 2. give Sam a shovel (carry() = hold/dig acts grip it)
  sam.expression('happy'); ada.expression((t) => (t > 5.55 ? 'shocked' : 'happy'));   // 3. faces (a name, or a pure function of t)
  sam.talk(sam.talkFromWords([[0.6, 1.1], [1.9, 2.1]]));                              //    mouth moves on word timings
  ada.talk(ada.talkFromWords([[2.2, 2.6]]));

  const cam = new THREE.PerspectiveCamera(70, ctx.w / ctx.h, 0.1, 200);
  // One scene file, two formats: ctx.landscape is true for 16:9. Portrait = moving beats; landscape = calm cuts (see lib/rig.js calm()).
  const portrait = [   // 9:16 frame: at 3.3 m the frame is ~2 m wide, so keep the pair within +-0.6 m and push in for close-ups
    { pos: [0, 1.3, 3.5], look: [0, 1.0, 0], fov: 58 },
    { at: 2.2, dur: 0.9, pos: [0.85, 1.4, 2.5], look: [0.55, 1.3, 0], fov: 56, roll: 0.03 },
    { at: 3.2, dur: 1.0, pos: [-1.1, 1.2, 2.7], look: [-0.55, 1.0, 0], fov: 60, roll: -0.03 },
    { at: 4.6, dur: 0.9, pos: [0, 1.35, 3.4], look: [0, 1.05, 0], fov: 58, roll: 0.0 },
    { at: 5.6, dur: 0.55, pos: [0.6, 1.5, 2.7], look: [0.55, 1.35, 0], fov: 56, roll: 0.02 },
  ];
  const landscape = [  // 16:9: the pair fits side by side; fovs are divided by 1.4 by the rig
    { pos: [0, 1.4, 4.2], look: [0, 1.0, 0], fov: 56 },
    { at: 2.2, pos: [1.4, 1.4, 3.2], look: [0.4, 1.2, 0], fov: 50 },
    { at: 3.2, pos: [-1.6, 1.3, 3.4], look: [-0.6, 1.0, 0], fov: 52 },
    { at: 4.6, pos: [0, 1.4, 4.0], look: [0, 1.05, 0], fov: 56 },
    { at: 5.6, pos: [0.9, 1.5, 2.6], look: [0.6, 1.4, 0], fov: 50 },
  ];
  const rig = ctx.landscape ? makeRig(calm(landscape), { drift: 0, arc: 0, fps: ctx.fps }) : makeRig(portrait, { fps: ctx.fps });
  const vWalk = sam.speed('walk'); // m/s the group must travel while `walk` plays so the feet do not slide
  return { scene, camera: cam, update(t) {
    // Sam: walks in from the left (facing +x), then turns to face the camera/Ada and digs
    const walkEnd = 1.7, x0 = -0.6 - vWalk * walkEnd;
    sam.group.position.set(t < walkEnd ? x0 + vWalk * t : -0.6, 0, 0);
    sam.group.rotation.y = lerp(Math.PI / 2, 0.45, sstep((t - walkEnd) / 0.5));
    const walking = t < walkEnd ? 1 : 1 - sstep((t - walkEnd) / 0.2);
    sam.act({ walk: walking, dig: sstep((t - 3.3) / 0.3) * (t < 4.8 ? 1 : 1 - sstep((t - 4.8) / 0.3)), talk: t > 0.5 && t < 2.2 ? 0.7 : 0 }, t);
    // Ada: stands at +x facing Sam, waves, then reacts
    ada.group.position.set(0.6, 0, 0); ada.group.rotation.y = -0.3;
    ada.lookAt(new THREE.Vector3(-0.2, 1.5, 2.0));
    ada.act({ wave: { w: sstep((t - 2.2) / 0.3) * (t < 5.5 ? 1 : 0), t0: 2.2 }, react: { w: t >= 5.5 ? 1 : 0, t0: 5.5 }, talk: t > 2.1 && t < 2.8 ? 0.5 : 0 }, t);
    applyPose(cam, rig(t));
  } };
}
