// Fast-mode toon look: 3-band shading + screen-constant inverted-hull ink outline.
import * as THREE from 'three';
export const INK = 0x2a1442;               // coloured ink, never black
const ramp = (() => { const d = new Uint8Array([140,140,140,255, 200,200,200,255, 255,255,255,255]);
  const t = new THREE.DataTexture(d,3,1,THREE.RGBAFormat); t.minFilter=t.magFilter=THREE.NearestFilter; t.needsUpdate=true; return t; })();
const matCache = new Map();
export function toon(color){ const k=color; if(!matCache.has(k)) matCache.set(k,new THREE.MeshToonMaterial({color,gradientMap:ramp})); return matCache.get(k); }
export const outlineUniforms = { uPx: { value: new THREE.Vector2(2/720*3, 2/1280*3) } }; // set by renderer
const hullMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, uniforms: { ...outlineUniforms, uInk: { value: new THREE.Color(INK) } },
  vertexShader: `uniform vec2 uPx; void main(){ vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.);
    vec3 n=normalize(normalMatrix*normal); vec2 d=(projectionMatrix*vec4(n,0.)).xy; d=length(d)>1e-5?normalize(d):vec2(0.);
    p.xy+=d*uPx*p.w; gl_Position=p; }`,
  fragmentShader: `uniform vec3 uInk; void main(){
 gl_FragColor=vec4(uInk,1.);
 #include <colorspace_fragment>
}` });
export function setOutlinePx(w,h,px){ outlineUniforms.uPx.value.set(2*px/w,2*px/h); }
// mesh with ink hull. thick=1 normal, 0 = no outline
export function inked(geo,color,{ink=true,shadow=true}={}){
  const g=new THREE.Group(); const m=new THREE.Mesh(geo,toon(color)); m.castShadow=shadow; m.receiveShadow=true; g.add(m);
  if(ink){ g.add(new THREE.Mesh(geo,hullMat)); } return g; }
