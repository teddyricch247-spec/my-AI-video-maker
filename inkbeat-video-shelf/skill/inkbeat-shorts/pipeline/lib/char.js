// Object contract: makeCharacter(opts) -> { group, parts, update(t) }. Meters, origin = ground between feet, faces +z.
import * as THREE from 'three';
import { inked } from './toon.js';
const S=(r,w=24,h=16)=>new THREE.SphereGeometry(r,w,h);
const hang=(geo)=>{geo.computeBoundingBox();geo.translate(0,-geo.boundingBox.max.y,0);return geo;}  // pivot at top
export function makeCharacter(o={}){
  const c={skin:0xf2b98f,hair:0x6b3a1e,shirt:0xe8452c,pants:0x2f5fa8,shoe:0xf6f1e4,pupil:0x2a1442,...o};
  const group=new THREE.Group(), parts={};
  const add=(name,obj,parent=group,pos=[0,0,0])=>{obj.position.set(...pos);parent.add(obj);parts[name]=obj;return obj;};
  const hips=add('hips',new THREE.Group(),group,[0,0.46,0]);
  // torso
  const tor=inked(new THREE.CapsuleGeometry(0.17,0.2,6,16),c.shirt); tor.scale.set(1,1,0.8); add('torso',tor,hips,[0,0.2,0]);
  // legs (pivot at hip)
  for(const [n,x] of [['legL',0.085],['legR',-0.085]]){
    const leg=new THREE.Group(); leg.add(inked(hang(new THREE.CapsuleGeometry(0.065,0.26,4,12),c.pants),c.pants));
    const shoe=inked(S(0.085,16,12),c.shoe); shoe.scale.set(1,0.7,1.5); shoe.position.set(0,-0.43,0.04); leg.add(shoe);
    add(n,leg,hips,[x,0,0]); }
  // arms: shoulder -> elbow -> hand
  for(const [n,x,s] of [['armL',0.2,1],['armR',-0.2,-1]]){
    const sh=new THREE.Group(); sh.add(inked(hang(new THREE.CapsuleGeometry(0.052,0.12,4,12),c.shirt),c.shirt));
    const el=new THREE.Group(); el.position.y=-0.21; el.add(inked(hang(new THREE.CapsuleGeometry(0.046,0.1,4,12),c.skin),c.skin));
    const hand=inked(S(0.068,16,12),c.skin); hand.position.y=-0.27; el.add(hand); sh.add(el); parts[n+'Elbow']=el;
    add(n,sh,hips,[x,0.36,0]); }
  // head
  const head=new THREE.Group(); add('head',head,hips,[0,0.66,0]);
  head.add(inked(S(0.27,32,20),c.skin));
  const hairG=new THREE.SphereGeometry(0.285,32,20,0,Math.PI*2,0,Math.PI*0.56); const hair=inked(hairG,c.hair); hair.rotation.x=-0.42; hair.position.set(0,0.015,-0.01); head.add(hair); parts.hair=hair;
  const tuft=inked(S(0.07,12,10),c.hair); tuft.scale.set(1,1.6,1); tuft.position.set(0.02,0.31,0.1); tuft.rotation.z=-0.5; head.add(tuft);
  for(const x of [0.265,-0.265]){const ear=inked(S(0.055,12,10),c.skin); ear.scale.set(0.5,1,0.9); ear.position.set(x,0,0); head.add(ear);}
  const eyes=new THREE.Group(); head.add(eyes); parts.eyes=eyes;
  for(const x of [0.095,-0.095]){ const e=new THREE.Group(); e.position.set(x,0.01,0.222);
    const w=inked(S(0.062,16,12),0xffffff,{ink:true}); w.scale.set(1,1.2,0.5); e.add(w);
    const p=inked(S(0.034,12,10),c.pupil,{ink:false}); p.scale.set(1,1.2,0.5); p.position.set(0.005*Math.sign(x)*-1,0,0.03); e.add(p);
    eyes.add(e); }
  const nose=inked(S(0.03,10,8),c.skin,{ink:false}); nose.position.set(0,-0.045,0.265); nose.scale.set(1,0.8,0.8); head.add(nose);
  const mouth=new THREE.Mesh(new THREE.TorusGeometry(0.07,0.012,8,20,Math.PI),new THREE.MeshBasicMaterial({color:0x7a1f2b}));
  mouth.rotation.z=Math.PI; mouth.position.set(0,-0.105,0.235); mouth.rotation.x=-0.18; head.add(mouth); parts.mouth=mouth;
  for(const x of [0.15,-0.15]){const ch=new THREE.Mesh(S(0.035,10,8),new THREE.MeshBasicMaterial({color:0xff8a8a})); ch.scale.set(1,0.6,0.3); ch.position.set(x,-0.06,0.225); head.add(ch);}
  // animation: pure function of t (seconds)
  const wave=o.wave!==false;
  function update(t){
    const bob=Math.sin(t*Math.PI*2*1.2)*0.008; hips.position.y=0.46+bob;
    head.rotation.z=Math.sin(t*2.1)*0.05; head.rotation.y=Math.sin(t*1.1)*0.12;
    parts.armL.rotation.z=0.16+Math.sin(t*2.4)*0.03;
    const f=Math.sin(t*Math.PI*2*1.8);
    if(wave){ parts.armR.rotation.z=-2.25; parts.armR.rotation.x=0; parts.armRElbow.rotation.z=-0.3+f*0.75; }
    parts.legL.rotation.x=0; parts.legR.rotation.x=0;
    const b=(t%3.2)>3.08?0.15:1; eyes.scale.y=b;  // blink
  }
  update(0);
  return {group,parts,update};
}
