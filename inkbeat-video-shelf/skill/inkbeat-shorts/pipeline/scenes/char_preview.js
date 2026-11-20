import * as THREE from 'three';
import { toon } from '../lib/toon.js';
import { makeCast } from '../../objects/character.js';
// node render.js --scene char_preview --view 0..3 --q "who=ada"  (prebuilt cast preview; for full sheets use objects/preview.js)
export function build(ctx){
  const q=new URLSearchParams(location.search); const scene=new THREE.Scene(); scene.background=new THREE.Color(0x8fd3f4);
  scene.add(new THREE.HemisphereLight(0xdff3ff,0x5a8a4a,1.0));
  const sun=new THREE.DirectionalLight(0xfff1d6,2.4); sun.position.set(3,5,4); sun.castShadow=true;
  sun.shadow.mapSize.set(1024,1024); Object.assign(sun.shadow.camera,{left:-3,right:3,top:3,bottom:-3,near:1,far:15}); sun.shadow.bias=-0.0015; sun.shadow.normalBias=0.04; scene.add(sun);
  const ground=new THREE.Mesh(new THREE.CircleGeometry(30,48),toon(0x6fbf5a)); ground.rotation.x=-Math.PI/2; ground.receiveShadow=true; scene.add(ground);
  const ch=makeCast(q.get('who')||'sam'); scene.add(ch.group); const cam=new THREE.PerspectiveCamera(40,ctx.w/ctx.h,0.1,100);
  const views=[[0,1.0,4.2],[2.4,1.2,3.6],[4.2,1.0,0.2],[0,1.1,-4.2]];
  return {scene,camera:cam,update(t){ ch.act({idle:1},t); const v=views[+(q.get('view')||0)]; cam.position.set(...v); cam.lookAt(0,0.85,0); }};
}
