// Painted clothing for the torso, plus the hair and hat textures. The torso canvas wraps the lathe:
// canvas x = angle (front at x = 512, the visible front half spans x 256…768), canvas y = height (top row = torso
// top, bottom row = torso bottom). Base colors are flat; the light does the shading. Every outfit has seams,
// stitching, pockets and buttons; outfitColors() tells the limbs which colors continue the outfit.
import * as THREE from "three";
import { CLOTH, INK } from "./family";

export type Outfit = "shirt" | "vest" | "jacket" | "sweater" | "apron" | "overalls";
export const OUTFITS: Outfit[] = ["shirt", "vest", "jacket", "sweater", "apron", "overalls"];

/** outfit colors: top = the main garment, inner = the shirt under it, bottom = pants / skirt, accent = buttons */
export type OutfitColors = { top: string; inner: string; bottom: string; shoes: string; accent: string };

const S = 1024;
const hex = (c: string) => {
  const h = c.replace("#", "");
  const f = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
};
const toHex = (v: number[]) => `#${v.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("")}`;
/** multiply a color (optionally per channel) */
export const shade = (c: string, k: number, tint: [number, number, number] = [1, 1, 1]) => toHex(hex(c).map((x, i) => x * k * tint[i]));
export const mixc = (a: string, b: string, u: number) => {
  const A = hex(a);
  const B = hex(b);
  return toHex(A.map((x, i) => x + (B[i] - x) * u));
};
const rgba = (c: string, a: number) => {
  const [r, g, b] = hex(c);
  return `rgba(${r},${g},${b},${a})`;
};

/** which colors the sleeves, cuffs and pant legs take for an outfit */
export const outfitColors = (o: Outfit, c: OutfitColors) => {
  switch (o) {
    case "vest":
      return { sleeve: c.inner, cuff: shade(c.inner, 0.9), leg: c.bottom, hem: shade(c.bottom, 0.82) };
    case "jacket":
      return { sleeve: c.top, cuff: c.inner, leg: c.bottom, hem: shade(c.bottom, 0.82) };
    case "sweater":
      return { sleeve: c.top, cuff: shade(c.top, 0.8), leg: c.bottom, hem: shade(c.bottom, 0.82) };
    case "apron":
      return { sleeve: c.inner, cuff: shade(c.inner, 0.86), leg: c.bottom, hem: shade(c.bottom, 0.82) };
    case "overalls":
      return { sleeve: c.inner, cuff: shade(c.inner, 0.86), leg: c.top, hem: mixc(c.top, "#ffffff", 0.18) };
    default:
      return { sleeve: c.top, cuff: shade(c.top, 0.84), leg: c.bottom, hem: shade(c.bottom, 0.82) };
  }
};

// t = height fraction on the torso (0 bottom … 1 top); u = around (0.5 front)
const Y = (t: number) => (1 - t) * S;
const X = (u: number) => u * S;
/** front-half unit: -1 … 1 spans the visible front (u 0.25 … 0.75) */
const FX = (f: number) => X(0.5 + f * 0.25);

type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];

const line = (ctx: Ctx, pts: Pt[]) => {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
};
/** dashed thread stitching */
const stitch = (ctx: Ctx, pts: Pt[], color: string, w = 4) => {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = "round";
  ctx.setLineDash([11, 9]);
  line(ctx, pts);
  ctx.stroke();
  ctx.restore();
};
/** a seam: a dark fold line with a faint light edge beside it */
const seam = (ctx: Ctx, pts: Pt[], color: string, w = 7) => {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(255,252,246,0.12)";
  ctx.lineWidth = w * 0.6;
  ctx.translate(w * 0.55, 0);
  line(ctx, pts);
  ctx.stroke();
  ctx.translate(-w * 0.55, 0);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  line(ctx, pts);
  ctx.stroke();
  ctx.restore();
};
/** a four-hole button with an ink rim and a soft highlight */
const button = (ctx: Ctx, x: number, y: number, r: number, col: string) => {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = col;
  ctx.fill();
  ctx.lineWidth = r * 0.26;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.62, 0, Math.PI * 2);
  ctx.strokeStyle = shade(col, 0.72);
  ctx.lineWidth = r * 0.12;
  ctx.stroke();
  ctx.fillStyle = shade(col, 0.45);
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    ctx.beginPath();
    ctx.arc(x + dx * r * 0.24, y + dy * r * 0.24, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.ellipse(x + r * 0.32, y - r * 0.38, r * 0.3, r * 0.16, -0.5, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,253,246,0.7)";
  ctx.fill();
};
const rrect = (ctx: Ctx, x: number, y: number, w: number, h: number, fill: string, stroke?: string, lw = 6, r = 8) => {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
};
/** a patch pocket with stitching on three sides, an optional flap and button */
const pocket = (ctx: Ctx, cx: number, top: number, w: number, h: number, fill: string, dark: string, thread: string, flap = false, btn?: string) => {
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, top);
  ctx.lineTo(cx + w / 2, top);
  ctx.lineTo(cx + w / 2, top + h * 0.82);
  ctx.lineTo(cx, top + h);
  ctx.lineTo(cx - w / 2, top + h * 0.82);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = dark;
  ctx.lineWidth = 6;
  ctx.lineJoin = "round";
  ctx.stroke();
  stitch(ctx, [[cx - w / 2 + 9, top + 6], [cx - w / 2 + 9, top + h * 0.8 - 2], [cx, top + h - 10], [cx + w / 2 - 9, top + h * 0.8 - 2], [cx + w / 2 - 9, top + 6]], thread, 3);
  if (flap) {
    rrect(ctx, cx - w / 2 - 4, top - 6, w + 8, h * 0.3, mixc(fill, "#000000", 0.06), dark, 6, 6);
    stitch(ctx, [[cx - w / 2 + 6, top + h * 0.3 - 16], [cx + w / 2 - 6, top + h * 0.3 - 16]], thread, 3);
    if (btn) button(ctx, cx, top + h * 0.2, 10, btn);
  }
};
/** pants below a line: side seams, a fly, a light weave */
const pants = (ctx: Ctx, t: number, col: string) => {
  ctx.fillStyle = col;
  ctx.fillRect(0, Y(t), S, S - Y(t));
  const dk = shade(col, 0.62);
  seam(ctx, [[X(0.5), Y(t)], [X(0.5), Y(0.0)]], dk, 6);
  stitch(ctx, [[X(0.5) + 18, Y(t) + 6], [X(0.5) + 18, Y(0.04)], [X(0.5) + 4, Y(0.0)]], rgba(shade(col, 1.45), 0.7), 3);
  for (const u of [0.25, 0.75]) seam(ctx, [[X(u), Y(t)], [X(u), S]], dk, 6);
};
/** a belt with loops and a prong buckle */
const belt = (ctx: Ctx, t0: number, t1: number, col: string, metal: string) => {
  ctx.fillStyle = col;
  ctx.fillRect(0, Y(t1), S, Y(t0) - Y(t1));
  ctx.fillStyle = "rgba(255,250,240,0.1)";
  ctx.fillRect(0, Y(t1), S, 4);
  stitch(ctx, [[0, Y(t1) + 8], [S, Y(t1) + 8]], rgba(shade(col, 1.8), 0.55), 2);
  stitch(ctx, [[0, Y(t0) - 8], [S, Y(t0) - 8]], rgba(shade(col, 1.8), 0.55), 2);
  const h = Y(t0) - Y(t1);
  for (const f of [-0.7, -0.35, 0.35, 0.7]) rrect(ctx, FX(f) - 6, Y(t1) - 4, 12, h + 8, shade(col, 1.15), shade(col, 0.6), 3, 3);
  const bx = FX(0.06);
  ctx.strokeStyle = metal;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.roundRect(bx - h * 0.55, Y(t1) - h * 0.1, h * 1.1, h * 1.2, 6);
  ctx.stroke();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.stroke();
  seam(ctx, [[bx, Y(t1) + h * 0.1], [bx, Y(t0) - h * 0.1]], metal, 6);
};
/** soft painterly drift and a fine diagonal twill so large fabric areas are not dead flat */
const fabric = (ctx: Ctx, col: string, seed: number) => {
  ctx.fillStyle = col;
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 22; i++) {
    const a = Math.sin(seed * 11.7 + i * 5.3) * 0.5 + 0.5;
    const b = Math.sin(seed * 2.9 + i * 9.1) * 0.5 + 0.5;
    const r = 70 + 150 * (Math.sin(i * 4.3 + seed) * 0.5 + 0.5);
    const g = ctx.createRadialGradient(a * S, b * S, 0, a * S, b * S, r);
    g.addColorStop(0, i % 2 ? "rgba(20,24,40,0.05)" : "rgba(255,248,236,0.05)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  ctx.save();
  ctx.globalAlpha = 0.04;
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 1.5;
  for (let k = -S; k < S; k += 7) {
    ctx.beginPath();
    ctx.moveTo(k, 0);
    ctx.lineTo(k + S, S);
    ctx.stroke();
  }
  ctx.restore();
};
/** the head and neck shade the top of the torso */
const neckShade = (ctx: Ctx) => {
  const g = ctx.createLinearGradient(0, Y(0.97), 0, Y(0.74));
  g.addColorStop(0, "rgba(22,26,46,0.4)");
  g.addColorStop(1, "rgba(22,26,46,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, Y(1), S, Y(0.74) - Y(1));
};
/** shirt collar points around the neck */
const collar = (ctx: Ctx, col: string, dark: string, spread = 0.3) => {
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(FX(s * 0.03), Y(0.86));
    ctx.quadraticCurveTo(FX(s * spread * 0.6), Y(0.93), FX(s * spread * 1.15), Y(0.955));
    ctx.lineTo(FX(s * spread * 0.95), Y(0.79));
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
    ctx.strokeStyle = dark;
    ctx.lineWidth = 6;
    ctx.lineJoin = "round";
    ctx.stroke();
    stitch(ctx, [[FX(s * 0.07), Y(0.855)], [FX(s * spread * 0.88), Y(0.81)]], rgba(shade(col, 0.6), 0.8), 2.5);
  }
};
/** a knit rib band between two heights */
const rib = (ctx: Ctx, t0: number, t1: number, col: string) => {
  ctx.fillStyle = shade(col, 0.92);
  ctx.fillRect(0, Y(t1), S, Y(t0) - Y(t1));
  ctx.strokeStyle = rgba(shade(col, 0.66), 0.7);
  ctx.lineWidth = 4;
  for (let x = 0; x < S; x += 12) {
    ctx.beginPath();
    ctx.moveTo(x, Y(t1));
    ctx.lineTo(x, Y(t0));
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(20,24,40,0.18)";
  ctx.fillRect(0, Y(t0) - 5, S, 5);
};

const cache = new Map<string, THREE.CanvasTexture>();
export const clothTexture = (outfit: Outfit, c: OutfitColors, seed = 1) => {
  const key = [outfit, c.top, c.inner, c.bottom, c.accent, seed].join("|");
  const hit = cache.get(key);
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext("2d")!;
  const top = c.top;
  const dark = shade(top, 0.6, [0.96, 0.96, 1.06]);
  const thread = rgba(mixc(top, "#fff8ea", 0.72), 0.85);
  const innerDark = shade(c.inner, 0.62);

  switch (outfit) {
    case "vest": {
      // a shirt under a buttoned waistcoat with welt pockets
      fabric(ctx, c.inner, seed);
      pants(ctx, 0.16, c.bottom);
      collar(ctx, mixc(c.inner, "#ffffff", 0.2), innerDark, 0.26);
      ctx.beginPath();
      ctx.moveTo(0, Y(0.9));
      ctx.lineTo(FX(-0.3), Y(0.9));
      ctx.lineTo(FX(-0.02), Y(0.5));
      ctx.lineTo(FX(-0.02), Y(0.16));
      ctx.lineTo(FX(-0.12), Y(0.08));
      ctx.lineTo(FX(-0.5), Y(0.14));
      ctx.lineTo(FX(-1.6), Y(0.14));
      ctx.lineTo(FX(-1.6), Y(0.9));
      ctx.closePath();
      ctx.moveTo(S, Y(0.9));
      ctx.lineTo(FX(0.3), Y(0.9));
      ctx.lineTo(FX(0.02), Y(0.5));
      ctx.lineTo(FX(0.02), Y(0.16));
      ctx.lineTo(FX(0.12), Y(0.08));
      ctx.lineTo(FX(0.5), Y(0.14));
      ctx.lineTo(FX(1.6), Y(0.14));
      ctx.lineTo(FX(1.6), Y(0.9));
      ctx.closePath();
      ctx.save();
      ctx.clip();
      fabric(ctx, top, seed + 3);
      ctx.restore();
      for (const s of [-1, 1]) {
        seam(ctx, [[FX(s * 0.3), Y(0.9)], [FX(s * 0.02), Y(0.5)], [FX(s * 0.02), Y(0.16)], [FX(s * 0.12), Y(0.08)], [FX(s * 0.5), Y(0.14)], [FX(s * 1.6), Y(0.14)]], dark, 7);
        stitch(ctx, [[FX(s * 0.26), Y(0.88)], [FX(s * 0.05), Y(0.52)], [FX(s * 0.05), Y(0.18)]], thread, 3);
        // welt pockets
        ctx.save();
        ctx.translate(FX(s * 0.48), Y(0.32));
        ctx.rotate(s * -0.12);
        rrect(ctx, -46, -7, 92, 14, dark, undefined, 0, 4);
        stitch(ctx, [[-46, -16], [46, -16]], thread, 2.5);
        ctx.restore();
        // a back seam
        seam(ctx, [[X(s > 0 ? 0.02 : 0.98), Y(0.9)], [X(s > 0 ? 0.02 : 0.98), Y(0.14)]], dark, 5);
      }
      for (const t of [0.46, 0.36, 0.26, 0.17]) button(ctx, FX(0.05), Y(t), 12, c.accent);
      break;
    }
    case "jacket": {
      // an open jacket over a shirt: lapels, a two-button front, flap pockets, a chest welt
      fabric(ctx, top, seed);
      pants(ctx, 0.07, c.bottom);
      ctx.fillStyle = c.inner;
      ctx.beginPath();
      ctx.moveTo(FX(-0.3), Y(0.93));
      ctx.lineTo(FX(0.3), Y(0.93));
      ctx.lineTo(FX(0.12), Y(0.42));
      ctx.lineTo(FX(0.14), Y(0.07));
      ctx.lineTo(FX(-0.14), Y(0.07));
      ctx.lineTo(FX(-0.12), Y(0.42));
      ctx.closePath();
      ctx.fill();
      seam(ctx, [[X(0.5), Y(0.86)], [X(0.5), Y(0.07)]], innerDark, 5);
      for (const t of [0.74, 0.6, 0.46, 0.32, 0.18]) button(ctx, X(0.5) + 13, Y(t), 7, mixc(c.inner, "#ffffff", 0.4));
      collar(ctx, mixc(c.inner, "#ffffff", 0.2), innerDark, 0.24);
      for (const s of [-1, 1]) {
        // lapel
        ctx.beginPath();
        ctx.moveTo(FX(s * 0.3), Y(0.95));
        ctx.lineTo(FX(s * 0.5), Y(0.87));
        ctx.lineTo(FX(s * 0.4), Y(0.76));
        ctx.lineTo(FX(s * 0.44), Y(0.7));
        ctx.lineTo(FX(s * 0.13), Y(0.44));
        ctx.closePath();
        ctx.fillStyle = mixc(top, dark, 0.3);
        ctx.fill();
        ctx.strokeStyle = dark;
        ctx.lineWidth = 7;
        ctx.lineJoin = "round";
        ctx.stroke();
        stitch(ctx, [[FX(s * 0.46), Y(0.865)], [FX(s * 0.37), Y(0.76)], [FX(s * 0.39), Y(0.7)], [FX(s * 0.16), Y(0.49)]], thread, 3);
        seam(ctx, [[FX(s * 0.13), Y(0.44)], [FX(s * 0.15), Y(0.03)]], dark, 7);
        stitch(ctx, [[FX(s * 0.2), Y(0.42)], [FX(s * 0.21), Y(0.06)]], thread, 3);
        pocket(ctx, FX(s * 0.55), Y(0.3), 104, 70, top, dark, thread, true);
        seam(ctx, [[X(s > 0 ? 0.76 : 0.24), Y(0.94)], [X(s > 0 ? 0.76 : 0.24), Y(0.03)]], dark, 5);
      }
      ctx.save();
      ctx.translate(FX(-0.5), Y(0.62));
      ctx.rotate(0.06);
      rrect(ctx, -40, -8, 80, 16, dark, undefined, 0, 4);
      ctx.restore();
      for (const t of [0.36, 0.22]) button(ctx, FX(-0.21), Y(t), 13, c.accent);
      seam(ctx, [[0, Y(0.05)], [S, Y(0.05)]], dark, 6);
      break;
    }
    case "sweater": {
      // a knit crew-neck: rib collar and waistband, a cable down the front, two chest stripes
      fabric(ctx, top, seed);
      ctx.strokeStyle = rgba(shade(top, 0.75), 0.35);
      ctx.lineWidth = 3;
      for (let x = 0; x < S; x += 16) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, S);
        ctx.stroke();
      }
      for (const [t, h] of [[0.6, 0.045], [0.52, 0.025]]) {
        ctx.fillStyle = c.accent;
        ctx.fillRect(0, Y(t + h), S, Y(t) - Y(t + h));
        ctx.fillStyle = "rgba(20,24,40,0.15)";
        ctx.fillRect(0, Y(t) - 3, S, 3);
      }
      // the cable: two strands crossing down the center front
      for (const s of [-1, 1]) {
        ctx.beginPath();
        for (let i = 0; i <= 60; i++) {
          const t = 0.86 - (i / 60) * 0.66;
          const x = X(0.5) + s * 18 * Math.sin(i * 0.62);
          if (i) ctx.lineTo(x, Y(t));
          else ctx.moveTo(x, Y(t));
        }
        ctx.strokeStyle = shade(top, 1.18);
        ctx.lineWidth = 15;
        ctx.lineCap = "round";
        ctx.stroke();
        ctx.strokeStyle = rgba(shade(top, 0.6), 0.6);
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      for (const s of [-1, 1]) seam(ctx, [[X(0.5) + s * 44, Y(0.88)], [X(0.5) + s * 44, Y(0.2)]], rgba(shade(top, 0.7), 0.6), 4);
      rib(ctx, 0.12, 0.2, top);
      pants(ctx, 0.12, c.bottom);
      rib(ctx, 0.86, 0.96, top);
      break;
    }
    case "apron": {
      // a print dress under a bib apron: straps, a waist tie, a big stitched pocket
      fabric(ctx, c.inner, seed);
      ctx.fillStyle = rgba(mixc(c.inner, "#ffffff", 0.55), 0.55);
      for (let i = 0; i < 40; i++)
        for (let j = 0; j < 24; j++) {
          const x = i * 26 + (j % 2) * 13;
          const y = j * 44 + 10;
          ctx.beginPath();
          for (let k = 0; k < 5; k++) {
            const a = (k / 5) * Math.PI * 2;
            ctx.ellipse(x + Math.cos(a) * 4, y + Math.sin(a) * 4, 3.2, 2.2, a, 0, Math.PI * 2);
          }
          ctx.fill();
        }
      ctx.fillStyle = c.bottom;
      ctx.fillRect(0, Y(0.1), S, S - Y(0.1));
      collar(ctx, mixc(c.inner, "#ffffff", 0.35), innerDark, 0.22);
      const apron = c.top;
      const aDark = shade(apron, 0.66);
      const aThread = rgba(mixc(apron, INK, 0.45), 0.8);
      ctx.beginPath();
      ctx.moveTo(FX(-0.4), Y(0.8));
      ctx.lineTo(FX(0.4), Y(0.8));
      ctx.lineTo(FX(0.46), Y(0.46));
      ctx.lineTo(FX(0.68), Y(0.42));
      ctx.lineTo(FX(0.66), Y(0.02));
      ctx.lineTo(FX(-0.66), Y(0.02));
      ctx.lineTo(FX(-0.68), Y(0.42));
      ctx.lineTo(FX(-0.46), Y(0.46));
      ctx.closePath();
      ctx.save();
      ctx.clip();
      fabric(ctx, apron, seed + 5);
      ctx.restore();
      ctx.strokeStyle = aDark;
      ctx.lineWidth = 7;
      ctx.lineJoin = "round";
      ctx.stroke();
      stitch(ctx, [[FX(-0.36), Y(0.785)], [FX(0.36), Y(0.785)], [FX(0.42), Y(0.47)]], aThread, 3);
      stitch(ctx, [[FX(-0.36), Y(0.785)], [FX(-0.42), Y(0.47)]], aThread, 3);
      stitch(ctx, [[FX(-0.62), Y(0.05)], [FX(0.62), Y(0.05)]], aThread, 3);
      for (const s of [-1, 1]) {
        seam(ctx, [[FX(s * 0.38), Y(0.8)], [FX(s * 0.6), Y(1.0)]], apron, 22);
        stitch(ctx, [[FX(s * 0.38), Y(0.8)], [FX(s * 0.6), Y(1.0)]], aThread, 2.5);
        button(ctx, FX(s * 0.37), Y(0.76), 11, c.accent);
      }
      // the waist tie runs around the back to a bow
      ctx.fillStyle = apron;
      ctx.fillRect(0, Y(0.45), S, Y(0.4) - Y(0.45));
      stitch(ctx, [[0, Y(0.44)], [S, Y(0.44)]], aThread, 2);
      stitch(ctx, [[0, Y(0.41)], [S, Y(0.41)]], aThread, 2);
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(X(0) + s * 40, Y(0.425), 40, 22, s * 0.3, 0, Math.PI * 2);
        ctx.ellipse(X(1) + s * 40, Y(0.425), 40, 22, s * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = shade(apron, 0.92);
        ctx.fill();
        ctx.strokeStyle = aDark;
        ctx.lineWidth = 5;
        ctx.stroke();
      }
      pocket(ctx, X(0.5), Y(0.3), 190, 108, mixc(apron, "#ffffff", 0.08), aDark, aThread);
      seam(ctx, [[X(0.5), Y(0.3) + 8], [X(0.5), Y(0.3) + 96]], aDark, 4);
      break;
    }
    case "overalls": {
      // a shirt under denim overalls: bib, straps with brass buttons, a bib pocket, contrast stitching
      fabric(ctx, c.inner, seed);
      ctx.strokeStyle = rgba(shade(c.inner, 0.72), 0.45);
      ctx.lineWidth = 6;
      for (let x = 0; x < S; x += 34) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, S);
        ctx.stroke();
      }
      collar(ctx, mixc(c.inner, "#ffffff", 0.2), innerDark, 0.26);
      const den = top;
      const dDark = shade(den, 0.62);
      const orange = rgba(c.accent, 0.95);
      ctx.beginPath();
      ctx.moveTo(FX(-0.46), Y(0.7));
      ctx.lineTo(FX(0.46), Y(0.7));
      ctx.lineTo(FX(0.52), Y(0.38));
      ctx.lineTo(FX(1.6), Y(0.38));
      ctx.lineTo(FX(1.6), 0 + S);
      ctx.lineTo(FX(-1.6), S);
      ctx.lineTo(FX(-1.6), Y(0.38));
      ctx.lineTo(FX(-0.52), Y(0.38));
      ctx.closePath();
      ctx.save();
      ctx.clip();
      fabric(ctx, den, seed + 7);
      ctx.restore();
      ctx.strokeStyle = dDark;
      ctx.lineWidth = 7;
      ctx.lineJoin = "round";
      ctx.stroke();
      stitch(ctx, [[FX(-0.5), Y(0.4)], [FX(-0.43), Y(0.685)], [FX(0.43), Y(0.685)], [FX(0.5), Y(0.4)]], orange, 3);
      stitch(ctx, [[0, Y(0.36)], [S, Y(0.36)]], orange, 3);
      for (const s of [-1, 1]) {
        seam(ctx, [[FX(s * 0.38), Y(0.7)], [FX(s * 0.42), Y(1.0)]], den, 30);
        stitch(ctx, [[FX(s * 0.38) - 10, Y(0.7)], [FX(s * 0.42) - 10, Y(1.0)]], orange, 2.5);
        stitch(ctx, [[FX(s * 0.38) + 10, Y(0.7)], [FX(s * 0.42) + 10, Y(1.0)]], orange, 2.5);
        button(ctx, FX(s * 0.38), Y(0.66), 15, c.accent);
        button(ctx, FX(s * 0.6), Y(0.3), 10, c.accent);
        seam(ctx, [[X(s > 0 ? 0.76 : 0.24), Y(0.36)], [X(s > 0 ? 0.76 : 0.24), S]], dDark, 5);
      }
      pocket(ctx, X(0.5), Y(0.62), 120, 92, den, dDark, orange);
      seam(ctx, [[X(0.5), Y(0.36)], [X(0.5), S]], dDark, 6);
      stitch(ctx, [[X(0.5) + 16, Y(0.34)], [X(0.5) + 16, Y(0.05)]], orange, 3);
      break;
    }
    default: {
      // a shirt: collar, placket and buttons, a chest pocket, side seams, tucked into belted pants
      fabric(ctx, top, seed);
      pants(ctx, 0.15, c.bottom);
      collar(ctx, mixc(top, "#ffffff", 0.16), dark, 0.3);
      seam(ctx, [[X(0.5) - 14, Y(0.86)], [X(0.5) - 14, Y(0.15)]], dark, 6);
      seam(ctx, [[X(0.5) + 14, Y(0.86)], [X(0.5) + 14, Y(0.15)]], rgba(dark, 0.6), 4);
      for (const t of [0.76, 0.62, 0.48, 0.34]) button(ctx, X(0.5), Y(t), 10, c.accent);
      pocket(ctx, FX(0.48), Y(0.7), 96, 84, top, dark, thread, true, c.accent);
      for (const u of [0.24, 0.76]) seam(ctx, [[X(u), Y(0.92)], [X(u), Y(0.2)]], dark, 5);
      belt(ctx, 0.15, 0.21, shade(CLOTH.chestnut, 0.85), CLOTH.brass);
    }
  }
  neckShade(ctx);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = THREE.RepeatWrapping;
  if (cache.size > 64) {
    const first = cache.keys().next().value as string;
    cache.get(first)?.dispose();
    cache.delete(first);
  }
  cache.set(key, tex);
  return tex;
};

/** hair locks for the hair shells (multiplies the hair color). capGeo uv: u = around, v = 1 at the crown → 0 at the
 *  hem (canvas top = crown). Combed darker clumps, a few lighter strands, a darker hem. */
let hairTex: THREE.CanvasTexture | null = null;
export const hairTexture = () => {
  if (hairTex) return hairTex;
  const cv = document.createElement("canvas");
  cv.width = 1024;
  cv.height = 256;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 1024, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "rgba(24,20,40,0)");
  g.addColorStop(0.55, "rgba(24,20,40,0.05)");
  g.addColorStop(1, "rgba(24,20,40,0.26)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 256);
  ctx.lineCap = "round";
  for (let i = 0; i < 64; i++) {
    const x = (i / 64) * 1024 + Math.sin(i * 7.3) * 10;
    const y0 = 20 + 50 * (Math.sin(i * 2.9) * 0.5 + 0.5);
    const len = 110 + 70 * (Math.sin(i * 1.3) * 0.5 + 0.5);
    const light = i % 5 === 0;
    ctx.strokeStyle = light ? "rgba(255,250,240,0.35)" : i % 2 ? "rgba(30,22,40,0.3)" : "rgba(30,22,40,0.17)";
    ctx.lineWidth = light ? 3 : i % 2 ? 7 : 4;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.quadraticCurveTo(x + 18 * Math.sin(i * 1.7), y0 + len * 0.5, x + 8 * Math.sin(i * 0.9), Math.min(252, y0 + len));
    ctx.stroke();
  }
  hairTex = new THREE.CanvasTexture(cv);
  hairTex.colorSpace = THREE.SRGBColorSpace;
  hairTex.wrapS = THREE.RepeatWrapping;
  hairTex.anisotropy = 8;
  return hairTex;
};

/** hat cloth textures (white base, multiplied by the hat color): six panels with stitched seams, a knit rib,
 *  a straw weave, a fine tweed */
const hatTexCache = new Map<string, THREE.CanvasTexture>();
export const hatTexture = (kind: "panels" | "rib" | "weave" | "tweed") => {
  const hit = hatTexCache.get(kind);
  if (hit) return hit;
  const W = 1024;
  const H = 256;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  if (kind === "panels") {
    for (let i = 0; i < 6; i++) {
      const x = (i / 6) * W;
      ctx.fillStyle = "rgba(24,22,40,0.32)";
      ctx.fillRect(x - 3, 0, 6, H);
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([9, 7]);
      for (const d of [-11, 11]) {
        ctx.beginPath();
        ctx.moveTo(x + d, 10);
        ctx.lineTo(x + d, H);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.save();
    ctx.strokeStyle = "rgba(24,22,40,0.35)";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([9, 7]);
    for (const y of [H - 14, H - 30]) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    ctx.restore();
  } else if (kind === "rib") {
    for (let x = 0; x < W; x += 14) {
      ctx.fillStyle = "rgba(24,22,40,0.2)";
      ctx.fillRect(x, 0, 5, H);
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillRect(x + 8, 0, 2, H);
    }
    ctx.fillStyle = "rgba(24,22,40,0.06)";
    for (let y = 0; y < H; y += 8) ctx.fillRect(0, y, W, 2);
  } else if (kind === "weave") {
    for (let y = 0; y < H; y += 12)
      for (let x = 0; x < W; x += 24) {
        const o = (y / 12) % 2 ? 12 : 0;
        ctx.fillStyle = "rgba(90,60,20,0.16)";
        ctx.beginPath();
        ctx.ellipse(x + o + 12, y + 6, 11, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.45)";
        ctx.fillRect(x + o + 6, y + 3, 10, 2);
      }
  } else {
    for (let y = 0; y < H; y += 6)
      for (let x = 0; x < W; x += 12) {
        const up = Math.floor(x / 24) % 2 ? 1 : -1;
        ctx.strokeStyle = (x + y) % 18 ? "rgba(24,22,40,0.14)" : "rgba(255,250,240,0.3)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 10, y + up * 5);
        ctx.stroke();
      }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  hatTexCache.set(kind, tex);
  return tex;
};
