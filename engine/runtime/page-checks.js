// In-page sampling checks: C3 coverage, C4 text bounds, C5 text overlap, C6 empty frames, C7 frozen, C9 media.
// (C1 is lint.js, C2 is collected by the driver, C8 needs fresh pages and is orchestrated by the driver.)
const W = 1280, H = 720;
const EDGE_TOLERANCE = 2, SAFE_MARGIN = 48, MIN_FONT_PX = 14, OVERLAP_RATIO = 0.05;
const BLANK_FRACTION = 0.985, BLANK_TOL = 6;
const FROZEN_MAD = 0.15, FROZEN_SPAN_S = 2.5, INVISIBLE_ALPHA = 0.02;

const short = (s) => (s.length > 40 ? s.slice(0, 37) + '...' : s);
const f2 = (t) => t.toFixed(2);

// ---- text hook (main canvas only; text drawn into off-screen layers is not tracked)
function installTextHook(mainCanvas, sink) {
  const undo = [];
  const protos = [CanvasRenderingContext2D.prototype];
  if (typeof OffscreenCanvasRenderingContext2D !== 'undefined') protos.push(OffscreenCanvasRenderingContext2D.prototype);
  for (const proto of protos) {
    for (const name of ['fillText', 'strokeText']) {
      const orig = proto[name];
      proto[name] = function (text, x, y, maxWidth) {
        try { if (this.canvas === mainCanvas) record(this, String(text), x, y, maxWidth, sink); } catch (_) { /* never break the scene */ }
        return orig.apply(this, arguments);
      };
      undo.push(() => { proto[name] = orig; });
    }
  }
  return () => undo.forEach((f) => f());
}

function record(ctx, text, x, y, maxWidth, sink) {
  if (!text.trim() || !Number.isFinite(x) || !Number.isFinite(y)) return;
  const alpha = ctx.globalAlpha;
  if (alpha < INVISIBLE_ALPHA) return;
  const m = ctx.measureText(text);
  let f = 1;
  if (maxWidth !== undefined && Number.isFinite(maxWidth) && maxWidth > 0 && m.width > maxWidth) f = maxWidth / m.width;
  const lx0 = x - m.actualBoundingBoxLeft * f, lx1 = x + m.actualBoundingBoxRight * f;
  const ly0 = y - m.actualBoundingBoxAscent, ly1 = y + m.actualBoundingBoxDescent;
  const T = ctx.getTransform();
  const xs = [], ys = [];
  for (const [px, py] of [[lx0, ly0], [lx1, ly0], [lx0, ly1], [lx1, ly1]]) {
    xs.push(T.a * px + T.c * py + T.e);
    ys.push(T.b * px + T.d * py + T.f);
  }
  const px = /(\d+(?:\.\d+)?)px/.exec(ctx.font);
  const size = (px ? parseFloat(px[1]) : 16) * Math.sqrt(Math.abs(T.a * T.d - T.b * T.c));
  sink.push({ text, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), size });
}

// ---- pixel helpers
const pixels = (canvas) => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;

function modalFraction(data) {
  const n = data.length >> 2;
  const bins = new Uint32Array(1 << 18);
  for (let i = 0; i < data.length; i += 4) bins[((data[i] >> 2) << 12) | ((data[i + 1] >> 2) << 6) | (data[i + 2] >> 2)]++;
  let best = 0;
  for (let i = 1; i < bins.length; i++) if (bins[i] > bins[best]) best = i;
  const cr = ((best >> 12) & 63) * 4 + 2, cg = ((best >> 6) & 63) * 4 + 2, cb = (best & 63) * 4 + 2;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (Math.abs(data[i] - cr) <= BLANK_TOL && Math.abs(data[i + 1] - cg) <= BLANK_TOL && Math.abs(data[i + 2] - cb) <= BLANK_TOL) count++;
  }
  return count / n;
}

function meanAbsDiff(a, b) {
  let sum = 0, n = 0;
  for (let i = 0; i < a.length; i += 4) {
    sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    n += 3;
  }
  return sum / n;
}

export async function runPageChecks(R, opts) {
  const { level = 'fast', c3Times, c7Times = [], lastT, allowBlankStart = false, budgetMs = 9000 } = opts;
  const full = level === 'full';
  const findings = [];
  const canvas = R.canvas;
  const sampling = { c3_samples: 0, c7_samples: 0, thinned: false };
  const draws = { first: null, count: 0 };
  let nDraws = 0;
  const t0 = performance.now();

  const tryDraw = (t, scale) => {
    console.debug('vb:t=' + t);
    nDraws++;
    try { R.drawFrame(t, scale); return true; } catch (e) {
      draws.count++;
      if (!draws.first) draws.first = { t, message: e.message, stack: e.stack };
      return false;
    }
  };

  // ---- C3 (+ C4/C5 when full): draw at every sample time; thin the grid if the scene is slow
  let times = c3Times.slice();
  if (times.length) {
    const a = performance.now();
    tryDraw(times[0], 1);
    const per = performance.now() - a;
    const estimate = per * (times.length + (full ? c7Times.length * 0.15 + 4 : 2));
    if (estimate > budgetMs && times.length > 3) {
      const stride = Math.ceil(estimate / budgetMs);
      const thinned = times.filter((_, i) => i % stride === 0 || i === times.length - 1);
      sampling.thinned = true;
      sampling.c3_stride = stride;
      times = thinned;
    }
  }
  const texts = { over: new Map(), near: new Map(), size: new Map(), overlap: new Map() };
  const sink = [];
  const unhook = full ? installTextHook(canvas, sink) : () => {};
  try {
    for (const t of times) {
      sink.length = 0;
      if (!tryDraw(t, 1)) continue;
      sampling.c3_samples++;
      if (full) analyzeText(sink, t, texts);
    }
  } finally {
    unhook();
  }

  // ---- C6: first and last frame
  const frameAt = (t) => (tryDraw(t, 0.5) ? modalFraction(pixels(canvas)) : null);
  const first = frameAt(0);
  if (first !== null && first > BLANK_FRACTION && !allowBlankStart) {
    findings.push({ id: 'C6', severity: 'error', t: 0, message: `first frame is empty: ${(first * 100).toFixed(1)}% of pixels are one colour (set beat.allow_blank_start to permit)`, data: { fraction: first } });
  }
  const last = lastT > 0 ? frameAt(lastT) : null;
  if (last !== null && last > BLANK_FRACTION) {
    findings.push({ id: 'C6', severity: 'warn', t: lastT, message: `last frame is empty: ${(last * 100).toFixed(1)}% of pixels are one colour`, data: { fraction: last } });
  }

  // ---- C7: frozen spans
  if (full && c7Times.length > 1) {
    let prev = null, runStart = null, reported = false;
    for (let i = 0; i < c7Times.length; i++) {
      const t = c7Times[i];
      if (!tryDraw(t, 0.125)) { prev = null; runStart = null; continue; }
      sampling.c7_samples++;
      const cur = pixels(canvas);
      if (prev) {
        const unchanged = meanAbsDiff(prev, cur) < FROZEN_MAD;
        if (unchanged) {
          if (runStart === null) runStart = c7Times[i - 1];
          if (!reported && t - runStart >= FROZEN_SPAN_S - 1e-9) {
            reported = true;
            findings.push({ id: 'C7', severity: 'error', t: runStart, message: `frame is frozen from ${f2(runStart)}s for at least ${f2(t - runStart)}s (mean pixel change < ${FROZEN_MAD}); add idle motion`, data: { from: runStart, to: t } });
          }
        } else {
          runStart = null;
        }
      }
      prev = cur;
    }
  }

  // ---- C9: declared media must decode
  if (full) {
    for (const [id, st] of Object.entries(R.mediaStatus)) {
      if (!st.ok) findings.push({ id: 'C9', severity: 'error', t: null, message: `media '${id}' did not load or decode: ${st.error}`, data: { id } });
    }
  }

  if (draws.first) {
    const more = draws.count > 1 ? ` (${draws.count - 1} more failing draw(s))` : '';
    findings.push({ id: 'C3', severity: 'error', t: draws.first.t, message: `draw threw at t=${f2(draws.first.t)}s: ${draws.first.message}${more}`, data: { stack: draws.first.stack, count: draws.count } });
  }
  if (full) findings.push(...textFindings(texts));
  return { findings, sampling, stats: { draws: nDraws, ms: Math.round(performance.now() - t0) } };
}

function analyzeText(boxes, t, acc) {
  const edges = (b) => ({ left: -b.x0, right: b.x1 - W, top: -b.y0, bottom: b.y1 - H });
  for (const b of boxes) {
    for (const [edge, over] of Object.entries(edges(b))) {
      const key = b.text + '\u0000' + edge;
      if (over > EDGE_TOLERANCE) {
        const e = acc.over.get(key) || { text: b.text, edge, t, amount: 0, times: [] };
        e.amount = Math.max(e.amount, over); e.times.push(t); acc.over.set(key, e);
      } else if (-over < SAFE_MARGIN) {
        const e = acc.near.get(key) || { text: b.text, edge, t, margin: Infinity, times: [] };
        e.margin = Math.min(e.margin, -over); e.times.push(t); acc.near.set(key, e);
      }
    }
    const s = acc.size.get(b.text) || { text: b.text, t, max: 0 };
    s.max = Math.max(s.max, b.size); acc.size.set(b.text, s);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.text === b.text) continue;                       // riso offset duplicates
      const iw = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), ih = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (iw <= 0 || ih <= 0) continue;
      const smaller = Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
      if (smaller <= 0) continue;
      const ratio = (iw * ih) / smaller;
      if (ratio > OVERLAP_RATIO) {
        const key = [a.text, b.text].sort().join('\u0000');
        const e = acc.overlap.get(key) || { a: a.text, b: b.text, t, ratio: 0, times: [] };
        e.ratio = Math.max(e.ratio, ratio); e.times.push(t); acc.overlap.set(key, e);
      }
    }
  }
}

function textFindings(acc) {
  const out = [];
  const nice = { left: 'left', right: 'right', top: 'top', bottom: 'bottom' };
  for (const e of acc.over.values()) {
    out.push({ id: 'C4', severity: 'error', t: e.t, message: `text '${short(e.text)}' exceeds ${nice[e.edge]} edge by ${Math.round(e.amount)}px`, data: { edge: e.edge, px: Math.round(e.amount), times: e.times.slice(0, 8) } });
  }
  for (const [key, e] of acc.near) {
    if (acc.over.has(key)) continue;
    out.push({ id: 'C4', severity: 'warn', t: e.t, message: `text '${short(e.text)}' is ${Math.max(0, Math.round(e.margin))}px from the ${nice[e.edge]} edge (keep >= ${SAFE_MARGIN}px)`, data: { edge: e.edge, px: Math.round(e.margin), times: e.times.slice(0, 8) } });
  }
  for (const e of acc.size.values()) {
    if (e.max < MIN_FONT_PX) out.push({ id: 'C4', severity: 'warn', t: e.t, message: `text '${short(e.text)}' effective font size is ${e.max.toFixed(1)}px (< ${MIN_FONT_PX}px)`, data: { size: e.max } });
  }
  for (const e of acc.overlap.values()) {
    out.push({ id: 'C5', severity: 'error', t: e.t, message: `text '${short(e.a)}' overlaps text '${short(e.b)}' by ${Math.round(e.ratio * 100)}% of the smaller box`, data: { ratio: e.ratio, times: e.times.slice(0, 8) } });
  }
  return out;
}
