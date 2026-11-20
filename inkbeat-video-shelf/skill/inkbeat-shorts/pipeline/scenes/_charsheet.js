// Character contact-sheet scene. ctx.view selects the shot. Used by objects/preview.js
import * as THREE from 'three';
import { toon } from '../lib/toon.js';
import { makeCast } from '../../objects/character.js';
import { makeShovel } from '../../objects/shovel.js';
export function build(ctx){
  const q=new URLSearchParams(location.search);
  const who=q.get('who')||'sam', actStr=q.get('acts')||'idle', t0=+(q.get('t')||0), expr=q.get('expr')||'', cam_=q.get('cam')||'front';
  const scene=new THREE.Scene(); scene.background=new THREE.Color(0x8fd3f4);
  scene.add(new THREE.HemisphereLight(0xdff3ff,0x5a8a4a,1.0));
  const sun=new THREE.DirectionalLight(0xfff1d6,2.4); sun.position.set(3,5,4); sun.castShadow=true;
  sun.shadow.mapSize.set(1024,1024); Object.assign(sun.shadow.camera,{left:-3,right:3,top:3,bottom:-3,near:1,far:15}); sun.shadow.bias=-0.0015; sun.shadow.normalBias=0.04; scene.add(sun);
  const ground=new THREE.Mesh(new THREE.CircleGeometry(30,48),toon(0x6fbf5a)); ground.rotation.x=-Math.PI/2; ground.receiveShadow=true; scene.add(ground);
  const ch=makeCast(who); scene.add(ch.group);
  const weights={}; for(const p of actStr.split(',')){ const [n,w]=p.split(':'); weights[n]=w===undefined?1:+w; }
  if(expr) ch.expression(expr);
  if(q.get('prop')==='shovel'){ const sv=makeShovel(); sv.group.scale.setScalar(ch.K/1.65); scene.add(sv.group); ch.carry(sv.group,sv.grips.A,sv.grips.B); }
  ch.setActs(weights);
  const cam=new THREE.PerspectiveCamera(40,ctx.w/ctx.h,0.1,100);
  const C={front:[0,1.0,4.2,0],three:[2.4,1.2,3.6,0],side:[4.2,1.0,0.2,0],back:[0,1.1,-4.2,0],face:[0.25,1.5,1.25,0]};
  return {scene,camera:cam,update(t){ ch.act(weights,t+t0);
    const v=C[cam_]||C.front; cam.position.set(v[0],v[1],v[2]); cam.lookAt(0,cam_==='face'?ch.dims.yChin+0.1:ch.K*0.52,0); cam.updateMatrixWorld(); }};
}
