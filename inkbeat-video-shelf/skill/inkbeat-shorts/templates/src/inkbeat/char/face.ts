// Face decal: features drawn with Canvas2D as filled, tapered shapes and cached by expression. The canvas covers
// head-local x, y in [-FACE_SPAN, FACE_SPAN] head half-widths (y down on the canvas) and is transparent elsewhere;
// material.ts projects it onto the front of the head and lights it with the head.
// Style: oval eyes with a highlight and an upper lid line, thick arched brows, a small nose, a mouth with a lip line,
// cheek blush. Expressions: eyes, mouth, brows, look, blink, sweat (and flush in the material).
import * as THREE from "three";
import type { Eyes, Mouth } from "../types";
import { shade } from "./clothes";
import { BROW_UP, CHEEK, EYE_X, EYE_Y, FACE_COLORS, FACE_SPAN, INK, IRIS, MOUTH_Y, NOSE_Y } from "./family";
import type { FaceStyle } from "./family";

const SIZE = 1024;
const PX = SIZE / (2 * FACE_SPAN); // px per hw

export type Brows = "none" | "angry" | "worried" | "raised" | "neutral";
export type FaceSpec = {
  eyes?: Eyes;
  mouth?: Mouth;
  brows?: Brows;
  look?: number; // -1..1, the eyes look sideways
  blink?: boolean;
  sweat?: boolean; // a drop on the temple
  style: FaceStyle;
  skin: string;
  browColor: string;
  mustache?: string | false;
  beard?: string | false;
};

type P = [number, number];
const X = (x: number) => SIZE / 2 + x * PX;
const Y = (y: number) => SIZE / 2 + y * PX;
type Ctx = CanvasRenderingContext2D;

const qpt = (a: P, c: P, b: P, t: number): P => {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
};

/** a filled tapered stroke along a quadratic curve: thick middle, round thin ends; bias > 0 = thicker at a */
const taper = (ctx: Ctx, a: P, c: P, b: P, wMid: number, wEnd = wMid * 0.4, color = INK, bias = 0) => {
  const N = 30;
  const L: P[] = [];
  const R: P[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = qpt(a, c, b, t);
    const p2 = qpt(a, c, b, Math.min(1, t + 0.01));
    const p1 = qpt(a, c, b, Math.max(0, t - 0.01));
    let dx = p2[0] - p1[0];
    let dy = p2[1] - p1[1];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    const prof = Math.pow(Math.sin(Math.PI * t), 0.6);
    const w = (wEnd + (wMid - wEnd) * prof) * (1 + bias * (0.5 - t)) * 0.5;
    L.push([p[0] - dy * w, p[1] + dx * w]);
    R.push([p[0] + dy * w, p[1] - dx * w]);
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(X(L[0][0]), Y(L[0][1]));
  for (const p of L) ctx.lineTo(X(p[0]), Y(p[1]));
  for (let i = R.length - 1; i >= 0; i--) ctx.lineTo(X(R[i][0]), Y(R[i][1]));
  ctx.closePath();
  ctx.fill();
  for (const [p, k] of [
    [a, 1 + bias * 0.5],
    [b, 1 - bias * 0.5],
  ] as [P, number][]) {
    ctx.beginPath();
    ctx.arc(X(p[0]), Y(p[1]), Math.max(1, wEnd * 0.5 * k * PX), 0, Math.PI * 2);
    ctx.fill();
  }
};

const ellipse = (ctx: Ctx, cx: number, cy: number, rx: number, ry: number, fill?: string, stroke?: string, lw = 0.03, rot = 0) => {
  ctx.beginPath();
  ctx.ellipse(X(cx), Y(cy), rx * PX, ry * PX, rot, 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw * PX;
    ctx.stroke();
  }
};

// ------------------------------------------------------------------ eyes
/** iris + highlight (clipped to an optional top line) */
const iris = (ctx: Ctx, cx: number, cy: number, rx: number, ry: number, color: string, clipTop?: number) => {
  ctx.save();
  if (clipTop !== undefined) {
    ctx.beginPath();
    ctx.rect(X(cx - 0.4), Y(clipTop), 0.8 * PX, 0.6 * PX);
    ctx.clip();
  }
  ellipse(ctx, cx, cy, rx, ry, color);
  // a darker pupil and the glint
  ellipse(ctx, cx, cy + ry * 0.08, rx * 0.55, ry * 0.55, shade(color, 0.55));
  ellipse(ctx, cx + rx * 0.36, cy - ry * 0.36, rx * 0.34, ry * 0.27, FACE_COLORS.glint);
  ellipse(ctx, cx - rx * 0.3, cy + ry * 0.42, rx * 0.13, ry * 0.1, "rgba(253,253,251,0.8)");
  ctx.restore();
};

/** the upper lid line; s = side (+1 viewer's right), lift moves it up, drop flattens it onto the eye */
const lid = (ctx: Ctx, cx: number, s: number, y: number, style: FaceStyle, tilt = 0, w = 0.056) => {
  const ix = cx - s * 0.13;
  const ox = cx + s * 0.14;
  taper(ctx, [ix, y + 0.055 + tilt * -0.5], [cx + s * 0.01, y - 0.04], [ox, y + 0.045 + tilt * 0.5], w, w * 0.4, INK, -0.35);
  if (style.lash) taper(ctx, [ox - s * 0.01, y + 0.045 + tilt * 0.5], [ox + s * 0.03, y + 0.02], [ox + s * 0.05, y - 0.02], 0.032, 0.012);
};

const drawEye = (ctx: Ctx, s: -1 | 1, eyes: Eyes, look: number, blink: boolean, style: FaceStyle) => {
  const cx = s * EYE_X;
  const lx = look * 0.055;
  const top = EYE_Y - IRIS.ry - 0.035; // lid line height over an open eye
  if (blink) {
    taper(ctx, [cx - 0.13, EYE_Y + 0.0], [cx, EYE_Y + 0.045], [cx + 0.13, EYE_Y - 0.0], 0.05, 0.02);
    if (style.lash) taper(ctx, [cx + s * 0.12, EYE_Y], [cx + s * 0.15, EYE_Y - 0.005], [cx + s * 0.17, EYE_Y - 0.035], 0.03, 0.01);
    return;
  }
  switch (eyes) {
    case "wide": {
      ellipse(ctx, cx, EYE_Y - 0.01, 0.135, 0.158, FACE_COLORS.sclera, INK, 0.026);
      iris(ctx, cx + lx * 1.3, EYE_Y + 0.005, IRIS.rx * 0.88, IRIS.ry * 0.82, style.eyeColor);
      lid(ctx, cx, s, EYE_Y - 0.205, style, 0, 0.042);
      return;
    }
    case "half": {
      const cut = EYE_Y - 0.02;
      iris(ctx, cx + lx, EYE_Y + 0.02, IRIS.rx, IRIS.ry, style.eyeColor, cut);
      taper(ctx, [cx - 0.13, cut + 0.012], [cx, cut - 0.02], [cx + 0.135, cut + 0.012], 0.058, 0.026);
      if (style.lash) taper(ctx, [cx + s * 0.125, cut + 0.01], [cx + s * 0.155, cut - 0.0], [cx + s * 0.175, cut - 0.03], 0.03, 0.01);
      return;
    }
    case "angry": {
      const cut = EYE_Y - 0.01;
      ctx.save();
      ctx.translate(X(cx), Y(cut));
      ctx.rotate(s * -0.32);
      ctx.translate(-X(cx), -Y(cut));
      iris(ctx, cx + lx, EYE_Y + 0.025, IRIS.rx, IRIS.ry * 0.95, style.eyeColor, cut);
      taper(ctx, [cx - 0.135, cut + 0.008], [cx, cut - 0.012], [cx + 0.135, cut + 0.008], 0.062, 0.03);
      ctx.restore();
      return;
    }
    case "closed": {
      // asleep / content: a soft downward arc with lashes
      taper(ctx, [cx - 0.125, EYE_Y - 0.01], [cx, EYE_Y + 0.075], [cx + 0.125, EYE_Y - 0.01], 0.05, 0.022);
      for (const k of [0.35, 0.7]) {
        const bx = cx + s * 0.11 * k;
        taper(ctx, [bx, EYE_Y + 0.03 + 0.012 * (1 - k)], [bx + s * 0.012, EYE_Y + 0.06], [bx + s * 0.02, EYE_Y + 0.085], 0.022, 0.008);
      }
      return;
    }
    case "squint": {
      // happy squint: an upward arc with a lower lid crease
      taper(ctx, [cx - 0.125, EYE_Y + 0.045], [cx, EYE_Y - 0.085], [cx + 0.125, EYE_Y + 0.045], 0.056, 0.024);
      taper(ctx, [cx - 0.08, EYE_Y + 0.105], [cx, EYE_Y + 0.085], [cx + 0.08, EYE_Y + 0.105], 0.022, 0.008, shade(INK, 1.0));
      return;
    }
    default: {
      // open: an oval iris with a highlight under a curved upper lid line
      iris(ctx, cx + lx, EYE_Y, IRIS.rx, IRIS.ry, style.eyeColor);
      lid(ctx, cx, s, top, style);
    }
  }
};

const drawBrow = (ctx: Ctx, s: -1 | 1, brows: Brows, eyes: Eyes, style: FaceStyle, color: string) => {
  if (brows === "none") return;
  const cx = s * (EYE_X + 0.015);
  const by = EYE_Y - BROW_UP - (eyes === "wide" ? 0.06 : 0);
  const inner = cx - s * 0.13;
  const outer = cx + s * 0.17;
  let yi = by + 0.01;
  let yo = by + 0.03;
  let arch = -0.07;
  if (brows === "angry") {
    yi = by + 0.085;
    yo = by - 0.03;
    arch = -0.02;
  } else if (brows === "worried") {
    yi = by - 0.07;
    yo = by + 0.06;
    arch = -0.025;
  } else if (brows === "raised") {
    yi = by - 0.06;
    yo = by - 0.03;
    arch = -0.11;
  }
  const w = 0.072 * style.brow;
  // blunt, full inner end, pointed outer end; a thin darker edge underneath gives the brow volume
  taper(ctx, [inner, yi], [cx + s * 0.01, (yi + yo) / 2 + arch], [outer, yo], w, w * 0.32, color, 0.7);
  taper(ctx, [inner + s * 0.02, yi + w * 0.38], [cx + s * 0.01, (yi + yo) / 2 + arch + w * 0.42], [outer - s * 0.03, yo + w * 0.15], w * 0.22, w * 0.06, shade(color, 0.7), 0.4);
};

// ------------------------------------------------------------------ nose, cheeks, lines
const drawNose = (ctx: Ctx, style: FaceStyle, skin: string) => {
  const sh = shade(skin, 0.68, [1.02, 0.94, 0.92]);
  if (style.nose === "hook") {
    taper(ctx, [0.035, NOSE_Y - 0.13], [0.115, NOSE_Y + 0.02], [-0.015, NOSE_Y + 0.045], 0.038, 0.012, INK, -0.4);
    ellipse(ctx, -0.045, NOSE_Y + 0.04, 0.022, 0.014, sh);
  } else if (style.nose === "button") {
    ellipse(ctx, 0, NOSE_Y, 0.085, 0.068, shade(skin, 0.9, [1.02, 0.96, 0.96]));
    taper(ctx, [-0.075, NOSE_Y + 0.02], [0, NOSE_Y + 0.085], [0.075, NOSE_Y + 0.02], 0.03, 0.01, INK);
    ellipse(ctx, 0.025, NOSE_Y - 0.03, 0.022, 0.016, "rgba(255,250,244,0.55)");
  }
};

const drawBlush = (ctx: Ctx, amt: number) => {
  if (amt <= 0) return;
  for (const s of [-1, 1]) {
    const g = ctx.createRadialGradient(X(s * CHEEK.x), Y(CHEEK.y), 0, X(s * CHEEK.x), Y(CHEEK.y), CHEEK.rx * PX);
    g.addColorStop(0, `rgba(236,122,127,${(0.55 * amt).toFixed(3)})`);
    g.addColorStop(1, "rgba(236,122,127,0)");
    ctx.save();
    ctx.translate(X(s * CHEEK.x), Y(CHEEK.y));
    ctx.scale(1, CHEEK.ry / CHEEK.rx);
    ctx.translate(-X(s * CHEEK.x), -Y(CHEEK.y));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(X(s * CHEEK.x), Y(CHEEK.y), CHEEK.rx * PX, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
};

const drawLines = (ctx: Ctx, skin: string) => {
  const c = shade(skin, 0.62, [1.02, 0.93, 0.92]);
  for (const s of [-1, 1]) {
    // a crease under the eye and a smile line beside the nose
    taper(ctx, [s * (EYE_X - 0.08), EYE_Y + 0.17], [s * EYE_X, EYE_Y + 0.2], [s * (EYE_X + 0.1), EYE_Y + 0.16], 0.02, 0.006, c);
    taper(ctx, [s * 0.17, NOSE_Y + 0.06], [s * 0.27, MOUTH_Y - 0.08], [s * 0.24, MOUTH_Y + 0.06], 0.024, 0.006, c);
  }
};

// ------------------------------------------------------------------ mouths
const MY = MOUTH_Y;

const mouthPath = (ctx: Ctx, pts: (ctx: Ctx) => void, inner: (ctx: Ctx) => void, lw = 0.03) => {
  ctx.beginPath();
  pts(ctx);
  ctx.closePath();
  ctx.fillStyle = FACE_COLORS.mouth;
  ctx.fill();
  ctx.save();
  ctx.clip();
  inner(ctx);
  ctx.restore();
  ctx.beginPath();
  pts(ctx);
  ctx.closePath();
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw * PX;
  ctx.lineJoin = "round";
  ctx.stroke();
};

const teeth = (ctx: Ctx, x0: number, x1: number, yTop: number, hgt: number) => {
  ctx.fillStyle = FACE_COLORS.teeth;
  ctx.fillRect(X(x0), Y(yTop - 0.1), (x1 - x0) * PX, (hgt + 0.1) * PX);
  ctx.fillStyle = "rgba(91,30,46,0.35)";
  ctx.fillRect(X(x0), Y(yTop + hgt - 0.012), (x1 - x0) * PX, 0.012 * PX);
};

const tongue = (ctx: Ctx, cx: number, cy: number, rx: number, ry: number) => {
  ellipse(ctx, cx, cy, rx, ry, FACE_COLORS.tongue);
  ellipse(ctx, cx - rx * 0.25, cy - ry * 0.35, rx * 0.35, ry * 0.25, "rgba(255,230,232,0.35)");
};

/** the lower lip: a short soft arc under the mouth in a darker skin tone */
const lowerLip = (ctx: Ctx, skin: string, y: number, w = 0.075) => {
  taper(ctx, [-w, y], [0, y + 0.03], [w, y], 0.03, 0.008, shade(skin, 0.74, [1.04, 0.9, 0.9]));
};

const drawMouth = (ctx: Ctx, m: Mouth, skin: string) => {
  switch (m) {
    case "smile":
      taper(ctx, [-0.17, MY - 0.045], [0, MY + 0.1], [0.17, MY - 0.045], 0.044, 0.018);
      for (const s of [-1, 1]) taper(ctx, [s * 0.195, MY - 0.075], [s * 0.18, MY - 0.045], [s * 0.155, MY - 0.02], 0.022, 0.01);
      lowerLip(ctx, skin, MY + 0.105);
      return;
    case "frown":
      taper(ctx, [-0.14, MY + 0.05], [0, MY - 0.055], [0.14, MY + 0.05], 0.042, 0.018);
      lowerLip(ctx, skin, MY + 0.07, 0.06);
      return;
    case "smirk":
      taper(ctx, [-0.12, MY + 0.015], [0.05, MY + 0.06], [0.18, MY - 0.055], 0.042, 0.016, INK, 0.4);
      taper(ctx, [0.2, MY - 0.08], [0.185, MY - 0.05], [0.16, MY - 0.03], 0.02, 0.008);
      lowerLip(ctx, skin, MY + 0.085, 0.06);
      return;
    case "o":
      mouthPath(
        ctx,
        (c) => c.ellipse(X(0), Y(MY + 0.01), 0.062 * PX, 0.082 * PX, 0, 0, Math.PI * 2),
        (c) => tongue(c, 0, MY + 0.08, 0.05, 0.035),
        0.028,
      );
      lowerLip(ctx, skin, MY + 0.125, 0.055);
      return;
    case "open":
      mouthPath(
        ctx,
        (c) => {
          c.moveTo(X(-0.16), Y(MY - 0.04));
          c.quadraticCurveTo(X(0), Y(MY - 0.07), X(0.16), Y(MY - 0.04));
          c.bezierCurveTo(X(0.17), Y(MY + 0.09), X(0.07), Y(MY + 0.15), X(0), Y(MY + 0.15));
          c.bezierCurveTo(X(-0.07), Y(MY + 0.15), X(-0.17), Y(MY + 0.09), X(-0.16), Y(MY - 0.04));
        },
        (c) => {
          teeth(c, -0.14, 0.14, MY - 0.08, 0.075);
          tongue(c, 0.01, MY + 0.145, 0.1, 0.055);
        },
        0.03,
      );
      lowerLip(ctx, skin, MY + 0.19, 0.07);
      return;
    case "grin":
      mouthPath(
        ctx,
        (c) => {
          c.moveTo(X(-0.27), Y(MY - 0.07));
          c.quadraticCurveTo(X(0), Y(MY - 0.02), X(0.27), Y(MY - 0.07));
          c.bezierCurveTo(X(0.23), Y(MY + 0.12), X(0.11), Y(MY + 0.18), X(0), Y(MY + 0.18));
          c.bezierCurveTo(X(-0.11), Y(MY + 0.18), X(-0.23), Y(MY + 0.12), X(-0.27), Y(MY - 0.07));
        },
        (c) => {
          tongue(c, 0, MY + 0.18, 0.12, 0.05);
          c.save();
          c.beginPath();
          c.moveTo(X(-0.4), Y(MY - 0.2));
          c.lineTo(X(0.4), Y(MY - 0.2));
          c.lineTo(X(0.4), Y(MY + 0.0));
          c.quadraticCurveTo(X(0), Y(MY + 0.07), X(-0.4), Y(MY + 0.0));
          c.closePath();
          c.clip();
          teeth(c, -0.3, 0.3, MY - 0.2, 0.26);
          c.restore();
        },
        0.032,
      );
      for (const s of [-1, 1]) taper(ctx, [s * 0.3, MY - 0.11], [s * 0.285, MY - 0.07], [s * 0.255, MY - 0.045], 0.022, 0.01);
      lowerLip(ctx, skin, MY + 0.225, 0.09);
      return;
    case "yell":
      mouthPath(
        ctx,
        (c) => {
          c.moveTo(X(-0.23), Y(MY - 0.1));
          c.quadraticCurveTo(X(0), Y(MY - 0.15), X(0.23), Y(MY - 0.1));
          c.bezierCurveTo(X(0.24), Y(MY + 0.1), X(0.13), Y(MY + 0.25), X(0), Y(MY + 0.25));
          c.bezierCurveTo(X(-0.13), Y(MY + 0.25), X(-0.24), Y(MY + 0.1), X(-0.23), Y(MY - 0.1));
        },
        (c) => {
          tongue(c, 0.02, MY + 0.24, 0.14, 0.08);
          teeth(c, -0.2, 0.2, MY - 0.18, 0.105);
        },
        0.034,
      );
      lowerLip(ctx, skin, MY + 0.3, 0.09);
      return;
    default:
      // flat: a calm line, a slight dip at the center
      taper(ctx, [-0.13, MY], [0, MY + 0.018], [0.13, MY - 0.004], 0.04, 0.018);
      lowerLip(ctx, skin, MY + 0.06, 0.065);
  }
};

// ------------------------------------------------------------------ facial hair
/** a brush mustache: a rounded bar with turned-down ends, an ink outline and hair ticks */
const drawMustache = (ctx: Ctx, color: string) => {
  const y = MY - 0.12;
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(X(0), Y(y - 0.06));
    ctx.bezierCurveTo(X(0.12), Y(y - 0.1), X(0.25), Y(y - 0.06), X(0.27), Y(y + 0.05));
    ctx.bezierCurveTo(X(0.27), Y(y + 0.1), X(0.22), Y(y + 0.11), X(0.19), Y(y + 0.07));
    ctx.bezierCurveTo(X(0.13), Y(y + 0.04), X(0.06), Y(y + 0.045), X(0), Y(y + 0.05));
    ctx.bezierCurveTo(X(-0.06), Y(y + 0.045), X(-0.13), Y(y + 0.04), X(-0.19), Y(y + 0.07));
    ctx.bezierCurveTo(X(-0.22), Y(y + 0.11), X(-0.27), Y(y + 0.1), X(-0.27), Y(y + 0.05));
    ctx.bezierCurveTo(X(-0.25), Y(y - 0.06), X(-0.12), Y(y - 0.1), X(0), Y(y - 0.06));
    ctx.closePath();
  };
  path();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  ctx.fillRect(X(-0.3), Y(y - 0.11), 0.6 * PX, 0.05 * PX);
  ctx.strokeStyle = shade(color, 0.72);
  ctx.lineWidth = 0.014 * PX;
  ctx.lineCap = "round";
  for (let i = -5; i <= 5; i++) {
    const xv = i * 0.045;
    ctx.beginPath();
    ctx.moveTo(X(xv), Y(y + 0.04));
    ctx.lineTo(X(xv + i * 0.004), Y(y - 0.03));
    ctx.stroke();
  }
  ctx.restore();
  path();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.03 * PX;
  ctx.lineJoin = "round";
  ctx.stroke();
};

/** a short jaw beard: everything below a wavy edge, so the head's own ink hull is the beard's lower outline */
const BEARD_EDGE: P[] = [
  [-1.05, 0.22],
  [-0.9, 0.48],
  [-0.62, 0.62],
  [-0.32, 0.72],
  [0, 0.76],
];
const drawBeard = (ctx: Ctx, col: string) => {
  const e: P[] = [...BEARD_EDGE, ...BEARD_EDGE.slice(0, -1).reverse().map(([x, y]) => [-x, y] as P)];
  const edge = () => {
    ctx.moveTo(X(-1.6), Y(e[0][1]));
    ctx.lineTo(X(e[0][0]), Y(e[0][1]));
    for (let i = 1; i < e.length; i++) {
      const [ax, ay] = e[i - 1];
      const [bx, by] = e[i];
      const l = Math.hypot(bx - ax, by - ay) || 1;
      const k = 0.05;
      ctx.quadraticCurveTo(X((ax + bx) / 2 + ((by - ay) / l) * k), Y((ay + by) / 2 - ((bx - ax) / l) * k), X(bx), Y(by));
    }
    ctx.lineTo(X(1.6), Y(e[0][1]));
  };
  ctx.beginPath();
  edge();
  ctx.lineTo(X(1.6), Y(1.7));
  ctx.lineTo(X(-1.6), Y(1.7));
  ctx.closePath();
  ctx.fillStyle = col;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.beginPath();
  edge();
  ctx.strokeStyle = shade(col, 0.75);
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 0.12 * PX;
  ctx.stroke();
  ctx.globalAlpha = 1;
  for (let i = -3; i <= 3; i++) taper(ctx, [i * 0.15, 0.86], [i * 0.17, 0.95], [i * 0.16, 1.05], 0.022, 0.008, shade(col, i % 2 ? 0.8 : 1.12));
  ctx.restore();
  ctx.beginPath();
  edge();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.045 * PX;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
};

/** a sweat drop on the temple: light blue, ink outline, a glint */
const drawSweat = (ctx: Ctx) => {
  const cx = 0.66;
  const cy = -0.4;
  const r = 0.075;
  ctx.beginPath();
  ctx.moveTo(X(cx), Y(cy - r * 2.4));
  ctx.bezierCurveTo(X(cx + r * 0.3), Y(cy - r * 1.4), X(cx + r), Y(cy - r * 0.7), X(cx + r), Y(cy));
  ctx.arc(X(cx), Y(cy), r * PX, 0, Math.PI);
  ctx.bezierCurveTo(X(cx - r), Y(cy - r * 0.7), X(cx - r * 0.3), Y(cy - r * 1.4), X(cx), Y(cy - r * 2.4));
  ctx.closePath();
  ctx.fillStyle = FACE_COLORS.sweat;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.024 * PX;
  ctx.lineJoin = "round";
  ctx.stroke();
  ellipse(ctx, cx - r * 0.35, cy - r * 0.15, r * 0.2, r * 0.32, FACE_COLORS.glint, undefined, 0, 0.3);
};

// ------------------------------------------------------------------ cache
const cache = new Map<string, THREE.CanvasTexture>();
export const faceKey = (f: FaceSpec) => {
  const look = Math.round((f.look ?? 0) * 10) / 10;
  return [f.eyes ?? "open", f.mouth ?? "flat", f.brows ?? "neutral", look, f.blink ? 1 : 0, f.sweat ? 1 : 0, JSON.stringify(f.style), f.skin, f.browColor, f.mustache || 0, f.beard || 0].join("|");
};

export const faceTexture = (f: FaceSpec) => {
  const key = faceKey(f);
  const hit = cache.get(key);
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = SIZE;
  cv.height = SIZE;
  const ctx = cv.getContext("2d")!;
  ctx.clearRect(0, 0, SIZE, SIZE);
  const eyes: Eyes = f.eyes ?? "open";
  const look = Math.round((f.look ?? 0) * 10) / 10;
  const brows: Brows = f.brows ?? (eyes === "angry" ? "angry" : "neutral");
  drawBlush(ctx, f.style.blush);
  if (f.style.lines) drawLines(ctx, f.skin);
  if (f.beard) drawBeard(ctx, f.beard);
  drawEye(ctx, -1, eyes, look, !!f.blink, f.style);
  drawEye(ctx, 1, eyes, look, !!f.blink, f.style);
  drawBrow(ctx, -1, brows, eyes, f.style, f.browColor);
  drawBrow(ctx, 1, brows, eyes, f.style, f.browColor);
  drawNose(ctx, f.style, f.skin);
  ctx.save();
  if (f.beard && f.mustache) ctx.translate(0, 0.04 * PX);
  drawMouth(ctx, f.mouth ?? "flat", f.skin);
  ctx.restore();
  if (f.mustache) drawMustache(ctx, f.mustache);
  if (f.sweat) drawSweat(ctx);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  if (cache.size > 96) {
    const first = cache.keys().next().value as string;
    cache.get(first)?.dispose();
    cache.delete(first);
  }
  cache.set(key, tex);
  return tex;
};
