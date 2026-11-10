/**
 * scenes-a.js - P0 technical scenes (paper look, 1280x720, kind 'scene'). All take params.bg=false to draw as a transparent overlay.
 * Exports: none besides `assets`. Registered ids:
 *  tech/big-stat         params: value, prefix, suffix, decimals, label, note, kicker, accent; anchors: kicker, count, label, note
 *  tech/flow-diagram     params: nodes[3-6 strings], notes[], title, packets, highlight; anchors: title, nodes, arrows, packets
 *  tech/chart-draw       params: type 'bar'|'line'|'donut', data[], labels[], highlight, unit, title; anchors: title, chart, labels, highlight
 *  tech/checklist-reveal params: items[], marks['check'|'cross'], title; anchors: title, items
 *  tech/timeline-roadmap params: items['date|label'], current, title; anchors: title, line, stations
 *  tech/compare-split    params: leftTitle, rightTitle, leftValue, rightValue, leftItems[], rightItems[]; anchors: panels, values, items
 * Usage:
 *   import { assets } from './scenes-a.js';
 *   assets['tech/big-stat'].draw(g, t, { value: 87, suffix: '%', label: 'say yes' });
 *   assets['tech/chart-draw'].markers({ type: 'line' }); // [{id,t,kind}]
 */
import { W, H, INK, PAPER, TOMATO, MUSTARD, GREEN, PINK, SHADOW, AQUA, LEAF, CREAM, SERIF, SANS, MONO, cl, lerp, eo, eio, eb, A, rrect, txt, shade, defAsset, frame, finish, card, pill, kicker, headline, fit, idle, arrowHead, checkMark, crossMark, circ } from './kit.js';
import { halftoneDisc, poly, polyAt, strokePoly } from '../core/core.js';
import { station } from './seeds.js';

const ACC = [TOMATO, MUSTARD, GREEN, PINK, shade(TOMATO, .35), AQUA];
const hdr = (g, p, t, at, y = 168) => { kicker(g, p.kicker, 80, 78, eo(A(t, at.kicker ?? 0, .4))); if (p.title) headline(g, p.title, 80, y, { s: 56, k: eo(A(t, at.title ?? .15, .5)), st: 'italic' }) };
const KM = (p, at) => [{ id: 'kicker', t: (at.kicker ?? 0) + .1, kind: 'tick' }];

// ---------------- big-stat ----------------
const bigStat = defAsset({
  id: 'tech/big-stat', title: 'Big stat (counting number)', duration: 5,
  description: 'One giant misregistered number that counts up on a halftone disc with a label underneath. Use for a single headline statistic, price, percentage or count.',
  params: { kicker: ['string', 'BY THE NUMBERS', 'mono kicker'], value: ['number', 87, 'final value'], prefix: ['string', '', 'text before the number, e.g. $'], suffix: ['string', '%', 'text after the number'],
    decimals: ['number', 0, 'decimal places'], label: ['string', 'of buyers read reviews first', 'italic line under the number'], note: ['string', 'SOURCE: SURVEY 2026', 'small mono note at the bottom'],
    accent: ['color', TOMATO, 'number plate colour'], countDur: ['number', 1.4, 'seconds the count takes'] },
  anchors: { kicker: [0, 'kicker fades in'], disc: [.1, 'halftone disc grows'], count: [.5, 'number starts counting'], label: [1.9, 'label fades in'], note: [2.3, 'note fades in'] },
  markerKinds: ['tick', 'pop', 'thud'], tags: ['statistic', 'number', 'hero', 'percent', 'counter'],
  example: "assets['tech/big-stat'].draw(g, t, { value: 3.2, prefix: '$', suffix: 'M', decimals: 1, label: 'raised in week one' })"
}, (g, t, p, at) => {
  frame(g, p); kicker(g, p.kicker, 80, 78, eo(A(t, at.kicker, .4)));
  const fin = p.prefix + p.value.toFixed(p.decimals) + p.suffix; g.font = `700 100px ${SERIF}`; const w100 = g.measureText(fin).width;
  const sz = Math.min(340, 100 * 1040 / w100), cx = 640, by = 420, dk = eo(A(t, at.disc, .9));
  halftoneDisc(g, cx, 330, 255 + idle(t, .4, 4), 15, MUSTARD, dk);
  const done = A(t, at.count, p.countDur), v = p.value * eo(done), s = p.prefix + v.toFixed(p.decimals) + p.suffix;
  const pop = 1 + .05 * Math.exp(-6 * Math.max(0, t - at.count - p.countDur)) * Math.sin(Math.max(0, t - at.count - p.countDur) * 22), kk = eo(A(t, at.count - .1, .25));
  g.save(); g.translate(cx, by); g.scale(pop, pop); g.font = `700 ${sz}px ${SERIF}`; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.globalAlpha = kk;
  g.font = `700 ${sz}px ${SERIF}`; const fw = g.measureText(fin).width, x0 = -fw / 2;
  g.globalCompositeOperation = 'multiply'; g.fillStyle = p.accent; g.fillText(s, x0 + 8, 8); g.globalCompositeOperation = 'source-over';
  g.lineWidth = 5; g.lineJoin = 'round'; g.strokeStyle = INK; g.strokeText(s, x0, 0); g.restore();
  txt(g, p.label, cx, 506, { f: SERIF, s: 44, w: 700, st: 'italic', al: 'center', k: eo(A(t, at.label, .5)) });
  txt(g, p.note, cx, 610, { f: MONO, s: 17, w: 700, ls: 3, al: 'center', k: eo(A(t, at.note, .5)) });
  finish(g, p);
}, (p, at) => {
  const m = [...KM(p, at), { id: 'label', t: at.label + .1, kind: 'pop' }, { id: 'done', t: at.count + p.countDur, kind: 'thud' }];
  for (let i = 0; i < 6; i++) m.push({ id: 'count-' + i, t: at.count + p.countDur * (.12 + i * .15), kind: 'tick' }); return m;
});

// ---------------- flow-diagram ----------------
function flowLayout(n) {
  if (n <= 4) { const w = n <= 3 ? 220 : 200, pitch = n > 1 ? (1120 - w) / (n - 1) : 0; return { w, h: 170, pts: Array.from({ length: n }, (_, i) => [80 + w / 2 + i * pitch, 430]) } }
  const m = Math.ceil(n / 2), w = 210, pitch = (1120 - w) / (m - 1), xs = Array.from({ length: m }, (_, i) => 80 + w / 2 + i * pitch);
  return { w, h: 120, pts: Array.from({ length: n }, (_, i) => i < m ? [xs[i], 320] : [xs[m - 1 - (i - m)] ?? xs[0], 530]) };
}
const flow = defAsset({
  id: 'tech/flow-diagram', title: 'Flow diagram (3-6 nodes)', duration: 6,
  description: 'Boxes joined by arrows that draw in one after another, with little packets travelling along the path forever. Use for a pipeline, process, funnel of steps or data flow with 3 to 6 stages.',
  params: { kicker: ['string', 'HOW IT WORKS', 'mono kicker'], title: ['string', 'From idea to shipped', 'italic headline (empty string hides it)'],
    nodes: ['array', ['Idea', 'Build', 'Test', 'Ship'], '3 to 6 node labels'], notes: ['array', ['sketch it', 'code it', 'break it', 'release'], 'small mono sub-label per node'],
    packets: ['boolean', true, 'chips travel along the arrows'], highlight: ['number', -1, 'index of node to ring in tomato (-1 = last node)'], step: ['number', .35, 'seconds between nodes'] },
  anchors: { kicker: [0, 'kicker fades in'], title: [.15, 'headline fades in'], nodes: [.6, 'first node pops (others follow by step)'], arrows: [1.0, 'first arrow starts drawing (offset follows nodes)'], packets: [3.2, 'first packet leaves node 1'] },
  markerKinds: ['tick', 'pop', 'whoosh', 'slide'], tags: ['process', 'pipeline', 'steps', 'diagram', 'flow'],
  example: "assets['tech/flow-diagram'].draw(g, t, { nodes: ['Upload','Resize','Store'], notes: ['user','worker','bucket'] })"
}, (g, t, p, at) => {
  frame(g, p); hdr(g, p, t, at);
  const n = cl(p.nodes.length, 1, 6), L = flowLayout(n), P = L.pts, hl = p.highlight < 0 ? n - 1 : p.highlight;
  const edge = (a, b, w, h) => { const dx = b[0] - a[0], dy = b[1] - a[1], sx = Math.abs(dx) > 1e-6 ? (w / 2 + 14) / Math.abs(dx) : 1e9, sy = Math.abs(dy) > 1e-6 ? (h / 2 + 14) / Math.abs(dy) : 1e9, k = Math.min(sx, sy); return [[a[0] + dx * k, a[1] + dy * k], [b[0] - dx * k, b[1] - dy * k]] };
  const segs = [], path = [];
  for (let i = 0; i < n - 1; i++) { const [s, e] = edge(P[i], P[i + 1], L.w, L.h); segs.push([s, e]) }
  segs.forEach(([s, e], i) => {
    const k = eio(A(t, at.arrows + i * p.step, .5)); if (k <= 0) return; const pl = poly([s, e]), d = pl.T * k;
    strokePoly(g, pl, d, 8, INK); if (k >= .98) { const ang = Math.atan2(e[1] - s[1], e[0] - s[0]); arrowHead(g, e[0], e[1], ang, 15, INK) }
  });
  P.forEach((c, i) => {
    const k = eb(A(t, at.nodes + i * p.step, .45)); if (k <= 0) return; g.save(); g.translate(c[0], c[1] + idle(t, .5, 2 * eo(A(t, at.nodes + 1.2, .5)), i)); g.scale(k, k);
    card(g, -L.w / 2, -L.h / 2, L.w, L.h, { r: 18, fill: i === hl ? CREAM : CREAM });
    g.fillStyle = ACC[i % 4]; rrect(g, -L.w / 2 + 14, -L.h / 2 + 14, 40, 40, 20); g.fill(); g.strokeStyle = INK; g.lineWidth = 3.5; g.stroke();
    txt(g, String(i + 1), -L.w / 2 + 34, -L.h / 2 + 42, { f: MONO, s: 20, w: 700, al: 'center', c: i % 4 === 2 || i % 4 === 0 ? CREAM : INK });
    fit(g, p.nodes[i], 0, L.h > 150 ? 22 : 14, L.w - 40, { s: L.h > 150 ? 40 : 32, al: 'center', f: SERIF, st: i === n - 1 ? 'italic' : '', rise: 0 });
    if (p.notes[i]) fit(g, p.notes[i], 0, L.h > 150 ? 58 : 44, L.w - 30, { s: 18, al: 'center', f: MONO, c: 'rgba(34,30,26,.7)', rise: 0 });
    if (i === hl) { g.strokeStyle = TOMATO; g.lineWidth = 5; g.setLineDash([14, 10]); g.lineDashOffset = -t * 18 * eo(A(t, at.nodes + 1.5, .3)); rrect(g, -L.w / 2 - 12, -L.h / 2 - 12, L.w + 24, L.h + 24, 26); g.stroke(); g.setLineDash([]) }
    g.restore();
  });
  if (p.packets && n > 1 && t >= at.packets) {
    const per = 4.2, cnt = 3, labs = ['a3f9', '7be2', 'c01d'];
    for (let j = 0; j < cnt; j++) {
      const ph = ((t - at.packets) / per - j / cnt) % 1, f = ph < 0 ? ph + 1 : ph, sp = f * (n - 1), i = Math.min(n - 2, Math.floor(sp)), q = sp - i, [s0, e0] = segs[i];
      const x = lerp(s0[0], e0[0], eio(q)), y = lerp(s0[1], e0[1], eio(q)), fade = Math.min(1, q * 7, (1 - q) * 7);
      g.save(); g.globalAlpha = fade; g.translate(x, y - 22); g.fillStyle = SHADOW; rrect(g, -26 + 4, -15 + 4, 52, 30, 8); g.fill(); g.fillStyle = MUSTARD; rrect(g, -26, -15, 52, 30, 8); g.fill(); g.strokeStyle = INK; g.lineWidth = 3.5; g.stroke();
      txt(g, labs[j], 0, 5, { f: MONO, s: 14, w: 700, al: 'center', rise: 0 }); g.restore();
    }
  }
  finish(g, p);
}, (p, at) => {
  const n = cl(p.nodes.length, 1, 6), m = [...KM(p, at)];
  for (let i = 0; i < n; i++) m.push({ id: 'node-' + i, t: at.nodes + i * p.step + .12, kind: 'pop' });
  for (let i = 0; i < n - 1; i++) m.push({ id: 'arrow-' + i, t: at.arrows + i * p.step + .05, kind: 'whoosh' });
  if (p.packets) m.push({ id: 'packet', t: at.packets, kind: 'slide' }); return m;
});

// ---------------- chart-draw ----------------
const chart = defAsset({
  id: 'tech/chart-draw', title: 'Chart (bar, line or donut)', duration: 5,
  description: 'Animated bar, line or donut chart drawn on paper with value labels and one highlighted item. Use to show a trend, comparison or share of a whole from a small data set (2-8 values).',
  params: { kicker: ['string', 'THE TREND', 'mono kicker'], title: ['string', 'Signups keep climbing', 'italic headline'], type: ['string', 'bar', "'bar' | 'line' | 'donut'"],
    data: ['array', [34, 52, 47, 78, 91], 'numbers (for donut: shares, any scale)'], labels: ['array', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], 'one label per value'],
    highlight: ['number', -1, 'index to emphasise (-1 = the largest)'], unit: ['string', '', 'suffix on value labels e.g. % or k'], step: ['number', .18, 'seconds between items'] },
  anchors: { kicker: [0, 'kicker fades in'], title: [.15, 'headline fades in'], chart: [.7, 'first bar/segment/line starts'], labels: [1.6, 'value labels pop (offset by step)'], highlight: [2.8, 'highlight tag and emphasis'] },
  markerKinds: ['tick', 'pop', 'whoosh', 'slide'], tags: ['chart', 'data', 'graph', 'bar', 'line', 'donut', 'statistic'],
  example: "assets['tech/chart-draw'].draw(g, t, { type: 'donut', data: [62, 25, 13], labels: ['Mobile','Desktop','Other'], unit: '%' })"
}, (g, t, p, at) => {
  frame(g, p, 'b'); hdr(g, p, t, at); const d = p.data, n = d.length, mx = Math.max(...d, 1), hi = p.highlight >= 0 ? p.highlight : d.indexOf(Math.max(...d));
  const X0 = 140, X1 = 1140, Y0 = 600, Y1 = 250, hk = eb(A(t, at.highlight, .4));
  const tag = (g, x, y, s, col, k) => { if (k <= 0) return; pill(g, x, y, Math.max(62, s.length * 12 + 26), 34, col, s, { k, s: 17 }) };
  if (p.type === 'donut') {
    const tot = d.reduce((a, b) => a + b, 0) || 1, cx = 440, cy = 440, R = 170, r = 82; let a0 = -Math.PI / 2;
    d.forEach((v, i) => {
      const a1 = a0 + v / tot * 6.2832, k = eio(A(t, at.chart + i * p.step * 2, .7)), am = (a0 + a1) / 2, off = i === hi ? 8 + idle(t, .5, 3) * hk : 0;
      if (k > 0) { g.save(); g.translate(Math.cos(am) * off, Math.sin(am) * off); const e = a0 + (a1 - a0) * k;
        g.fillStyle = SHADOW; g.beginPath(); g.arc(cx + 5, cy + 5, R, a0, e); g.arc(cx + 5, cy + 5, r, e, a0, true); g.closePath(); g.fill();
        g.fillStyle = ACC[i % 6]; g.beginPath(); g.arc(cx, cy, R, a0, e); g.arc(cx, cy, r, e, a0, true); g.closePath(); g.fill(); g.strokeStyle = INK; g.lineWidth = 5; g.lineJoin = 'round'; g.stroke(); g.restore() }
      a0 = a1;
    });
    txt(g, Math.round(d[hi] / tot * 100) + '%', cx, cy + 22, { f: SERIF, s: 64, w: 700, al: 'center', k: eo(A(t, at.highlight, .4)), rise: 0 });
    d.forEach((v, i) => { const y = 290 + i * Math.min(62, 320 / n), k = eb(A(t, at.labels + i * p.step, .35)); if (k <= 0) return; g.save(); g.translate(800, y); g.scale(k, k);
      g.fillStyle = ACC[i % 6]; rrect(g, 0, -20, 36, 36, 8); g.fill(); g.strokeStyle = INK; g.lineWidth = 4; g.stroke();
      fit(g, p.labels[i] ?? '', 56, 6, 250, { s: 28, rise: 0, w: i === hi ? 700 : 500 }); txt(g, Math.round(v / tot * 100) + '%', 400, 6, { f: MONO, s: 24, w: 700, al: 'right', rise: 0 }); g.restore() });
  } else {
    const cw = (X1 - X0) / n, px = i => X0 + cw * (i + .5), py = v => Y0 - (Y0 - Y1) * v / mx;
    g.strokeStyle = INK; g.lineWidth = 5; g.lineCap = 'round'; g.beginPath(); g.moveTo(X0 - 20, Y0 + 2); g.lineTo(X1 + 20, Y0 + 2); g.stroke();
    g.strokeStyle = 'rgba(34,30,26,.18)'; g.lineWidth = 2; for (let k = 1; k <= 3; k++) { const y = Y0 - (Y0 - Y1) * k / 3; g.beginPath(); g.moveTo(X0 - 20, y); g.lineTo(X1 + 20, y); g.setLineDash([4, 10]); g.stroke(); g.setLineDash([]) }
    d.forEach((v, i) => txt(g, p.labels[i] ?? '', px(i), Y0 + 38, { f: MONO, s: 18, w: 700, al: 'center', k: eo(A(t, at.chart + i * p.step, .3)), rise: 0 }));
    if (p.type === 'line') {
      const pl = poly(d.map((v, i) => [px(i), py(v)])), prog = eio(A(t, at.chart, .6 + n * p.step)), dd = pl.T * prog;
      if (prog > 0) { g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = AQUA; g.beginPath(); g.moveTo(px(0), Y0); pl.pts.forEach((q, i) => { if (pl.L[i] <= dd) g.lineTo(q[0], q[1]) }); const e = polyAt(pl, dd); g.lineTo(e[0], e[1]); g.lineTo(e[0], Y0); g.closePath(); g.fill(); g.restore() }
      strokePoly(g, pl, dd + 0, 18, INK); strokePoly(g, pl, dd, 9, TOMATO);
      d.forEach((v, i) => { const k = eb((dd - pl.L[i] + 4) / 40); if (k > 0) { station(g, px(i), py(v), k * (i === hi ? 1.1 : .8), 'n') } const kl = eb(A(t, at.labels + i * p.step, .35)); if (i === hi) tag(g, px(i), py(v) - 44 + idle(t, .5, 3) * hk, d[i] + p.unit, TOMATO, kl); else if (kl > 0) txt(g, d[i] + p.unit, px(i), py(v) - 24, { f: MONO, s: 18, w: 700, al: 'center', k: cl(kl), rise: 0 }) });
    } else {
      d.forEach((v, i) => {
        const k = eb(A(t, at.chart + i * p.step, .55)), bw = Math.min(110, cw * .62), h = (Y0 - py(v)) * k; if (k <= 0) return; const col = i === hi ? TOMATO : MUSTARD;
        g.fillStyle = SHADOW; rrect(g, px(i) - bw / 2 + 5, Y0 - h + 5, bw, h, 8); g.fill(); g.fillStyle = col; rrect(g, px(i) - bw / 2, Y0 - h, bw, h, 8); g.fill(); g.strokeStyle = INK; g.lineWidth = 5; g.stroke();
        const kl = eb(A(t, at.labels + i * p.step, .35)); if (i === hi) tag(g, px(i), Y0 - h - 34 + idle(t, .5, 3) * hk, v + p.unit, TOMATO, kl); else txt(g, v + p.unit, px(i), Y0 - h - 14, { f: MONO, s: 20, w: 700, al: 'center', k: cl(kl), rise: 0 });
      });
    }
  }
  finish(g, p);
}, (p, at) => {
  const n = p.data.length, m = [...KM(p, at)];
  for (let i = 0; i < n; i++) { m.push({ id: 'item-' + i, t: at.chart + i * p.step * (p.type === 'donut' ? 2 : 1) + (p.type === 'line' ? .2 : .25), kind: p.type === 'line' ? 'tick' : 'pop' }) }
  m.push({ id: 'highlight', t: at.highlight + .1, kind: 'pop' }); return m;
});

// ---------------- checklist-reveal ----------------
const checklist = defAsset({
  id: 'tech/checklist-reveal', title: 'Checklist reveal', duration: 5,
  description: 'Rows of ruled paper whose checkboxes get ticked (or crossed) one by one, with a running n/N counter. Use for requirements, benefits, a to-do or a pass/fail list of up to 7 items.',
  params: { kicker: ['string', 'THE CHECKLIST', 'mono kicker'], title: ['string', 'Before you launch', 'italic headline'], items: ['array', ['Page loads under 2 s', 'Mobile layout works', 'Checkout tested', 'Analytics installed'], '2 to 7 short lines'],
    marks: ['array', [], "per item 'check' or 'cross' (missing = check)"], step: ['number', .55, 'seconds between rows'] },
  anchors: { kicker: [0, 'kicker fades in'], title: [.15, 'headline fades in'], items: [.7, 'first row slides in'], ticks: [1.1, 'first tick lands (offset follows step)'] },
  markerKinds: ['tick', 'slide', 'chime', 'pop'], tags: ['list', 'checklist', 'requirements', 'benefits', 'todo'],
  example: "assets['tech/checklist-reveal'].draw(g, t, { items: ['Fast','Safe','Cheap'], marks: ['check','check','cross'] })"
}, (g, t, p, at) => {
  frame(g, p, 'c'); hdr(g, p, t, at); const n = cl(p.items.length, 1, 7), rowH = n > 5 ? 66 : 78, y0 = 220; let done = 0;
  for (let i = 0; i < n; i++) {
    const k = eo(A(t, at.items + i * p.step, .45)), y = y0 + i * rowH, tk = A(t, at.ticks + i * p.step, .35), mk = p.marks[i] || 'check'; if (tk > 0) done++;
    if (k <= 0) continue; g.save(); g.globalAlpha = k; g.translate(-(1 - k) * 60, 0);
    g.strokeStyle = 'rgba(34,30,26,.25)'; g.lineWidth = 2; g.beginPath(); g.moveTo(80, y + rowH - 12); g.lineTo(840, y + rowH - 12); g.stroke();
    g.fillStyle = SHADOW; rrect(g, 84, y + 8 + 4, 44, 44, 11); g.fill(); g.fillStyle = CREAM; rrect(g, 80, y + 8, 44, 44, 11); g.fill(); g.strokeStyle = INK; g.lineWidth = 4; g.stroke();
    if (tk > 0) { if (mk === 'cross') crossMark(g, 102, y + 30, 1.6 * eb(tk), TOMATO); else { const br = 1 + .06 * idle(t, .4, 1, i); checkMark(g, 102, y + 31, 1.7 * br, GREEN, eo(tk)) } }
    fit(g, p.items[i], 148, y + 44, 700, { s: 34, w: 600, f: SANS, c: mk === 'cross' && tk > .5 ? 'rgba(34,30,26,.55)' : INK, rise: 0 });
    if (mk === 'cross' && tk > .5) { g.strokeStyle = TOMATO; g.lineWidth = 4; g.beginPath(); g.moveTo(144, y + 33); g.lineTo(144 + 700 * Math.min(1, eo((tk - .5) * 2)) * .5, y + 33); g.stroke() }
    g.restore();
  }
  halftoneDisc(g, 1020, 420, 170 + idle(t, .4, 3), 14, MUSTARD, eo(A(t, at.items, .8)));
  g.save(); g.textAlign = 'center'; g.font = `700 150px ${SERIF}`; g.globalCompositeOperation = 'multiply'; g.fillStyle = TOMATO; g.fillText(done + '/' + n, 1028, 472); g.globalCompositeOperation = 'source-over'; g.strokeStyle = INK; g.lineWidth = 4; g.lineJoin = 'round'; g.strokeText(done + '/' + n, 1020, 464); g.restore();
  finish(g, p);
}, (p, at) => { const n = cl(p.items.length, 1, 7), m = [...KM(p, at)]; for (let i = 0; i < n; i++) { m.push({ id: 'row-' + i, t: at.items + i * p.step + .05, kind: 'slide' }); m.push({ id: 'tick-' + i, t: at.ticks + i * p.step + .15, kind: (p.marks[i] === 'cross') ? 'pop' : 'chime' }) } return m });

// ---------------- timeline-roadmap ----------------
const timeline = defAsset({
  id: 'tech/timeline-roadmap', title: 'Timeline / roadmap', duration: 6,
  description: 'Horizontal route line with date and label per milestone, a green progress segment and a bobbing NOW tag on the current stop. Use for a roadmap, project phases, history or step-by-step plan with 3-6 milestones.',
  params: { kicker: ['string', 'ROADMAP', 'mono kicker'], title: ['string', 'Where we are headed', 'italic headline'], items: ['array', ['Q1|Research', 'Q2|Prototype', 'Q3|Beta', 'Q4|Launch'], "3 to 6 strings 'date|label'"],
    current: ['number', 1, 'index of the milestone that is "now" (progress stops there)'], now: ['string', 'NOW', 'tag text'], step: ['number', .4, 'seconds between stations'] },
  anchors: { kicker: [0, 'kicker fades in'], title: [.15, 'headline fades in'], line: [.5, 'route line starts drawing'], stations: [.8, 'first station pops'], now: [2.6, 'NOW tag drops in'] },
  markerKinds: ['tick', 'whoosh', 'pop', 'stamp'], tags: ['timeline', 'roadmap', 'phases', 'schedule', 'history'],
  example: "assets['tech/timeline-roadmap'].draw(g, t, { items: ['2019|Founded','2022|Series A','2025|Global'], current: 2 })"
}, (g, t, p, at) => {
  frame(g, p, 'a'); hdr(g, p, t, at); const n = cl(p.items.length, 2, 6), xs = Array.from({ length: n }, (_, i) => 150 + i * (980 / (n - 1))), Y = 420, cur = cl(p.current, 0, n - 1);
  const pl = poly([[110, Y], [1170, Y]]), dd = eio(A(t, at.line, 1.4)) * pl.T; strokePoly(g, pl, dd, 18, INK);
  const pg = poly([[110, Y], [xs[cur], Y]]); strokePoly(g, pg, Math.min(dd, pg.T) * eio(A(t, at.line + .9, 1)) , 8, GREEN);
  xs.forEach((x, i) => {
    const [dt, lb] = (p.items[i] || '|').split('|'), k = eb(A(t, at.stations + i * p.step, .4)); if (k <= 0) return; const up = i % 2 === 0;
    station(g, x, Y, k, i === n - 1 ? 'big' : i <= cur ? 'ic' : 'n');
    g.save(); g.strokeStyle = 'rgba(34,30,26,.45)'; g.lineWidth = 3; g.setLineDash([2, 7]); g.lineCap = 'round'; g.beginPath(); g.moveTo(x, Y + (up ? -34 : 34)); g.lineTo(x, Y + (up ? -76 : 76) * k); g.stroke(); g.restore();
    const ky = up ? Y - 100 : Y + 120; txt(g, dt, x, ky, { f: MONO, s: 20, w: 700, ls: 2, al: 'center', k: cl(k), c: i <= cur ? GREEN : INK, rise: 0 });
    fit(g, lb, x, ky + 40, Math.min(220, 980 / (n - 1) - 20), { s: 30, f: SERIF, st: 'italic', al: 'center', k: cl(k), rise: 0 });
  });
  const nk = eb(A(t, at.now, .45)); if (nk > 0) { g.save(); g.translate(xs[cur], Y - 175 + (1 - nk) * -60 + idle(t, .6, 5)); pill(g, 0, 0, 90, 38, MUSTARD, p.now, { s: 18 }); g.fillStyle = INK; g.beginPath(); g.moveTo(-9, 22); g.lineTo(9, 22); g.lineTo(0, 36); g.closePath(); g.fill(); g.restore() }
  finish(g, p);
}, (p, at) => { const n = cl(p.items.length, 2, 6), m = [...KM(p, at), { id: 'line', t: at.line + .1, kind: 'whoosh' }, { id: 'now', t: at.now + .2, kind: 'stamp' }]; for (let i = 0; i < n; i++) m.push({ id: 'station-' + i, t: at.stations + i * p.step + .1, kind: 'pop' }); return m });

// ---------------- compare-split ----------------
const split = defAsset({
  id: 'tech/compare-split', title: 'Compare split (before/after, A vs B)', duration: 5,
  description: 'Two paper panels side by side with a VS badge, a big value on each side and a few cross/check lines. Use for before and after, old versus new, option A versus B.',
  params: { kicker: ['string', 'THE DIFFERENCE', 'mono kicker'], leftTitle: ['string', 'BEFORE', 'left panel heading'], rightTitle: ['string', 'AFTER', 'right panel heading'], leftValue: ['string', '8.2 s', 'big left value'], rightValue: ['string', '1.1 s', 'big right value'],
    leftItems: ['array', ['Huge images', 'No caching', 'Blocking scripts'], 'up to 3 short lines, shown with crosses'], rightItems: ['array', ['Compressed', 'CDN cache', 'Deferred scripts'], 'up to 3 short lines, shown with checks'], badge: ['string', 'VS', 'centre badge text'] },
  anchors: { kicker: [0, 'kicker fades in'], panels: [.3, 'panels slide in'], values: [1.0, 'values pop'], items: [1.7, 'first line appears (0.3 s apart, left then right)'], badge: [.8, 'badge pops'] },
  markerKinds: ['tick', 'slide', 'pop', 'thud'], tags: ['compare', 'before-after', 'versus', 'split', 'ab-test'],
  example: "assets['tech/compare-split'].draw(g, t, { leftTitle: 'Plan A', rightTitle: 'Plan B', leftValue: '$40', rightValue: '$12' })"
}, (g, t, p, at) => {
  frame(g, p, 'none'); kicker(g, p.kicker, 80, 78, eo(A(t, at.kicker, .4)));
  [[0, 60, p.leftTitle, p.leftValue, p.leftItems, SHADOW, TOMATO, 'cross'], [1, 680, p.rightTitle, p.rightValue, p.rightItems, CREAM, GREEN, 'check']].forEach(([s, x, ttl, val, items, fill, col, mk]) => {
    const k = eo(A(t, at.panels + s * .15, .6)), y = 130 + (1 - k) * 70, cx = x + 270; if (k <= 0) return; g.save(); g.globalAlpha = k;
    g.translate(0, idle(t, .4, 2, s * 2)); card(g, x, y, 540, 540, { r: 22, fill, lw: 5, sh: 8 });
    txt(g, ttl, cx, y + 62, { f: MONO, s: 22, w: 700, ls: 6, al: 'center', c: col === GREEN ? GREEN : 'rgba(34,30,26,.7)', rise: 0 });
    const vk = eb(A(t, at.values + s * .2, .5)); if (vk > 0) { g.save(); g.translate(cx, y + 220); g.scale(vk, vk); let sz = 140; g.font = `700 ${sz}px ${SERIF}`; const w = g.measureText(val).width; if (w > 480) { sz = Math.floor(sz * 480 / w) } g.font = `700 ${sz}px ${SERIF}`; g.textAlign = 'center';
      g.globalCompositeOperation = 'multiply'; g.fillStyle = col; g.fillText(val, 7, 7); g.globalCompositeOperation = 'source-over'; g.lineWidth = 5; g.lineJoin = 'round'; g.strokeStyle = INK; g.strokeText(val, 0, 0); g.restore() }
    items.slice(0, 3).forEach((it, i) => { const ik = eo(A(t, at.items + i * .6 + s * .3, .4)); if (ik <= 0) return; g.save(); g.globalAlpha = ik; g.translate((s ? 1 : -1) * (1 - ik) * 40, 0);
      const yy = y + 322 + i * 64; g.fillStyle = col === GREEN ? shade(GREEN, .82) : CREAM; rrect(g, x + 40, yy, 460, 50, 25); g.fill(); g.strokeStyle = INK; g.lineWidth = 3.5; g.stroke();
      g.fillStyle = col; g.beginPath(); g.arc(x + 70, yy + 25, 17, 0, 7); g.fill(); g.stroke(); if (mk === 'check') checkMark(g, x + 70, yy + 26, 1.05, CREAM, 1); else crossMark(g, x + 70, yy + 25, 1.05, CREAM);
      fit(g, it, x + 104, yy + 34, 380, { s: 24, w: 600, rise: 0 }); g.restore() });
    g.restore();
  });
  const bk = eb(A(t, at.badge, .45)); if (bk > 0) { g.save(); g.translate(640, 400); g.rotate(-.12 + idle(t, .5, .05)); g.scale(bk, bk); g.fillStyle = SHADOW; g.beginPath(); g.arc(5, 5, 50, 0, 7); g.fill(); g.fillStyle = MUSTARD; g.strokeStyle = INK; g.lineWidth = 5; g.beginPath(); g.arc(0, 0, 50, 0, 7); g.fill(); g.stroke(); txt(g, p.badge, 0, 12, { f: SERIF, s: 36, w: 700, st: 'italic', al: 'center', rise: 0 }); g.restore() }
  finish(g, p);
}, (p, at) => { const m = [...KM(p, at), { id: 'panel-l', t: at.panels + .2, kind: 'slide' }, { id: 'panel-r', t: at.panels + .35, kind: 'slide' }, { id: 'badge', t: at.badge + .15, kind: 'pop' }, { id: 'value-l', t: at.values + .2, kind: 'thud' }, { id: 'value-r', t: at.values + .4, kind: 'thud' }];
  for (let i = 0; i < 3; i++) { if (p.leftItems[i]) m.push({ id: 'l-' + i, t: at.items + i * .6 + .1, kind: 'tick' }); if (p.rightItems[i]) m.push({ id: 'r-' + i, t: at.items + i * .6 + .4, kind: 'tick' }) } return m });

export const assets = { 'tech/big-stat': bigStat, 'tech/flow-diagram': flow, 'tech/chart-draw': chart, 'tech/checklist-reveal': checklist, 'tech/timeline-roadmap': timeline, 'tech/compare-split': split };
