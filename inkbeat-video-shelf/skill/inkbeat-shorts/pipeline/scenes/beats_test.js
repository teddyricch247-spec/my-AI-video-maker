import * as THREE from 'three';
import { toon } from '../lib/toon.js';
import { makeCharacter } from '../lib/char.js';
import { makeRig, applyPose, calm } from '../lib/rig.js';
export const words=[[0.11,'if you'],[0.35,'plant a'],[0.74,'tree'],[1.15,'beside an'],[1.7,'empty'],[1.95,'road,'],[2.44,'cars will'],[2.92,'steer'],[3.38,'right'],[3.64,'into'],[3.96,'it.']];
export const tags=[];
export function build(ctx){
  const scene=new THREE.Scene(); scene.background=new THREE.Color(0x3f9fe0);
  scene.add(new THREE.HemisphereLight(0xcfe8ff,0x3d6a3a,0.8));
  const sun=new THREE.DirectionalLight(0xfff1d6,2.2); sun.position.set(3,5,4); sun.castShadow=true;
  sun.shadow.mapSize.set(1024,1024); Object.assign(sun.shadow.camera,{left:-3,right:3,top:3,bottom:-3,near:1,far:15}); sun.shadow.bias=-0.0015; sun.shadow.normalBias=0.04; scene.add(sun);
  const ground=new THREE.Mesh(new THREE.CircleGeometry(40,48),toon(0x3f9a3a)); ground.rotation.x=-Math.PI/2; ground.receiveShadow=true; scene.add(ground);
  const ch=makeCharacter(); scene.add(ch.group);
  const cam=new THREE.PerspectiveCamera(70,ctx.w/ctx.h,0.1,200);
  const portrait=[
    {pos:[0.3,0.55,2.0], look:[0,0.45,0], fov:70},                       // start: low, close
    {at:0.74, dur:0.66, pos:[0.5,0.9,1.5], look:[0,1.0,0], fov:62, roll:0.04},   // "tree": push up to the face
    {at:1.7,  dur:0.8,  pos:[2.2,1.0,2.6], look:[0,0.7,0], fov:72, roll:-0.03},  // "empty": swing wide
    {at:2.44, dur:0.74, pos:[-1.4,2.4,3.2], look:[0,0.6,0], fov:75, roll:0.0},   // "cars": crane high
    {at:3.38, dur:0.85, pos:[-0.3,0.35,1.3], look:[0,0.9,0], fov:66, roll:0.05}, // "right": low and tight
  ];
  // 16:9: the same story as calm cuts (no moves, no roll), framed for a wide frame (the rig divides these fovs by 1.4)
  const landscape=[
    {pos:[0.4,1.2,3.4], look:[0,0.95,0], fov:60},                        // start: full body
    {at:0.74, pos:[0.5,1.3,2.0], look:[0,1.15,0], fov:56},               // "tree": chest up
    {at:1.7,  pos:[-2.0,1.1,3.2], look:[0,0.9,0], fov:60},               // "empty": wide from the other side
    {at:2.44, pos:[1.6,2.2,3.4], look:[0,0.7,0], fov:60},                // "cars": high
    {at:3.38, pos:[-0.3,1.3,1.5], look:[0,1.45,0], fov:54},              // "right": head and shoulders
  ];
  const rig=ctx.landscape?makeRig(calm(landscape),{drift:0,arc:0,fps:ctx.fps}):makeRig(portrait,{fps:ctx.fps});
  return {scene,camera:cam,update(t){ ch.update(t); applyPose(cam,rig(t)); }};
}
