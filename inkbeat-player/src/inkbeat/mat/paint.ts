// Deterministic hand-painted tileable textures, drawn with Canvas 2D.
// Every painter draws a NEUTRAL (near-white, mean ≈ 0.9) detail texture: plank seams, mortar, tile
// shadows, brush mottling, with slight warm/cool hue drift. Materials multiply it by their color,
// so one texture serves every color. All painters are seeded and never use Math.random.

export type Rng = () => number;
// Mulberry32 by Tommy Ettinger, CC0; see THIRD_PARTY_NOTICES.md
export const mulberry = (seed: number): Rng => {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
export const hashStr = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

type C2 = CanvasRenderingContext2D;
const rgb = (r: number, g: number, b: number, a = 1) =>
  `rgba(${Math.round(Math.min(1, Math.max(0, r)) * 255)},${Math.round(Math.min(1, Math.max(0, g)) * 255)},${Math.round(Math.min(1, Math.max(0, b)) * 255)},${a})`;
// neutral tone with a little hue drift: h<0 cool (blue-violet), h>0 warm (cream)
const tone = (v: number, h = 0, a = 1) => rgb(v * (1 + 0.035 * h), v * (1 + 0.005 * h), v * (1 - 0.05 * h), a);

// draw at the 9 wrapped offsets so anything crossing an edge tiles seamlessly
const wrap = (S: number, fn: (dx: number, dy: number) => void) => {
  for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) fn(dx, dy);
};

const wrapX = (S: number, fn: (dx: number) => void) => {
  for (const dx of [-S, 0, S]) fn(dx);
};

// soft round blob (a brush dab without blur filters, so it wraps cleanly)
const blob = (g: C2, S: number, x: number, y: number, rx: number, ry: number, col: string, colEdge: string) => {
  wrap(S, (dx, dy) => {
    const cx = x + dx;
    const cy = y + dy;
    if (cx + rx < 0 || cx - rx > S || cy + ry < 0 || cy - ry > S) return;
    g.save();
    g.translate(cx, cy);
    g.scale(1, ry / rx);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
    gr.addColorStop(0, col);
    gr.addColorStop(1, colEdge);
    g.fillStyle = gr;
    g.beginPath();
    g.arc(0, 0, rx, 0, Math.PI * 2);
    g.fill();
    g.restore();
  });
};

// low-alpha mottling: big soft light and dark dabs (the "painted" feel)
const mottle = (g: C2, S: number, r: Rng, n: number, rMin: number, rMax: number, amp: number) => {
  for (let i = 0; i < n; i++) {
    const light = r() < 0.5;
    const rad = rMin + r() * (rMax - rMin);
    const a = amp * (0.4 + 0.6 * r());
    const c = light ? tone(1, 1, a) : tone(0.55, -1, a);
    const c0 = light ? tone(1, 1, 0) : tone(0.55, -1, 0);
    blob(g, S, r() * S, r() * S, rad, rad * (0.5 + r() * 0.6), c, c0);
  }
};

// short translucent brush strokes
const strokes = (g: C2, S: number, r: Rng, n: number, len: number, width: number, amp: number, angle?: number) => {
  g.lineCap = "round";
  for (let i = 0; i < n; i++) {
    const x = r() * S;
    const y = r() * S;
    const a = angle ?? r() * Math.PI;
    const l = len * (0.5 + r());
    const light = r() < 0.5;
    g.strokeStyle = light ? tone(1, 0.6, amp * r()) : tone(0.6, -0.6, amp * r());
    g.lineWidth = width * (0.5 + r());
    const bend = (r() - 0.5) * l * 0.3;
    wrap(S, (dx, dy) => {
      const x0 = x + dx - (Math.cos(a) * l) / 2;
      const y0 = y + dy - (Math.sin(a) * l) / 2;
      const x1 = x + dx + (Math.cos(a) * l) / 2;
      const y1 = y + dy + (Math.sin(a) * l) / 2;
      if (Math.max(x0, x1) < -width || Math.min(x0, x1) > S + width || Math.max(y0, y1) < -width || Math.min(y0, y1) > S + width) return;
      g.beginPath();
      g.moveTo(x0, y0);
      g.quadraticCurveTo(x + dx - Math.sin(a) * bend, y + dy + Math.cos(a) * bend, x1, y1);
      g.stroke();
    });
  }
};

const speckle = (g: C2, S: number, r: Rng, n: number, size: number, amp: number) => {
  for (let i = 0; i < n; i++) {
    const light = r() < 0.5;
    g.fillStyle = light ? tone(1, 1, amp * r()) : tone(0.45, -1, amp * r());
    const s = size * (0.4 + r());
    g.beginPath();
    g.arc(r() * S, r() * S, s, 0, Math.PI * 2);
    g.fill();
  }
};

// wavy line across the whole tile (periodic in x so it tiles)
const wavyRow = (S: number, y: number, r: Rng, amp: number) => {
  const k1 = 1 + Math.floor(r() * 3);
  const k2 = 3 + Math.floor(r() * 4);
  const p1 = r() * 6.28;
  const p2 = r() * 6.28;
  const a2 = amp * 0.35;
  return (x: number) => y + amp * Math.sin((x / S) * Math.PI * 2 * k1 + p1) + a2 * Math.sin((x / S) * Math.PI * 2 * k2 + p2);
};

const fillBase = (g: C2, S: number, v: number, h = 0) => {
  g.fillStyle = tone(v, h);
  g.fillRect(0, 0, S, S);
};

const INK_LINE = (a: number) => rgb(0.3, 0.22, 0.27, a);

// ---------------------------------------------------------------- painters
export type Painter = (g: C2, S: number, r: Rng) => void;

const plaster: Painter = (g, S, r) => {
  fillBase(g, S, 0.9, 0.3);
  mottle(g, S, r, 80, S * 0.08, S * 0.3, 0.2);
  strokes(g, S, r, 320, S * 0.1, S * 0.035, 0.13);
  mottle(g, S, r, 140, S * 0.02, S * 0.06, 0.12);
  speckle(g, S, r, 900, 1.2, 0.18);
  // a few hairline cracks
  g.lineWidth = 1.2;
  for (let i = 0; i < 4; i++) {
    let x = r() * S;
    let y = r() * S;
    g.strokeStyle = INK_LINE(0.22);
    g.beginPath();
    g.moveTo(x, y);
    for (let j = 0; j < 7; j++) {
      x += (r() - 0.3) * 22;
      y += (r() - 0.5) * 18 + 6;
      g.lineTo(x, y);
    }
    g.stroke();
  }
};

const grainLines = (g: C2, S: number, r: Rng, x0: number, x1: number, y0: number, y1: number, n: number, amp: number) => {
  g.save();
  g.beginPath();
  g.rect(x0, y0, x1 - x0, y1 - y0);
  g.clip();
  g.lineCap = "round";
  for (let i = 0; i < n; i++) {
    const y = y0 + r() * (y1 - y0);
    const w = (y1 - y0) * 0.12 * r();
    const f = ((1 + Math.floor(r() * 4)) * Math.PI * 2) / S;
    const ph = r() * 6.28;
    g.strokeStyle = r() < 0.75 ? tone(0.55, 1, amp * (0.4 + r() * 0.6)) : tone(1, 1, amp * 0.8);
    g.lineWidth = 0.8 + r() * 1.8;
    g.beginPath();
    for (let x = x0 - 4; x <= x1 + 4; x += 8) {
      const yy = y + Math.sin(x * f + ph) * w;
      if (x === x0 - 4) g.moveTo(x, yy);
      else g.lineTo(x, yy);
    }
    g.stroke();
  }
  g.restore();
};

const planks: Painter = (g, S, r) => {
  const rows = 8;
  const H = S / rows;
  fillBase(g, S, 0.9);
  for (let i = 0; i < rows; i++) {
    const y0 = i * H;
    // butt joints: 1-2 per row, staggered
    const nj = 1 + (r() < 0.6 ? 1 : 0);
    const joints: number[] = [];
    const off = r() * S;
    for (let j = 0; j < nj; j++) joints.push((off + (j * S) / nj + (r() - 0.5) * S * 0.2) % S);
    joints.sort((a, b) => a - b);
    // segments between joints (wrapping)
    for (let j = 0; j < joints.length; j++) {
      const a = joints[j];
      let b = joints[(j + 1) % joints.length];
      if (b <= a) b += S;
      const v = 0.85 + r() * 0.11;
      const h = (r() * 2 - 1) * 0.6;
      for (const dx of [-S, 0]) {
        const x0 = a + dx;
        const x1 = b + dx;
        if (x1 < 0 || x0 > S) continue;
        g.fillStyle = tone(v, h);
        g.fillRect(x0, y0, x1 - x0, H);
        // lap shading: darker just under the board above, a lit bevel at the lower edge
        const gr = g.createLinearGradient(0, y0, 0, y0 + H);
        gr.addColorStop(0, tone(0.45, -1, 0.26));
        gr.addColorStop(0.3, tone(0.45, -1, 0));
        gr.addColorStop(0.82, tone(1, 1, 0));
        gr.addColorStop(1, tone(1, 1, 0.18));
        g.fillStyle = gr;
        g.fillRect(x0, y0, x1 - x0, H);
      }
      const seed = Math.floor(r() * 1e9);
      for (const dx of [-S, 0, S]) grainLines(g, S, mulberry(seed), a + dx, b + dx, y0 + 3, y0 + H - 3, 7, 0.22);
    }
    // seam (dark line + highlight under it)
    g.fillStyle = INK_LINE(0.8);
    g.fillRect(0, y0, S, 3);
    g.fillStyle = tone(1, 1, 0.3);
    g.fillRect(0, y0 + H - 2, S, 2);
    // joints with nail dots
    for (const jx of joints) {
      wrapX(S, (dx) => {
        const x = jx + dx;
        if (x < -10 || x > S + 10) return;
        g.fillStyle = INK_LINE(0.7);
        g.fillRect(x - 1.5, y0, 3, H);
        g.fillStyle = tone(1, 1, 0.22);
        g.fillRect(x + 1.5, y0, 1.5, H);
        g.fillStyle = INK_LINE(0.45);
        for (const s of [-1, 1]) {
          g.beginPath();
          g.arc(x + s * 8, y0 + H * 0.55, 2.1, 0, Math.PI * 2);
          g.fill();
        }
      });
    }
  }
  mottle(g, S, r, 50, S * 0.05, S * 0.2, 0.06);
  speckle(g, S, r, 500, 1.1, 0.12);
};

const wood: Painter = (g, S, r) => {
  fillBase(g, S, 0.88, 0.5);
  // broad tonal streaks
  for (let i = 0; i < 18; i++) {
    const y = r() * S;
    const h = S * (0.02 + r() * 0.08);
    const light = r() < 0.5;
    wrapX(S, (dy) => {
      const gr = g.createLinearGradient(0, y + dy - h, 0, y + dy + h);
      const c = light ? tone(1, 1, 0.12) : tone(0.6, 0.5, 0.12);
      gr.addColorStop(0, light ? tone(1, 1, 0) : tone(0.6, 0.5, 0));
      gr.addColorStop(0.5, c);
      gr.addColorStop(1, light ? tone(1, 1, 0) : tone(0.6, 0.5, 0));
      g.fillStyle = gr;
      g.fillRect(0, y + dy - h, S, 2 * h);
    });
  }
  const gs = Math.floor(r() * 1e9);
  for (const dy of [-S, 0, S]) grainLines(g, S, mulberry(gs), 0, S, dy, S + dy, 60, 0.28);
  // knots
  for (let i = 0; i < 3; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 10 + r() * 14;
    wrap(S, (dx, dy) => {
      for (let k = 3; k >= 1; k--) {
        g.strokeStyle = INK_LINE(0.18 + 0.1 * (3 - k));
        g.lineWidth = 2;
        g.beginPath();
        g.ellipse(x + dx, y + dy, rad * k * 0.9, rad * k * 0.35, 0, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = INK_LINE(0.35);
      g.beginPath();
      g.ellipse(x + dx, y + dy, rad * 0.5, rad * 0.22, 0, 0, Math.PI * 2);
      g.fill();
    });
  }
  speckle(g, S, r, 300, 1, 0.1);
};

// block courses (stone/brick): returns nothing, paints blocks with bevel light/dark and mortar
const blocks = (g: C2, S: number, r: Rng, courses: number, wMin: number, wMax: number, mortar: number, bevel: number, vMin: number, vMax: number, running: boolean, irregular: number) => {
  const H = S / courses;
  // mortar
  fillBase(g, S, 0.42, -1);
  for (let i = 0; i < courses; i++) {
    const y0 = i * H;
    // widths that sum exactly to S (so the row tiles)
    const ws: number[] = [];
    let sum = 0;
    while (sum < S - wMin) {
      const w = running ? (wMin + wMax) / 2 : wMin + r() * (wMax - wMin);
      ws.push(w);
      sum += w;
    }
    const k = S / sum;
    let x = running ? (i % 2 ? -ws[0] * k * 0.5 : 0) : -r() * ws[0] * k;
    for (const w0 of ws) {
      const w = w0 * k;
      const v = vMin + r() * (vMax - vMin);
      const h = r() * 2 - 1;
      const jit = () => (r() - 0.5) * irregular;
      const pts: [number, number][] = [
        [x + mortar / 2 + jit(), y0 + mortar / 2 + jit()],
        [x + w - mortar / 2 + jit(), y0 + mortar / 2 + jit()],
        [x + w - mortar / 2 + jit(), y0 + H - mortar / 2 + jit()],
        [x + mortar / 2 + jit(), y0 + H - mortar / 2 + jit()],
      ];
      const rad = Math.min(6, mortar);
      wrapX(S, (dx) => {
        if (x + w + dx < 0 || x + dx > S) return;
        const P = pts.map(([px, py]) => [px + dx, py] as [number, number]);
        const path = () => {
          g.beginPath();
          // rounded quad
          for (let q = 0; q < 4; q++) {
            const a = P[q];
            const b = P[(q + 1) % 4];
            const mx = (a[0] + b[0]) / 2;
            const my = (a[1] + b[1]) / 2;
            if (q === 0) g.moveTo(mx, my);
            g.arcTo(b[0], b[1], (b[0] + P[(q + 2) % 4][0]) / 2, (b[1] + P[(q + 2) % 4][1]) / 2, rad);
          }
          g.closePath();
        };
        path();
        g.fillStyle = tone(v, h);
        g.fill();
        g.save();
        path();
        g.clip();
        // bevel: light top-left, dark bottom-right
        const gr = g.createLinearGradient(0, P[0][1], 0, P[3][1]);
        gr.addColorStop(0, tone(1, 1, bevel));
        gr.addColorStop(0.25, tone(1, 1, 0));
        gr.addColorStop(0.7, tone(0.4, -1, 0));
        gr.addColorStop(1, tone(0.4, -1, bevel * 1.2));
        g.fillStyle = gr;
        g.fillRect(P[0][0] - 4, P[0][1] - 4, w + 8, H + 8);
        // per-block painterly dabs
        for (let d = 0; d < 4; d++) {
          const bx = P[0][0] + r() * w;
          const by = P[0][1] + r() * H;
          const br = Math.min(w, H) * (0.2 + r() * 0.4);
          const light = r() < 0.5;
          const gr2 = g.createRadialGradient(bx, by, 0, bx, by, br);
          gr2.addColorStop(0, light ? tone(1, 1, 0.12) : tone(0.5, -1, 0.12));
          gr2.addColorStop(1, light ? tone(1, 1, 0) : tone(0.5, -1, 0));
          g.fillStyle = gr2;
          g.fillRect(bx - br, by - br, 2 * br, 2 * br);
        }
        g.restore();
        // inked edge
        path();
        g.strokeStyle = INK_LINE(0.55);
        g.lineWidth = 1.6;
        g.stroke();
      });
      x += w;
    }
  }
};

const stone: Painter = (g, S, r) => {
  blocks(g, S, r, 6, S * 0.18, S * 0.34, 7, 0.22, 0.74, 0.95, false, 5);
  mottle(g, S, r, 40, S * 0.05, S * 0.15, 0.05);
  speckle(g, S, r, 700, 1.2, 0.15);
  // chips
  g.strokeStyle = INK_LINE(0.3);
  g.lineWidth = 1.2;
  for (let i = 0; i < 10; i++) {
    const x = r() * S;
    const y = r() * S;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * 20, y + r() * 14);
    g.lineTo(x + (r() - 0.5) * 30, y + r() * 26);
    g.stroke();
  }
};

const brick: Painter = (g, S, r) => {
  blocks(g, S, r, 16, S / 4.2, S / 4.2, 5, 0.2, 0.72, 0.97, true, 1.5);
  mottle(g, S, r, 40, S * 0.04, S * 0.14, 0.06);
  speckle(g, S, r, 900, 1, 0.16);
};

// overlapping rows (roof tiles / shingles): rows painted bottom-up so each row overlaps the one below
const rowsOverlap = (g: C2, S: number, r: Rng, rows: number, wMin: number, wMax: number, rounded: boolean) => {
  const H = S / rows;
  fillBase(g, S, 0.35, -1);
  for (let i = rows; i >= -1; i--) {
    const y0 = i * H; // top of the visible part of this row
    const ws: number[] = [];
    let sum = 0;
    while (sum < S - wMin) {
      const w = wMin + r() * (wMax - wMin);
      ws.push(w);
      sum += w;
    }
    const k = S / sum;
    let x = -r() * ws[0] * k;
    for (const w0 of ws) {
      const w = w0 * k;
      const v = 0.78 + r() * 0.2;
      const h = r() * 2 - 1;
      const bot = y0 + H + (rounded ? 0 : (r() - 0.5) * 5);
      for (const dx of [-S, 0, S]) {
        const x0 = x + dx + 1.5;
        const x1 = x + dx + w - 1.5;
        if (x1 < 0 || x0 > S) continue;
        g.beginPath();
        g.moveTo(x0, y0 - H * 0.6);
        g.lineTo(x1, y0 - H * 0.6);
        if (rounded) {
          g.lineTo(x1, bot - w * 0.25);
          g.quadraticCurveTo((x0 + x1) / 2, bot + w * 0.22, x0, bot - w * 0.25);
        } else {
          g.lineTo(x1, bot);
          g.lineTo(x0, bot + (r() - 0.5) * 3);
        }
        g.closePath();
        const gr = g.createLinearGradient(0, y0, 0, bot);
        gr.addColorStop(0, tone(v * 0.62, h)); // shadowed under the row above
        gr.addColorStop(0.35, tone(v * 0.95, h));
        gr.addColorStop(0.85, tone(v, h));
        gr.addColorStop(1, tone(v * 1.03, h));
        g.fillStyle = gr;
        g.fill();
        // barrel highlight for clay tiles
        if (rounded) {
          const gx = g.createLinearGradient(x0, 0, x1, 0);
          gx.addColorStop(0, tone(0.5, -1, 0.22));
          gx.addColorStop(0.35, tone(1, 1, 0.16));
          gx.addColorStop(0.55, tone(1, 1, 0));
          gx.addColorStop(1, tone(0.5, -1, 0.25));
          g.fillStyle = gx;
          g.fill();
        }
        g.strokeStyle = INK_LINE(0.6);
        g.lineWidth = 1.8;
        g.stroke();
      }
      x += w;
    }
    // cast shadow of this row on the row below (drawn after, on the next row's top)
  }
  // soft shadow bands under each row edge
  for (let i = 0; i <= rows; i++) {
    const y = i * H + (rounded ? H * 0.05 : 0);
    const gr = g.createLinearGradient(0, y, 0, y + H * 0.35);
    gr.addColorStop(0, tone(0.3, -1, 0.35));
    gr.addColorStop(1, tone(0.3, -1, 0));
    g.fillStyle = gr;
    g.fillRect(0, y, S, H * 0.35);
  }
};

const roofTiles: Painter = (g, S, r) => {
  rowsOverlap(g, S, r, 8, S / 9, S / 7, true);
  mottle(g, S, r, 40, S * 0.05, S * 0.15, 0.06);
  speckle(g, S, r, 500, 1.1, 0.14);
};

const shingles: Painter = (g, S, r) => {
  rowsOverlap(g, S, r, 10, S / 14, S / 7, false);
  mottle(g, S, r, 40, S * 0.05, S * 0.15, 0.07);
  strokes(g, S, r, 200, S * 0.04, 1.5, 0.12, Math.PI / 2);
};

const rock: Painter = (g, S, r) => {
  fillBase(g, S, 0.86);
  const bands = 7;
  const lines: ((x: number) => number)[] = [];
  for (let i = 0; i < bands; i++) lines.push(wavyRow(S, (i / bands) * S + (r() - 0.5) * S * 0.05, r, S * 0.015 + r() * S * 0.02));
  for (let i = 0; i < bands; i++) {
    const top = lines[i];
    const bot = i + 1 < bands ? lines[i + 1] : (x: number) => lines[0](x) + S;
    const v = 0.72 + r() * 0.25;
    const h = r() * 2 - 1;
    for (const dy of [-S, 0]) {
      g.beginPath();
      for (let x = 0; x <= S; x += 8) g.lineTo(x, top(x) + dy);
      for (let x = S; x >= 0; x -= 8) g.lineTo(x, bot(x) + dy);
      g.closePath();
      g.fillStyle = tone(v, h);
      g.fill();
      // shading inside the band: lit top ledge, darker underside
      g.save();
      g.clip();
      const yt = top(S / 2) + dy;
      const yb = bot(S / 2) + dy;
      const gr = g.createLinearGradient(0, yt - S * 0.02, 0, yb + S * 0.02);
      gr.addColorStop(0, tone(1, 1, 0.3));
      gr.addColorStop(0.18, tone(1, 1, 0));
      gr.addColorStop(0.7, tone(0.4, -1, 0));
      gr.addColorStop(1, tone(0.35, -1, 0.35));
      g.fillStyle = gr;
      g.fillRect(0, Math.min(yt, yb) - S * 0.05, S, Math.abs(yb - yt) + S * 0.1);
      g.restore();
    }
  }
  // inked strata lines
  for (const l of lines) {
    for (const dy of [-S, 0, S]) {
      g.strokeStyle = INK_LINE(0.55);
      g.lineWidth = 2.2;
      g.beginPath();
      for (let x = 0; x <= S; x += 6) g.lineTo(x, l(x) + dy);
      g.stroke();
    }
  }
  // vertical cracks
  for (let i = 0; i < 16; i++) {
    let x = r() * S;
    let y = r() * S;
    const n = 3 + Math.floor(r() * 4);
    const pts: [number, number][] = [[x, y]];
    for (let j = 0; j < n; j++) {
      x += (r() - 0.5) * 18;
      y += 10 + r() * 16;
      pts.push([x, y]);
    }
    wrap(S, (dx, dy) => {
      g.strokeStyle = INK_LINE(0.45);
      g.lineWidth = 1.6;
      g.beginPath();
      pts.forEach(([px, py], k) => (k ? g.lineTo(px + dx, py + dy) : g.moveTo(px + dx, py + dy)));
      g.stroke();
      g.strokeStyle = tone(1, 1, 0.25);
      g.lineWidth = 1.2;
      g.beginPath();
      pts.forEach(([px, py], k) => (k ? g.lineTo(px + dx + 2, py + dy) : g.moveTo(px + dx + 2, py + dy)));
      g.stroke();
    });
  }
  mottle(g, S, r, 60, S * 0.04, S * 0.14, 0.08);
  speckle(g, S, r, 800, 1.3, 0.16);
};

const sand: Painter = (g, S, r) => {
  fillBase(g, S, 0.92, 0.5);
  mottle(g, S, r, 70, S * 0.06, S * 0.22, 0.14);
  // ripples
  for (let i = 0; i < 14; i++) {
    const l = wavyRow(S, r() * S, r, S * 0.01 + r() * S * 0.01);
    for (const dy of [-S, 0, S]) {
      g.strokeStyle = tone(0.6, -1, 0.1);
      g.lineWidth = 2 + r() * 2;
      g.beginPath();
      for (let x = 0; x <= S; x += 8) g.lineTo(x, l(x) + dy);
      g.stroke();
      g.strokeStyle = tone(1, 1, 0.12);
      g.lineWidth = 1.5;
      g.beginPath();
      for (let x = 0; x <= S; x += 8) g.lineTo(x, l(x) + dy + 3);
      g.stroke();
    }
  }
  speckle(g, S, r, 3500, 1.3, 0.35);
};

const grass: Painter = (g, S, r) => {
  fillBase(g, S, 0.78, -0.3);
  mottle(g, S, r, 60, S * 0.06, S * 0.22, 0.22);
  g.lineCap = "round";
  for (let i = 0; i < 2400; i++) {
    const x = r() * S;
    const y = r() * S;
    const l = 18 + r() * 40;
    const lean = (r() - 0.5) * 10;
    const v = 0.62 + r() * 0.45;
    const h = v > 0.9 ? 1.2 : -0.8;
    g.strokeStyle = tone(v, h, 0.75);
    g.lineWidth = 2 + r() * 2.5;
    wrap(S, (dx, dy) => {
      const bx = x + dx;
      const by = y + dy;
      if (bx < -30 || bx > S + 30 || by < -30 || by > S + 30) return;
      g.beginPath();
      g.moveTo(bx, by);
      g.quadraticCurveTo(bx + lean * 0.3, by - l * 0.6, bx + lean, by - l);
      g.stroke();
    });
  }
};

const fabric: Painter = (g, S, r) => {
  fillBase(g, S, 0.9, 0.2);
  const cell = 8;
  for (let y = 0; y < S; y += cell) {
    for (let x = 0; x < S; x += cell) {
      const odd = ((x / cell) + (y / cell)) % 2;
      g.fillStyle = odd ? tone(1, 0.5, 0.16) : tone(0.5, -0.5, 0.16);
      if (odd) g.fillRect(x, y + 1, cell, cell - 2);
      else g.fillRect(x + 1, y, cell - 2, cell);
    }
  }
  mottle(g, S, r, 60, S * 0.05, S * 0.18, 0.16);
  strokes(g, S, r, 120, S * 0.08, 1, 0.12, 0);
};

const metal: Painter = (g, S, r) => {
  fillBase(g, S, 0.86, -0.4);
  mottle(g, S, r, 60, S * 0.05, S * 0.25, 0.18);
  strokes(g, S, r, 600, S * 0.15, 1.2, 0.2, 0);
  // scratches
  g.lineWidth = 1;
  for (let i = 0; i < 30; i++) {
    const x = r() * S;
    const y = r() * S;
    const a = r() * Math.PI;
    const l = 10 + r() * 40;
    g.strokeStyle = r() < 0.5 ? tone(1, 0, 0.35) : INK_LINE(0.2);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  speckle(g, S, r, 400, 1.2, 0.14);
};

const paper: Painter = (g, S, r) => {
  fillBase(g, S, 0.94, 0.6);
  mottle(g, S, r, 70, S * 0.04, S * 0.2, 0.11);
  g.lineWidth = 0.8;
  for (let i = 0; i < 700; i++) {
    const x = r() * S;
    const y = r() * S;
    const a = r() * Math.PI * 2;
    const l = 4 + r() * 12;
    g.strokeStyle = tone(0.6, 0.5, 0.12 * r());
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a + 0.6) * l * 0.5, y + Math.sin(a + 0.6) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  speckle(g, S, r, 600, 0.9, 0.12);
};

export const PAINTERS: Record<string, Painter> = { plaster, planks, wood, stone, brick, roofTiles, shingles, rock, sand, grass, fabric, metal, paper };
