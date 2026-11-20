// Beat camera rig. Pure function of t.
// 9:16 Shorts: no cuts. Each beat is a ~0.6-0.9 s eased move starting LEAD s before its anchor word, and between moves the
//   camera never stops (slow push toward the look target + small lateral arc).
// 16:9 long form (calm): makeRig(beats, { drift: 0, arc: 0 }) and use `cut:true` beats (hard cut on the word, no move) plus
//   an optional `zoom` (0.06-0.14) for a slow eased push across the whole hold. See references/camera-and-editing.md.
const LEAD=0.2, ease=x=>x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;   // symmetric ease-in-out
const lerp=(a,b,k)=>a+(b-a)*k, lerp3=(a,b,k)=>[lerp(a[0],b[0],k),lerp(a[1],b[1],k),lerp(a[2],b[2],k)];
const clamp01=x=>Math.min(1,Math.max(0,x));
// beats: [{at, dur, pos:[x,y,z], look:[x,y,z], fov, roll, cut, zoom}] ; first beat is the start pose (at ignored).
//   cut:true  -> hard cut exactly at `at` (snapped to half a frame so motion blur never blends two shots), dur ignored.
//   zoom:0.1  -> after landing, push 10% of the pos->look distance, eased across the hold until the next beat.
export function makeRig(beats,{drift=0.05,arc=0.035,fps=30}={}){
  const cutT=at=>(Math.round(at*fps)-0.5)/fps;
  const B=beats.map((b,i)=>({fov:70,roll:0,dur:0.7,zoom:0,...b,start:i?(b.cut?cutT(b.at):b.at-LEAD):-1e9}));
  // state(j,s): pose at time s while beat j is active. Each move starts from where the previous beat's camera actually was
  // (including its drift and zoom), so there is no jump at the start of a move. Roll persists (lerped), it is not a bump.
  function state(j,s){
    const b=B[j]; let pos=b.pos,look=b.look,fov=b.fov,roll=b.roll, landed=0;
    if(j){
      if(b.cut) landed=b.start;
      else{ const f=state(j-1,b.start), k=clamp01((s-b.start)/b.dur), e=ease(k);
        pos=lerp3(f.pos,b.pos,e); look=lerp3(f.look,b.look,e); fov=lerp(f.fov,b.fov,e); roll=lerp(f.roll,b.roll,e); landed=b.start+b.dur; }
    }
    const td=Math.max(0,s-landed), dir=[b.look[0]-b.pos[0],b.look[1]-b.pos[1],b.look[2]-b.pos[2]];
    // drift after landing: push toward the look target (drift = fraction of the distance per second) + small lateral arc
    // zoom: one eased push across the whole hold (long form)
    const holdEnd=j+1<B.length?B[j+1].start:landed+5;
    const zk=b.zoom?b.zoom*ease(clamp01((s-landed)/Math.max(0.1,holdEnd-landed))):0;
    const dd=drift*td+zk;
    pos=[pos[0]+dir[0]*dd+dir[2]*arc*td, pos[1]+dir[1]*dd, pos[2]+dir[2]*dd-dir[0]*arc*td];
    return {pos,look,fov,roll};
  }
  return function poseAt(t){ let i=0; while(i+1<B.length&&t>=B[i+1].start)i++; return state(i,t); };
}
// Long form (16:9): turn a list of beats into calm ones. Every beat after the first becomes a hard cut on its word, roll is dropped,
// and about one framing in `every` gets a slow eased push (`zoom`, 0.06-0.14). Use with makeRig(calm(beats), { drift: 0, arc: 0 }).
// Hold each framing 3-6 s in a real film: plan fewer beats than a Short (see references/camera-and-editing.md).
export function calm(beats,{zoom=0.1,every=3}={}){ return beats.map((b,i)=>i?{...b,cut:true,roll:0,zoom:b.zoom??(i%every===1?zoom:0)}:{...b,roll:0}); }
// Beat fov values are written for a 9:16 frame. In a landscape frame (camera.aspect > 1) they are divided by 1.4 so a framing
// keeps a sane lens (vertical fov x1.4 is the 16:9 -> 9:16 rule in the skill). Pass {exact:true} to use the numbers as written.
export const LAND_FOV=1/1.4;
export function applyPose(cam,p,{exact=false}={}){
  cam.position.set(...p.pos); cam.up.set(Math.sin(p.roll),Math.cos(p.roll),0); cam.lookAt(...p.look);
  cam.fov=p.fov*(cam.aspect>1&&!exact?LAND_FOV:1); cam.updateProjectionMatrix();
}
