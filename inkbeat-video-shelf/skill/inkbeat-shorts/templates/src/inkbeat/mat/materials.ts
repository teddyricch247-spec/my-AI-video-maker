// Painterly textures + soft-banded toon material.
// Modifies three.js shader chunks (MIT, (c) three.js authors); see THIRD_PARTY_NOTICES.md
import * as THREE from "three";
import { hashStr, mulberry, PAINTERS } from "./paint";

export type TexKind = "plaster" | "planks" | "wood" | "stone" | "brick" | "roofTiles" | "shingles" | "rock" | "sand" | "grass" | "fabric" | "metal" | "paper" | "none";

export const TEX_KINDS: TexKind[] = ["plaster", "planks", "wood", "stone", "brick", "roofTiles", "shingles", "rock", "sand", "grass", "fabric", "metal", "paper", "none"];

// World meters covered by one texture tile at texScale = 1 (box/triplanar mapping).
// planks: 8 boards of 0.22 m; stone: 6 courses of 0.37 m; brick: 16 courses of 7 cm; roof: 8 rows of 0.25 m.
export const TILE_METERS: Record<TexKind, number> = {
  plaster: 3,
  planks: 1.8,
  wood: 1.4,
  stone: 2.2,
  brick: 1.15,
  roofTiles: 2,
  shingles: 2,
  rock: 5,
  sand: 3,
  grass: 1.6,
  fabric: 0.4,
  metal: 1.5,
  paper: 0.5,
  none: 1,
};

const TEX_SIZE: Partial<Record<TexKind, number>> = { fabric: 512, paper: 512 };

// ---------------------------------------------------------------- textures
const baseCache = new Map<string, THREE.Texture>();
const texCache = new Map<string, THREE.Texture>();

const finish = (tex: THREE.Texture) => {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
};

const paintBase = (kind: TexKind, color: string | undefined, seed: number) => {
  const key = `${kind}|${color ?? ""}|${seed}`;
  const hit = baseCache.get(key);
  if (hit) return hit;
  const S = kind === "none" ? 4 : TEX_SIZE[kind] ?? 1024;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const g = cv.getContext("2d")!;
  if (kind === "none") {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, S, S);
  } else {
    PAINTERS[kind](g, S, mulberry(hashStr(kind) ^ (seed * 7919 + 13)));
  }
  if (color) {
    g.globalCompositeOperation = "multiply";
    g.fillStyle = color;
    g.fillRect(0, 0, S, S);
    g.globalCompositeOperation = "source-over";
  }
  const tex = finish(new THREE.CanvasTexture(cv));
  tex.name = `toon:${kind}`;
  baseCache.set(key, tex);
  return tex;
};

/**
 * Painted, tileable, deterministic texture. Without `color` it is a neutral near-white detail map
 * (multiply it by a material color); with `color` the color is baked in. `scale` sets texture.repeat.
 * Cached: the same arguments always return the same Texture object.
 */
export function texture(kind: TexKind, opts: { color?: string; scale?: number; seed?: number } = {}): THREE.Texture {
  const seed = opts.seed ?? 0;
  const scale = opts.scale ?? 1;
  const key = `${kind}|${opts.color ?? ""}|${seed}|${scale}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const base = paintBase(kind, opts.color, seed);
  let tex = base;
  if (scale !== 1) {
    tex = base.clone(); // shares the image source (uploaded once)
    tex.repeat.set(scale, scale);
    tex.needsUpdate = true;
  }
  texCache.set(key, tex);
  return tex;
}

// ---------------------------------------------------------------- toon look (global, live-tweakable)
/** Shared uniforms for every toonMaterial. Change `.value` at render time (e.g. per act) and all materials follow. */
export const toonLook = {
  uShadowTint: { value: new THREE.Color(1.03, 0.86, 1.09) }, // multiplier in shade: magenta-violet
  uShadowAmt: { value: 0.75 },
  uHiTint: { value: new THREE.Color(1.08, 1.0, 0.86) }, // multiplier in full key light: warm cream
  uHiAmt: { value: 0.7 },
  uRimColor: { value: new THREE.Color("#ffd9b0") },
  uRimAmt: { value: 0.22 },
  uPaint: { value: 0.07 }, // painterly low-frequency color drift (±7%)
};

/** shadowTint / hiTint are RGB multipliers (≈1 ± 0.2), rimColor is a color. Call during render (deterministic). */
export const setToonLook = (o: { shadowTint?: [number, number, number]; shadowAmt?: number; hiTint?: [number, number, number]; hiAmt?: number; rimColor?: string; rimAmt?: number; paint?: number }) => {
  if (o.paint !== undefined) toonLook.uPaint.value = o.paint;
  if (o.shadowTint) toonLook.uShadowTint.value.setRGB(...o.shadowTint);
  if (o.shadowAmt !== undefined) toonLook.uShadowAmt.value = o.shadowAmt;
  if (o.hiTint) toonLook.uHiTint.value.setRGB(...o.hiTint);
  if (o.hiAmt !== undefined) toonLook.uHiAmt.value = o.hiAmt;
  if (o.rimColor) toonLook.uRimColor.value.set(o.rimColor);
  if (o.rimAmt !== undefined) toonLook.uRimAmt.value = o.rimAmt;
};

// soft 3-tone ramp (RGB): magenta-violet core shadow → cool mid → warm lit, smooth transitions
let rampTex: THREE.DataTexture | null = null;
export const toonRamp = () => {
  if (rampTex) return rampTex;
  const N = 256;
  const d = new Uint8Array(N * 4);
  const ss = (a: number, b: number, x: number) => {
    const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return u * u * (3 - 2 * u);
  };
  const shadow = [0.13, 0.08, 0.17];
  const mid = [0.6, 0.52, 0.62];
  const lit = [1.0, 0.97, 0.92];
  for (let i = 0; i < N; i++) {
    const x = i / (N - 1); // = dotNL*0.5+0.5
    const k1 = ss(0.47, 0.55, x); // terminator (dotNL -0.06 .. 0.1)
    const k2 = ss(0.56, 0.7, x); // mid → lit (dotNL 0.12 .. 0.4)
    const lift = 0.74 + 0.26 * ss(0.58, 1, x); // soft gradation inside the lit band (keeps faces apart)
    for (let c = 0; c < 3; c++) {
      const v = (shadow[c] * (1 - k1) + mid[c] * k1) * (1 - k2) + lit[c] * lift * k2;
      d[i * 4 + c] = Math.round(Math.min(1, v) * 255);
    }
    d[i * 4 + 3] = 255;
  }
  rampTex = new THREE.DataTexture(d, N, 1, THREE.RGBAFormat);
  rampTex.minFilter = THREE.LinearFilter;
  rampTex.magFilter = THREE.LinearFilter;
  rampTex.colorSpace = THREE.NoColorSpace;
  rampTex.needsUpdate = true;
  return rampTex;
};

// ---------------------------------------------------------------- shader patch
const VERT_PARS = /* glsl */ `
varying vec3 vTriP;
varying vec3 vTriN;
`;
const VERT_MAIN = /* glsl */ `
  vTriP = position * vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
  vTriN = normal;
`;

const FRAG_PARS = /* glsl */ `
uniform vec3 uShadowTint;
uniform float uShadowAmt;
uniform vec3 uHiTint;
uniform float uHiAmt;
uniform vec3 uRimColor;
uniform float uRimAmt;
uniform float uPaint;
uniform float uTriScale;
varying vec3 vTriP;
varying vec3 vTriN;
// Hash without Sine (c) 2014 David Hoskins, MIT; see THIRD_PARTY_NOTICES.md
float tn_h(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float tn_n(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(tn_h(i), tn_h(i+vec3(1,0,0)), f.x), mix(tn_h(i+vec3(0,1,0)), tn_h(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(tn_h(i+vec3(0,0,1)), tn_h(i+vec3(1,0,1)), f.x), mix(tn_h(i+vec3(0,1,1)), tn_h(i+vec3(1,1,1)), f.x), f.y), f.z);
}
`;

const FRAG_MAP = /* glsl */ `
#ifdef USE_MAP
  #ifdef TOON_TRI
    vec3 tw = pow(abs(normalize(vTriN)), vec3(6.0));
    tw /= (tw.x + tw.y + tw.z + 1e-5);
    vec3 tp = vTriP * uTriScale;
    vec4 sampledDiffuseColor = texture2D(map, vec2(tp.z, tp.y)) * tw.x + texture2D(map, vec2(tp.x, tp.z)) * tw.y + texture2D(map, vec2(tp.x, tp.y)) * tw.z;
  #else
    vec4 sampledDiffuseColor = texture2D(map, vMapUv);
  #endif
  diffuseColor *= sampledDiffuseColor;
#endif
  // painterly color drift over the surface (object space, so it sticks to moving objects)
  {
    float pn = tn_n(vTriP * 1.3) * 0.6 + tn_n(vTriP * 0.35 + 11.0) * 0.4 - 0.5;
    diffuseColor.rgb *= 1.0 + pn * uPaint * 2.0;
    diffuseColor.rgb *= vec3(1.0 + pn * uPaint * 0.6, 1.0, 1.0 - pn * uPaint * 0.8);
  }
`;

// gradient irradiance → RGB ramp (tinted terminator)
const GRAD = /* glsl */ `
#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.5 );
	#ifdef USE_GRADIENTMAP
		return texture2D( gradientMap, coord ).rgb;
	#else
		return vec3( smoothstep( 0.4, 0.6, coord.x ) );
	#endif
}
`;

const FRAG_OUT = /* glsl */ `
  vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
  {
    float dL = dot(reflectedLight.directDiffuse, vec3(0.2126, 0.7152, 0.0722));
    float iL = dot(reflectedLight.indirectDiffuse, vec3(0.2126, 0.7152, 0.0722));
    float litK = dL / (dL + iL * 0.8 + 1e-5);          // 0 in shade / ambient-only, 1 in full key
    float shadeK = (1.0 - smoothstep(0.15, 0.7, litK)) * uShadowAmt;
    // warm highlights only where the key light itself is warm (a blue moon key keeps cool highlights)
    vec3 keyCol = reflectedLight.directDiffuse / max(diffuseColor.rgb, vec3(0.03));
    float warmth = clamp((keyCol.r - keyCol.b) / (dot(keyCol, vec3(0.333)) + 1e-4) * 2.5, 0.0, 1.0);
    float hiK = smoothstep(0.55, 0.9, litK) * uHiAmt * warmth;
    outgoingLight *= mix(vec3(1.0), uShadowTint, shadeK);
    outgoingLight *= mix(vec3(1.0), uHiTint, hiK);
    // soft rim on vertical-ish surfaces (keeps round forms from going flat)
    vec3 wN = inverseTransformDirection(normal, viewMatrix);
    float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
    float rim = fres * (1.0 - abs(wN.y) * 0.85) * uRimAmt;
    outgoingLight += uRimColor * diffuseColor.rgb * rim * (0.35 + 0.65 * iL / (iL + 0.15));
  }
  outgoingLight += totalEmissiveRadiance;
`;

const patch = (mat: THREE.MeshToonMaterial) => {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, toonLook);
    shader.uniforms.uTriScale = mat.userData.triScale;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + VERT_PARS)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + VERT_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + FRAG_PARS)
      .replace("#include <map_fragment>", FRAG_MAP)
      .replace("#include <gradientmap_pars_fragment>", GRAD)
      .replace("vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;", FRAG_OUT);
  };
  // all patched materials share the same code; variants differ only by defines (part of the program key)
  mat.customProgramCacheKey = () => "toon-mat";
};

export type ToonOpts = {
  color: string;
  tex?: TexKind;
  texScale?: number; // box mapping: multiplier of the default density (2 = twice as many boards); uv mapping: repeat
  emissive?: string;
  emissiveIntensity?: number;
  side?: THREE.Side;
  transparent?: boolean;
  opacity?: number;
  mapping?: "box" | "uv"; // default "box": object-space triplanar, independent of the geometry's UVs
  seed?: number;
  vertexColors?: boolean;
  depthWrite?: boolean;
};

const matCache = new Map<string, THREE.MeshToonMaterial>();

/** Cached soft-banded toon material (MeshToonMaterial + RGB ramp, tinted shadows, warm highlights, rim). */
export function toonMaterial(o: ToonOpts): THREE.Material {
  const key = JSON.stringify([o.color, o.tex, o.texScale, o.emissive, o.emissiveIntensity, o.side, o.transparent, o.opacity, o.mapping, o.seed, o.vertexColors, o.depthWrite]);
  const hit = matCache.get(key);
  if (hit) return hit;
  const tex = o.tex && o.tex !== "none" ? o.tex : undefined;
  const mapping = o.mapping ?? "box";
  const mat = new THREE.MeshToonMaterial({
    color: o.color,
    gradientMap: toonRamp(),
    emissive: o.emissive ?? "#000000",
    emissiveIntensity: o.emissiveIntensity ?? (o.emissive ? 1 : 0),
    side: o.side ?? THREE.FrontSide,
    transparent: o.transparent ?? false,
    opacity: o.opacity ?? 1,
    vertexColors: o.vertexColors ?? false,
    depthWrite: o.depthWrite ?? true,
  });
  mat.userData.triScale = { value: 1 };
  if (tex) {
    if (mapping === "box") {
      mat.map = texture(tex, { seed: o.seed });
      mat.defines = { TOON_TRI: "" };
      mat.userData.triScale.value = (o.texScale ?? 1) / TILE_METERS[tex];
    } else {
      mat.map = texture(tex, { seed: o.seed, scale: o.texScale ?? 1 });
    }
  }
  patch(mat);
  matCache.set(key, mat);
  return mat;
}
