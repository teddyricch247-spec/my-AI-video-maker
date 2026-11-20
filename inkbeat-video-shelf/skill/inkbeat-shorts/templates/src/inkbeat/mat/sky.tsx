// SkyDome: camera-centered painted sky at infinity: 3-stop gradient with brush variation, stylized
// cumulus and streak clouds (painted masks, recolored live), optional sun disc + halo + rays,
// optional moon and stars. Deterministic in t. Writes no depth (PostFX treats it as infinitely far).
import React, { useMemo } from "react";
import * as THREE from "three";
import type { V3 } from "../types";
import { mulberry } from "./paint";

const NOISE = /* glsl */ `
// Hash without Sine (c) 2014 David Hoskins, MIT; see THIRD_PARTY_NOTICES.md
float h13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(h13(i), h13(i+vec3(1,0,0)), f.x), mix(h13(i+vec3(0,1,0)), h13(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(h13(i+vec3(0,0,1)), h13(i+vec3(1,0,1)), f.x), mix(h13(i+vec3(0,1,1)), h13(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
`;

const SKY_V = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 p = projectionMatrix * viewMatrix * vec4(cameraPosition + vDir * 100.0, 1.0);
  p.z = p.w * 0.99999;
  gl_Position = p;
}`;

const SKY_F = /* glsl */ `
uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBot;
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uSunSize; uniform float uSunOn; uniform float uRays;
uniform vec3 uMoonDir; uniform vec3 uMoonCol; uniform float uMoonSize; uniform float uMoonOn;
uniform float uStars; uniform float uT; uniform float uHorizon; uniform float uBrush;
varying vec3 vDir;
${NOISE}
void main(){
  vec3 d = normalize(vDir);
  float e = d.y;
  float hm = uHorizon;
  vec3 c = e > hm ? mix(uMid, uTop, smoothstep(hm, 0.8, e)) : mix(uBot, uMid, smoothstep(-0.02, hm, e));
  // painterly: broad soft brush variation, stretched horizontally like hand-laid gradient strokes
  float n = fbm(vec3(d.x * 2.2, d.y * 7.0, d.z * 2.2)) - 0.5;
  c *= 1.0 + n * uBrush;
  // sun: halo, horizon glow toward its azimuth, rays, disc
  if (uSunOn > 0.0) {
    float ang = acos(clamp(dot(d, uSunDir), -1.0, 1.0));
    float rd = uSunSize;
    float halo = exp(-ang / (rd * 1.6)) * 0.85 + exp(-ang / (rd * 6.0)) * 0.45 + exp(-ang / (rd * 18.0)) * 0.2;
    float az = max(dot(normalize(d.xz + 1e-5), normalize(uSunDir.xz + 1e-5)), 0.0);
    float hz = exp(-abs(e - uSunDir.y * 0.5) / 0.09) * pow(az, 4.0) * 0.55;
    c = mix(c, uSunCol, clamp((halo + hz) * uSunOn, 0.0, 1.0));
    if (uRays > 0.0) {
      vec3 ux = normalize(cross(uSunDir, vec3(0.0, 1.0, 0.0)) + 1e-5);
      vec3 vy = cross(ux, uSunDir);
      float th = atan(dot(d, vy), dot(d, ux));
      float r = 0.5 + 0.5 * sin(th * 13.0 + 1.7 * sin(th * 5.0) + uT * 0.15);
      r = smoothstep(0.45, 0.85, r) * exp(-ang / 0.55) * smoothstep(rd * 1.2, rd * 3.0, ang);
      c += uSunCol * r * uRays * 0.35 * uSunOn;
    }
    float fw = fwidth(ang) * 1.5;
    float disc = 1.0 - smoothstep(rd - fw, rd + fw, ang);
    vec3 core = mix(uSunCol, vec3(1.0, 0.98, 0.9), 0.65);
    c = mix(c, core, disc * uSunOn);
  }
  if (uMoonOn > 0.0) {
    float ang = acos(clamp(dot(d, uMoonDir), -1.0, 1.0));
    float rd = uMoonSize;
    float fw = fwidth(ang) * 1.5;
    float disc = 1.0 - smoothstep(rd - fw, rd + fw, ang);
    float glow = exp(-ang / (rd * 1.2)) * 0.5 + exp(-ang / (rd * 5.0)) * 0.25;
    c = mix(c, uMoonCol, clamp(glow * uMoonOn, 0.0, 1.0));
    float mare = smoothstep(0.55, 0.75, fbm(d * 60.0));
    vec3 mc = mix(vec3(1.0, 0.98, 0.95), uMoonCol, 0.35) * (1.0 - 0.12 * mare);
    c = mix(c, mc, disc * uMoonOn);
  }
  if (uStars > 0.0 && e > 0.0) {
    float az = atan(d.x, -d.z);
    float el = asin(clamp(e, -1.0, 1.0));
    vec2 g = vec2(az * cos(el), el) / 0.016;
    vec2 cell = floor(g);
    float h = h13(vec3(cell, 7.0));
    if (h < 0.22) {
      vec2 o = vec2(h13(vec3(cell, 1.0)), h13(vec3(cell, 2.0))) * 0.7 + 0.15;
      float dist = length(g - cell - o) * 0.016;
      float size = 0.0006 + 0.0011 * h13(vec3(cell, 3.0));
      float tw = 0.65 + 0.35 * sin(uT * (1.5 + 3.0 * h13(vec3(cell, 4.0))) + h * 60.0);
      float fw = fwidth(dist);
      float s = (1.0 - smoothstep(size - fw, size + fw, dist)) + exp(-dist / (size * 1.6)) * 0.25;
      c += vec3(1.0, 0.96, 0.9) * s * tw * uStars * smoothstep(0.02, 0.25, e);
    }
  }
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
  gl_FragColor.rgb += (h13(vec3(gl_FragCoord.xy, 3.0)) - 0.5) / 255.0;
}`;

// ---------------------------------------------------------------- painted cloud atlas
// 2 × 4 cells of 1024 × 512. Channels: R coverage, G lit-from-below, B lit-from-above, A brush (128..255).
const CELL_W = 1024;
const CELL_H = 512;
export const CLOUD_VARIANTS = 8;
// which variants are streaks vs puffs
const STREAK = [2, 3, 5];
const PUFF = [0, 1, 4, 6, 7];

type Shape = (g: CanvasRenderingContext2D, ox: number, oy: number) => void;

const bounds: [number, number][] = []; // per variant: [top y, bottom y] of the painted shape
const makeShapes = (): Shape[] => {
  const shapes: Shape[] = [];
  for (let v = 0; v < CLOUD_VARIANTS; v++) {
    const r = mulberry(9001 + v * 131);
    if (STREAK.includes(v)) {
      // long lens streaks: tapered ellipses, sometimes stacked
      const parts: [number, number, number, number][] = [];
      const n = v === 3 ? 2 : v === 5 ? 3 : 1;
      for (let i = 0; i < n; i++) {
        const cx = CELL_W * (0.5 + (r() - 0.5) * (n > 1 ? 0.25 : 0.05));
        const w = Math.min(CELL_W * (0.42 - i * 0.06) * (0.9 + r() * 0.1), Math.min(cx, CELL_W - cx) - CELL_W * 0.03);
        const h = CELL_H * (0.13 + r() * 0.05) * (n > 1 ? 0.8 : 1.1);
        const cy = CELL_H * (0.5 + (i - (n - 1) / 2) * 0.24);
        parts.push([cx, cy, w, h]);
      }
      bounds[v] = [Math.min(...parts.map((q) => q[1] - q[3] * 1.0)), Math.max(...parts.map((q) => q[1] + q[3] * 0.7))];
      shapes.push((g, ox, oy) => {
        for (const [cx, cy, w, h] of parts) {
          g.beginPath();
          // lens: flat-ish bottom, rounded top, pointed ends
          g.moveTo(ox + cx - w, oy + cy + h * 0.25);
          g.bezierCurveTo(ox + cx - w * 0.6, oy + cy - h * 1.15, ox + cx + w * 0.5, oy + cy - h * 1.2, ox + cx + w, oy + cy + h * 0.15);
          g.bezierCurveTo(ox + cx + w * 0.55, oy + cy + h * 0.75, ox + cx - w * 0.55, oy + cy + h * 0.85, ox + cx - w, oy + cy + h * 0.25);
          g.fill();
        }
      });
    } else {
      // flattened cumulus: a rounded flat-bottomed body with 3-5 big lobes on top
      const tall = v === 6 ? 1.35 : v === 1 ? 1.15 : 1;
      const span = v === 4 ? 0.5 : v === 7 ? 0.8 : 0.7;
      const yb = CELL_H * 0.86;
      const hb = CELL_H * 0.2 * tall;
      const x0 = CELL_W * (0.5 - span / 2);
      const x1 = CELL_W * (0.5 + span / 2);
      const lobes: [number, number, number][] = [];
      const nb = 3 + Math.floor(r() * 3);
      for (let i = 0; i < nb; i++) {
        const u = nb === 1 ? 0.5 : i / (nb - 1);
        const cx = x0 + hb * 0.7 + u * (x1 - x0 - hb * 1.4) + (r() - 0.5) * 30;
        const env = Math.sin(Math.PI * (0.15 + 0.7 * u));
        let rad = CELL_H * (0.13 + 0.2 * env * (0.75 + r() * 0.4)) * tall;
        rad = Math.min(rad, (x1 - x0) * 0.3);
        let cy = yb - hb * 0.55 - rad * (0.3 + r() * 0.25);
        if (cy - rad < CELL_H * 0.04) cy = CELL_H * 0.04 + rad;
        lobes.push([cx, cy, rad]);
      }
      shapes.push((g, ox, oy) => {
        g.beginPath();
        g.roundRect(ox + x0, oy + yb - hb, x1 - x0, hb, hb / 2);
        g.fill();
        for (const [cx, cy, rad] of lobes) {
          g.beginPath();
          g.arc(ox + cx, oy + cy, rad, 0, Math.PI * 2);
          g.fill();
        }
      });
      bounds[v] = [Math.min(...lobes.map((l) => l[1] - l[2])), yb];
    }
  }
  return shapes;
};

let atlas: THREE.DataTexture | null = null;
const cloudAtlas = () => {
  if (atlas) return atlas;
  const W = CELL_W * 2;
  const H = CELL_H * 4;
  const shapes = makeShapes();
  const chan = (fn: (g: CanvasRenderingContext2D, ox: number, oy: number, s: Shape, v: number) => void) => {
    const cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    const g = cv.getContext("2d")!;
    g.fillStyle = "#000";
    g.fillRect(0, 0, W, H);
    for (let v = 0; v < CLOUD_VARIANTS; v++) {
      const ox = (v % 2) * CELL_W;
      const oy = Math.floor(v / 2) * CELL_H;
      g.save();
      g.beginPath();
      g.rect(ox, oy, CELL_W, CELL_H);
      g.clip();
      fn(g, ox, oy, shapes[v], v);
      g.restore();
    }
    return g.getImageData(0, 0, W, H).data;
  };
  // coverage with a slightly soft painted edge
  const cov = chan((g, ox, oy, s) => {
    g.filter = "blur(2.5px)";
    g.fillStyle = "#fff";
    s(g, ox, oy);
    g.filter = "none";
  });
  // lit from below: vertical gradient inside the shape (lower ~half) plus a crisper rim band along the bottom edge
  const band = (g: CanvasRenderingContext2D, ox: number, oy: number, s: Shape, dx: number, dy: number, blur: number) => {
    const tmp = document.createElement("canvas");
    tmp.width = CELL_W * 2;
    tmp.height = CELL_H * 4;
    const t = tmp.getContext("2d")!;
    t.fillStyle = "#fff";
    s(t, ox, oy);
    t.globalCompositeOperation = "destination-out";
    t.filter = `blur(${blur}px)`;
    s(t, ox + dx, oy + dy);
    t.filter = "none";
    return tmp;
  };
  const below = chan((g, ox, oy, s, v) => {
    const st = STREAK.includes(v);
    const [y0, y1] = bounds[v];
    const hgt = y1 - y0;
    const gr = g.createLinearGradient(0, oy + y0 + hgt * (st ? 0.35 : 0.42), 0, oy + y1 - hgt * (st ? 0.1 : 0.12));
    gr.addColorStop(0, "#000");
    gr.addColorStop(1, "#fff");
    g.fillStyle = gr;
    g.filter = "blur(3px)";
    s(g, ox, oy);
    g.globalCompositeOperation = "lighten";
    g.filter = "blur(3px)";
    g.drawImage(band(g, ox, oy, s, 0, -hgt * (st ? 0.3 : 0.16), st ? 6 : 10), 0, 0);
    g.filter = "none";
    g.globalCompositeOperation = "source-over";
  });
  // lit from above: soft top-down gradient plus the top rim of every lobe
  const above = chan((g, ox, oy, s, v) => {
    const st = STREAK.includes(v);
    const [y0, y1] = bounds[v];
    const hgt = y1 - y0;
    const gr = g.createLinearGradient(0, oy + y0, 0, oy + y0 + hgt * (st ? 0.8 : 0.95));
    gr.addColorStop(0, "#fff");
    gr.addColorStop(0.5, st ? "#999" : "#c8c8c8");
    gr.addColorStop(0.72, st ? "#333" : "#666");
    gr.addColorStop(1, "#000");
    g.fillStyle = gr;
    g.filter = "blur(3px)";
    s(g, ox, oy);
    g.globalCompositeOperation = "lighten";
    g.drawImage(band(g, ox, oy, s, hgt * 0.05, hgt * (st ? 0.3 : 0.12), st ? 6 : 10), 0, 0);
    g.filter = "none";
    g.globalCompositeOperation = "source-over";
  });
  // brush: horizontal soft strokes
  const brush = chan((g, ox, oy, _s, v) => {
    const r = mulberry(77 + v);
    g.fillStyle = "#808080";
    g.fillRect(ox, oy, CELL_W, CELL_H);
    g.filter = "blur(6px)";
    for (let i = 0; i < 70; i++) {
      const l = 60 + r() * 260;
      const x = ox + r() * CELL_W;
      const y = oy + r() * CELL_H;
      g.fillStyle = r() < 0.5 ? "#ffffff" : "#3a3a3a";
      g.globalAlpha = 0.25 + r() * 0.3;
      g.beginPath();
      g.ellipse(x, y, l / 2, 4 + r() * 10, (r() - 0.5) * 0.15, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    g.filter = "none";
  });
  const data = new Uint8Array(W * H * 4);
  // DataTexture rows go bottom-up in UV space: flip so v=1 is the top of the painting
  for (let y = 0; y < H; y++) {
    const sy = H - 1 - y;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const j = (sy * W + x) * 4;
      data[i] = cov[j];
      data[i + 1] = below[j];
      data[i + 2] = above[j];
      data[i + 3] = 128 + (brush[j] >> 1);
    }
  }
  atlas = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  atlas.colorSpace = THREE.NoColorSpace;
  atlas.generateMipmaps = true;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  atlas.magFilter = THREE.LinearFilter;
  atlas.anisotropy = 4;
  atlas.needsUpdate = true;
  return atlas;
};

const CLOUD_V = /* glsl */ `
attribute vec2 corner;
attribute vec4 cinfo;   // az, el, halfW (rad), halfH (rad)
attribute vec4 cinfo2;  // variant, drift speed (rad/s), flipX, rank
uniform float uT;
uniform float uCover;
varying vec2 vUv;
varying vec3 vDir;
varying vec3 vCenter;
void main(){
  float az = cinfo.x + cinfo2.y * uT;
  float el = cinfo.y;
  vec3 dc = vec3(sin(az) * cos(el), sin(el), -cos(az) * cos(el));
  vec3 rx = normalize(cross(dc, vec3(0.0, 1.0, 0.0)));
  vec3 ry = cross(rx, dc);
  vec3 p = dc + rx * corner.x * tan(cinfo.z) + ry * corner.y * tan(cinfo.w);
  vDir = normalize(p);
  vCenter = dc;
  float v = cinfo2.x;
  vec2 cell = vec2(mod(v, 2.0), floor(v / 2.0));
  vec2 uv = corner * 0.5 + 0.5;
  if (cinfo2.z > 0.5) uv.x = 1.0 - uv.x;
  uv = uv * vec2(0.497, 0.2485) + vec2(0.0015, 0.0008);   // stay inside the cell (mip bleed)
  vUv = vec2(cell.x * 0.5, 0.75 - cell.y * 0.25) + uv;
  if (cinfo2.w > uCover) p *= 0.0;
  vec4 q = projectionMatrix * viewMatrix * vec4(cameraPosition + p * 90.0, 1.0);
  q.z = q.w * 0.99998;
  gl_Position = q;
}`;

const CLOUD_F = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec3 uCloud; uniform vec3 uLit; uniform vec3 uBot;
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uSunOn;
uniform float uBelow; uniform float uOpacity;
varying vec2 vUv;
varying vec3 vDir;
varying vec3 vCenter;
void main(){
  vec4 m = texture2D(uAtlas, vUv);
  float brush = (m.a - 0.5) * 2.0;            // 0..1
  // crisp painted edge, slightly ragged by the brush channel
  float fw = fwidth(m.r) + 0.02;
  float cov = smoothstep(0.5 - fw - 0.08, 0.5 + fw + 0.08, m.r + (brush - 0.5) * 0.18);
  if (cov < 0.004) discard;
  float lit = mix(m.b, m.g, uBelow);
  vec3 c = mix(uCloud, uLit, smoothstep(0.22, 0.62, lit + (brush - 0.5) * 0.1));
  c *= 0.93 + 0.12 * brush;
  if (uSunOn > 0.0) {
    float ang = acos(clamp(dot(normalize(vDir), uSunDir), -1.0, 1.0));
    c += uSunCol * (lit * 0.6 + 0.15) * exp(-ang / 0.45) * 0.55 * uSunOn;
  }
  // aerial perspective: low clouds melt into the horizon color
  float e = vDir.y;
  c = mix(c, uBot, (1.0 - smoothstep(0.0, 0.22, e)) * 0.45);
  float a = cov * uOpacity * smoothstep(-0.03, 0.02, e);
  gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}`;

type CloudDef = { az: number; el: number; w: number; h: number; v: number; speed: number; flip: number; rank: number };

const layoutClouds = (seed: number, count: number, style: "mixed" | "puffy" | "streak"): CloudDef[] => {
  const r = mulberry(4242 + seed * 101);
  const out: CloudDef[] = [];
  for (let i = 0; i < count; i++) {
    const az = ((i + r() * 0.8) / count) * Math.PI * 2 - Math.PI;
    const el = (1.5 + 40 * Math.pow(r(), 1.5)) * (Math.PI / 180);
    const pickStreak = style === "streak" ? true : style === "puffy" ? false : r() < 0.45;
    const v = pickStreak ? STREAK[Math.floor(r() * STREAK.length)] : PUFF[Math.floor(r() * PUFF.length)];
    const wDeg = (pickStreak ? 24 + r() * 26 : 13 + r() * 16) * (0.8 + el * 0.6);
    const w = (wDeg * Math.PI) / 180 / 2;
    const h = w * 0.5 * (pickStreak ? 0.8 + r() * 0.3 : 0.75 + r() * 0.25);
    out.push({ az, el, w, h, v, speed: (r() - 0.5) * 0.006 + (i % 2 ? 0.003 : -0.003), flip: r() < 0.5 ? 1 : 0, rank: Math.min(1, ((i * 0.618034) % 1) * (1 + el * 1.1)) });
  }
  return out.sort((a, b) => a.el - b.el);
};

const cloudGeometry = (defs: CloudDef[]) => {
  const n = defs.length;
  const corner = new Float32Array(n * 4 * 2);
  const info = new Float32Array(n * 4 * 4);
  const info2 = new Float32Array(n * 4 * 4);
  const idx: number[] = [];
  const C = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  defs.forEach((d, i) => {
    for (let k = 0; k < 4; k++) {
      const j = i * 4 + k;
      corner.set(C[k], j * 2);
      info.set([d.az, d.el, d.w, d.h], j * 4);
      info2.set([d.v, d.speed, d.flip, d.rank], j * 4);
    }
    idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 4 * 3), 3));
  g.setAttribute("corner", new THREE.BufferAttribute(corner, 2));
  g.setAttribute("cinfo", new THREE.BufferAttribute(info, 4));
  g.setAttribute("cinfo2", new THREE.BufferAttribute(info2, 4));
  g.setIndex(idx);
  return g;
};

const dirOf = (v: V3) => new THREE.Vector3(...v).normalize();

export type SkyDomeProps = {
  top: string;
  mid: string;
  bottom: string;
  cloudColor: string;
  cloudLit: string;
  t: number;
  sun?: { dir: V3; color: string; size: number }; // size = angular diameter in degrees (stylized suns are big: 6–12)
  // extras
  moon?: { dir: V3; color: string; size: number };
  stars?: number; // 0..1
  rays?: number; // sun rays strength 0..1
  clouds?: number; // 0..1 cover (count and opacity)
  cloudStyle?: "mixed" | "puffy" | "streak";
  cloudSeed?: number;
  cloudLight?: "above" | "below"; // default: below when the sun is low, else above
  horizon?: number; // elevation (sin) of the mid stop, default 0.2
  brush?: number; // painterly gradient variation, default 0.06
};

export const SkyDome: React.FC<SkyDomeProps> = ({ top, mid, bottom, cloudColor, cloudLit, t, sun, moon, stars = 0, rays = 0, clouds = 1, cloudStyle = "mixed", cloudSeed = 0, cloudLight, horizon = 0.2, brush = 0.06 }) => {
  const skyMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SKY_V,
        fragmentShader: SKY_F,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: true,
        fog: false,
        toneMapped: false,
        uniforms: {
          uTop: { value: new THREE.Color() },
          uMid: { value: new THREE.Color() },
          uBot: { value: new THREE.Color() },
          uSunDir: { value: new THREE.Vector3(0, 0.1, -1) },
          uSunCol: { value: new THREE.Color() },
          uSunSize: { value: 0.05 },
          uSunOn: { value: 0 },
          uRays: { value: 0 },
          uMoonDir: { value: new THREE.Vector3(0, 0.3, -1) },
          uMoonCol: { value: new THREE.Color() },
          uMoonSize: { value: 0.03 },
          uMoonOn: { value: 0 },
          uStars: { value: 0 },
          uT: { value: 0 },
          uHorizon: { value: 0.2 },
          uBrush: { value: 0.06 },
        },
      }),
    [],
  );
  const total = 64;
  const defs = useMemo(() => layoutClouds(cloudSeed, total, cloudStyle), [cloudSeed, cloudStyle]);
  const geo = useMemo(() => cloudGeometry(defs), [defs]);
  const cloudMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: CLOUD_V,
        fragmentShader: CLOUD_F,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        fog: false,
        toneMapped: false,
        side: THREE.DoubleSide,
        uniforms: {
          uAtlas: { value: cloudAtlas() },
          uCloud: { value: new THREE.Color() },
          uLit: { value: new THREE.Color() },
          uBot: { value: new THREE.Color() },
          uSunDir: { value: new THREE.Vector3(0, 0.1, -1) },
          uSunCol: { value: new THREE.Color() },
          uSunOn: { value: 0 },
          uBelow: { value: 0 },
          uOpacity: { value: 1 },
          uT: { value: 0 },
          uCover: { value: 1 },
        },
      }),
    [],
  );
  const u = skyMat.uniforms;
  u.uTop.value.set(top);
  u.uMid.value.set(mid);
  u.uBot.value.set(bottom);
  u.uT.value = t;
  u.uHorizon.value = horizon;
  u.uBrush.value = brush;
  u.uStars.value = stars;
  u.uRays.value = rays;
  if (sun) {
    u.uSunDir.value.copy(dirOf(sun.dir));
    u.uSunCol.value.set(sun.color);
    u.uSunSize.value = (sun.size * Math.PI) / 360;
    u.uSunOn.value = 1;
  } else u.uSunOn.value = 0;
  if (moon) {
    u.uMoonDir.value.copy(dirOf(moon.dir));
    u.uMoonCol.value.set(moon.color);
    u.uMoonSize.value = (moon.size * Math.PI) / 360;
    u.uMoonOn.value = 1;
  } else u.uMoonOn.value = 0;
  const cu = cloudMat.uniforms;
  cu.uCloud.value.set(cloudColor);
  cu.uLit.value.set(cloudLit);
  cu.uBot.value.set(bottom);
  cu.uT.value = t;
  cu.uSunOn.value = sun ? 1 : 0;
  if (sun) {
    cu.uSunDir.value.copy(dirOf(sun.dir));
    cu.uSunCol.value.set(sun.color);
  }
  const below = cloudLight ? (cloudLight === "below" ? 1 : 0) : sun ? 1 - THREE.MathUtils.smoothstep(dirOf(sun.dir).y, 0.12, 0.3) : 0;
  cu.uBelow.value = below;
  cu.uCover.value = Math.min(1, clouds * 1.15);
  cu.uOpacity.value = 1;
  return (
    <group>
      <mesh material={skyMat} renderOrder={-100} frustumCulled={false}>
        <sphereGeometry args={[1, 64, 32]} />
      </mesh>
      {clouds > 0 ? <mesh geometry={geo} material={cloudMat} renderOrder={-99} frustumCulled={false} /> : null}
    </group>
  );
};
