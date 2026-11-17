// Character materials: a smooth wrap-lit toon material for skin, cloth, hair and hats (form shade toward the
// silhouette and the underside, a warm skin shade, a cool cloth shade, a back-light rim, a restrained sheen), an
// object-space face decal with a flush, and the inverted-hull ink. The numbers live in family.ts (LIGHT, INK, INK_PX).
// Modifies three.js shader chunks (MIT, (c) three.js authors); see THIRD_PARTY_NOTICES.md
import * as THREE from "three";
import { INK, INK_PX, LIGHT } from "./family";

export { INK };

// ------------------------------------------------------------------ wrap ramp (smooth, never banded)
// x = dotNL * 0.5 + 0.5. A wide soft terminator: full key from dotNL ≈ 0.45, zero below dotNL ≈ -0.5.
let ramp: THREE.DataTexture | null = null;
export const charRamp = () => {
  if (ramp) return ramp;
  const N = 256;
  const d = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    const dot = (i / (N - 1)) * 2 - 1;
    let u = Math.min(1, Math.max(0, (dot + 0.5) / 0.95));
    u = u * u * (3 - 2 * u);
    // the lit side keeps a gentle gradient instead of a plateau
    const v = Math.min(1, u * (0.82 + 0.18 * Math.min(1, Math.max(0, (dot + 0.1) / 1.1))));
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = Math.round(v * 255);
    d[i * 4 + 3] = 255;
  }
  ramp = new THREE.DataTexture(d, N, 1, THREE.RGBAFormat);
  ramp.minFilter = THREE.LinearFilter;
  ramp.magFilter = THREE.LinearFilter;
  ramp.colorSpace = THREE.NoColorSpace;
  ramp.needsUpdate = true;
  return ramp;
};

/** Global look of every character material (tweak per act, e.g. a stronger rim at night). */
export const charLook = {
  uShadowTint: { value: new THREE.Color(...LIGHT.shadowTint) }, // ambient multiplier (cool cloth shade)
  uSkinShade: { value: new THREE.Color(...LIGHT.skinShade) }, // extra warmth in the skin's shadow side
  uRimAmt: { value: LIGHT.rim }, // back-light rim strength
  uEdge: { value: LIGHT.edge }, // soft form shade toward the silhouette
  uFillRim: { value: LIGHT.fillRim }, // a whisper of ambient fresnel so dark clothes keep their silhouette
  uSkinKeep: { value: LIGHT.skinKeep }, // 0..1: how much a warm key is desaturated on skin
  uSkinLift: { value: LIGHT.skinLift }, // 1 = off; > 1 lifts mid / shadow skin
  uSkinWhite: { value: LIGHT.skinWhite }, // 0..1 pull of lit skin toward neutral
  uSkinMax: { value: LIGHT.skinMax }, // skin and face whites roll off below this
  // decal ink and hulls are pushed this far below black in the linear HDR color pass, so bloom from the lit face
  // that lands on them cancels and they grade to the same black as the post ink lines
  uInkDeep: { value: LIGHT.inkDeep },
};

const VERT_PARS = /* glsl */ `
varying vec3 vObjP;
varying vec3 vWorldN;
`;
const VERT_MAIN = /* glsl */ `
  vObjP = position;
  vWorldN = normalize(mat3(modelMatrix) * objectNormal);
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vObjP;
varying vec3 vWorldN;
uniform vec3 uShadowTint;
uniform vec3 uSkinShade;
uniform float uRimAmt;
uniform float uEdge;
uniform float uFillRim;
uniform float uSpec;
uniform float uGloss;
uniform float uFlush;
uniform float uSkinKeep;
uniform float uSkinLift;
uniform float uSkinWhite;
uniform float uSkinMax;
uniform float uFaceScale;
uniform float uFaceSpan;
uniform vec2 uFaceOffset;
uniform float uRimK;
uniform float uInkDeep;
#ifdef CHAR_FACE
uniform sampler2D uFaceMap;
#endif
`;

// face decal: planar projection of head-local xy onto the front of the head
const FRAG_MAP = /* glsl */ `
#include <map_fragment>
#ifdef CHAR_FACE
  vec4 faceDecal = vec4(0.0);
  float faceMask = 0.0;
  vec3 skinAlbedo = diffuseColor.rgb;
  {
    vec2 fuv = vec2(0.5) + (vObjP.xy - uFaceOffset) * uFaceScale;
    vec2 cp = (vObjP.xy - uFaceOffset) * uFaceScale * 2.0 * uFaceSpan; // head half-widths, y up
    float zh = vObjP.z * uFaceScale * 2.0 * uFaceSpan;
    float front = smoothstep(-0.05, 0.16, zh);
    // under the mouth the decal wraps a little around the jaw and under the chin (beard)
    float wrapM = smoothstep(-0.62, -0.46, -cp.y) * smoothstep(-0.7, -0.5, zh);
    vec4 fc = texture2D(uFaceMap, fuv);
    // flush: cheeks first, then the whole face
    float cheek = max(1.0 - length((cp - vec2(0.55, -0.36)) / vec2(0.28, 0.18)), 0.0)
                + max(1.0 - length((cp - vec2(-0.55, -0.36)) / vec2(0.28, 0.18)), 0.0);
    cheek = smoothstep(0.0, 0.7, cheek);
    float fl = uFlush * (0.4 + 0.52 * cheek) * front;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.32, 0.3), clamp(fl, 0.0, 0.8));
    skinAlbedo = diffuseColor.rgb;
    faceDecal = fc;
    faceMask = fc.a * max(front, wrapM);
  }
#endif
`;

const LIGHTS_PARS = /* glsl */ `
varying vec3 vViewPosition;
struct ToonMaterial { vec3 diffuseColor; };
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
  vec3 lc = directLight.color;
#ifdef CHAR_FACE
  // skin keeps its own color under warm practicals; cool light keeps its color
  {
    float mx = max(max(lc.r, lc.g), max(lc.b, 1e-4));
    float warm = clamp((lc.r - lc.b) / mx, 0.0, 1.0);
    float l = dot(lc, vec3(0.2126, 0.7152, 0.0722));
    vec3 d = mix(lc, vec3(l), uSkinKeep * smoothstep(0.05, 0.45, warm));
    lc = d * (mx / max(max(d.r, d.g), max(d.b, 1e-4)));
  }
#endif
  vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * lc;
  reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
  float nl = dot(geometryNormal, directLight.direction);
  float nv = clamp(dot(geometryNormal, geometryViewDir), 0.0, 1.0);
  float fr = 1.0 - nv;
  // back-light rim: a thin band just inside the silhouette on the side facing a light behind
  float back = smoothstep(-0.2, 0.5, -dot(directLight.direction, geometryViewDir));
  float rim = smoothstep(0.7, 0.83, fr) * smoothstep(0.0, 0.42, nl) * back;
  reflectedLight.directSpecular += directLight.color * rim * uRimAmt * uRimK * (0.3 + 0.7 * material.diffuseColor) * 0.6;
  // sheen: a soft streak along the lit silhouette + a small highlight
  if (uSpec + uGloss > 0.0) {
    float streak = smoothstep(0.66, 0.71, fr) * (1.0 - smoothstep(0.76, 0.81, fr)) * smoothstep(0.25, 0.6, nl);
    vec3 hv = normalize(directLight.direction + geometryViewDir);
    float bl = smoothstep(0.978, 0.989, dot(geometryNormal, hv));
    reflectedLight.directSpecular += min(directLight.color, vec3(1.5)) * (streak * 0.45 * uSpec + bl * 0.5 * uGloss) * 0.4;
  }
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
  reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct RE_Direct_Toon
#define RE_IndirectDiffuse RE_IndirectDiffuse_Toon
`;

const FRAG_OUT = /* glsl */ `
#ifdef CHAR_FACE
  vec3 shadeTint = uShadowTint * uSkinShade;
#else
  vec3 shadeTint = uShadowTint;
#endif
  vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse * shadeTint;
  {
    vec3 vN = normalize(normal);
    float nv = clamp(dot(vN, normalize(vViewPosition)), 0.0, 1.0);
    float edge = 1.0 - smoothstep(0.0, 0.6, nv);
    float under = 1.0 - smoothstep(-0.85, 0.25, vWorldN.y);
    outgoingLight *= 1.0 - uEdge * edge * (0.55 + 0.75 * under) - 0.09 * under;
    outgoingLight += reflectedLight.indirectDiffuse * smoothstep(0.55, 0.95, 1.0 - nv) * uFillRim * 4.0 * uRimK;
    outgoingLight += reflectedLight.directSpecular;
  }
#ifdef CHAR_FACE
  {
    // the light falling on this point, independent of the skin color: the decal is lit by it
    vec3 lightK = min(outgoingLight / max(skinAlbedo, vec3(0.02)), vec3(1.6));
    // skin: a gentle lift of the mid / shadow values, hue kept, rolled off before clipping
    vec3 c = max(outgoingLight, vec3(0.0));
    float mx = max(max(c.r, c.g), max(c.b, 1e-4));
    float x = mx / (1.0 + max(mx - 1.0, 0.0));
    float lifted = (1.0 - pow(1.0 - clamp(x, 0.0, 1.0), uSkinLift)) * uSkinMax;
    c *= lifted / mx;
    float cm = max(max(c.r, c.g), c.b);
    c = mix(c, vec3(cm * 0.985), uSkinWhite * smoothstep(0.15, 0.7, cm));
    // decal: its own color under the same light (ink stays ink, eye whites stay white on any skin tone)
    vec3 dc = faceDecal.rgb * lightK;
    float dm = max(max(dc.r, dc.g), max(dc.b, 1e-4));
    dc *= min(1.0, uSkinMax / dm);
    outgoingLight = mix(c, dc, faceMask);
    float inkness = faceMask * (1.0 - smoothstep(0.05, 0.18, max(max(faceDecal.r, faceDecal.g), faceDecal.b)));
    outgoingLight -= vec3(uInkDeep * inkness);
  }
#endif
  outgoingLight += totalEmissiveRadiance;
`;

const patch = (m: THREE.MeshToonMaterial, extra: Record<string, THREE.IUniform>) => {
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, charLook, extra);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\n" + VERT_PARS)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + VERT_MAIN);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\n" + FRAG_PARS)
      .replace("#include <map_fragment>", FRAG_MAP)
      .replace("#include <lights_toon_pars_fragment>", LIGHTS_PARS)
      .replace("vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;", FRAG_OUT);
  };
  m.customProgramCacheKey = () => "char-family" + (m.defines && "CHAR_FACE" in m.defines ? "-skin" : "");
};

const baseUniforms = (o: { spec?: number; gloss?: number; rim?: number }) => ({
  uSpec: { value: o.spec ?? 0 },
  uGloss: { value: o.gloss ?? 0 },
  uFlush: { value: 0 },
  uFaceScale: { value: 1 },
  uFaceSpan: { value: 1 },
  uFaceOffset: { value: new THREE.Vector2() },
  uRimK: { value: o.rim ?? 1 },
});

const cache = new Map<string, THREE.MeshToonMaterial>();
/** Shared lit character material (cloth, hair, hats, shoes, props). spec 0..1 = sheen streak, gloss = highlight. */
export const charMat = (color: string, o: { spec?: number; gloss?: number; map?: THREE.Texture | null; emissive?: string; side?: THREE.Side; rim?: number } = {}) => {
  const key = [color, o.spec ?? 0, o.gloss ?? 0, o.map ? o.map.uuid : "", o.emissive ?? "", o.side ?? 0, o.rim ?? 1].join("|");
  const hit = cache.get(key);
  if (hit) return hit;
  const m = new THREE.MeshToonMaterial({ color, gradientMap: charRamp(), map: o.map ?? null, side: o.side ?? THREE.FrontSide });
  if (o.emissive) {
    m.emissive.set(o.emissive);
    m.emissiveIntensity = 1;
  }
  patch(m, baseUniforms(o));
  if (cache.size > 400) cache.clear();
  cache.set(key, m);
  return m;
};

export type FaceUniforms = { uFaceMap: { value: THREE.Texture | null }; uFlush: { value: number }; uFaceScale: { value: number }; uFaceSpan: { value: number } };

/** Per-instance skin material that carries the face decal (one per head). */
export const faceMat = (albedo: string, faceScale: number, faceSpan: number) => {
  const m = new THREE.MeshToonMaterial({ color: albedo, gradientMap: charRamp() });
  m.defines = { CHAR_FACE: "" };
  const u = { ...baseUniforms({}), uFaceMap: { value: null as THREE.Texture | null } };
  u.uFaceScale.value = faceScale;
  u.uFaceSpan.value = faceSpan;
  patch(m, u as unknown as Record<string, THREE.IUniform>);
  m.userData.u = u;
  return m;
};

let blank: THREE.DataTexture | null = null;
const skinCache = new Map<string, THREE.MeshToonMaterial>();
/** Shared skin material without a decal (neck, ears, hands): lit exactly like the face. */
export const skinMat = (albedo: string) => {
  const hit = skinCache.get(albedo);
  if (hit) return hit;
  if (!blank) {
    blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat);
    blank.needsUpdate = true;
  }
  const m = faceMat(albedo, 1, 1);
  (m.userData.u as FaceUniforms).uFaceMap.value = blank;
  if (skinCache.size > 64) skinCache.clear();
  skinCache.set(albedo, m);
  return m;
};

// ------------------------------------------------------------------ inverted-hull ink
const HULL_VERT = /* glsl */ `
uniform float uWidth;      // object units (character h = 1) at the sides
uniform float uUnder;      // extra factor for the underside (n.y < 0)
uniform float uMinPx;      // never thinner than this on screen
uniform float uViewH;      // viewport height in px
uniform float uMaxPx;      // never wider than this on screen (sides; the underside may reach 1.6x)
#include <common>
#include <clipping_planes_pars_vertex>
void main() {
  vec3 n = normalize(normal);
  vec3 wn = normalize(mat3(modelMatrix) * n);
  float sc = length(modelMatrix[0].xyz);
  vec4 mv0 = modelViewMatrix * vec4(position, 1.0);
  float wpp = 2.0 * max(-mv0.z, 0.01) / (projectionMatrix[1][1] * uViewH);
  if (projectionMatrix[3][3] > 0.5) wpp = 2.0 / (projectionMatrix[1][1] * uViewH);
  float under = 1.0 - smoothstep(-0.9, 0.2, wn.y);
  float w = uWidth * (1.0 + uUnder * under);
  // capped in px: in close-ups the hull and the post ink on both of its edges merge into one solid stroke
  w = min(w, uMaxPx * (1.0 + 0.6 * under) * wpp / sc);
  w = max(w, uMinPx * wpp / sc);
  vec3 p = position + n * w;
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  // push the hull a hair back so it never z-fights the surface it outlines
  gl_Position.z += 0.00002 * gl_Position.w;
  #include <clipping_planes_vertex>
}
`;
const HULL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uInkDeep;
void main() {
  gl_FragColor = vec4(uColor - vec3(uInkDeep), 1.0);
  #include <colorspace_fragment>
}
`;

export const hullUniforms = { uViewH: { value: 1920 }, uInk: { value: new THREE.Color(INK) }, uMaxPx: { value: INK_PX.max } };
/** Character ink color for every hull and flat-ink part (e.g. a bluer ink at night). Call during render. */
export const setCharInk = (c: string) => {
  hullUniforms.uInk.value.set(c);
  inkMat().color.set(c);
};
const hullCache = new Map<string, THREE.ShaderMaterial>();

/** Ink hull: width in object units of the character (h = 1). */
export const hullMat = (width: number, under = 0.5, color?: string, minPx = INK_PX.min) => {
  const key = [width.toFixed(5), under, color ?? "shared", minPx].join("|");
  const hit = hullCache.get(key);
  if (hit) return hit;
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uWidth: { value: width },
      uUnder: { value: under },
      uMinPx: { value: minPx },
      uColor: color ? { value: new THREE.Color(color) } : hullUniforms.uInk,
      uViewH: hullUniforms.uViewH,
      uMaxPx: hullUniforms.uMaxPx,
      uInkDeep: charLook.uInkDeep,
    },
    vertexShader: HULL_VERT,
    fragmentShader: HULL_FRAG,
    side: THREE.BackSide,
    fog: false,
    lights: false,
  });
  hullCache.set(key, m);
  return m;
};

const inkCache = new Map<string, THREE.MeshBasicMaterial>();
/** Flat ink (the hem line of hair under a hat, glasses wire). */
export const inkMat = (color = "shared") => {
  const hit = inkCache.get(color);
  if (hit) return hit;
  const m = new THREE.MeshBasicMaterial({ color: color === "shared" ? INK : color, toneMapped: false });
  inkCache.set(color, m);
  return m;
};
