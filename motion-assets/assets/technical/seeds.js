/**
 * seeds.js - P0 seeds ported from v2.html: tech/metro-map, tech/isotype-crowd and their helper parts
 * (tech/station, tech/badge, tech/chip, tech/pawn, tech/stopwatch). Defaults reproduce v2.html pixel-for-pixel.
 * Exports: station(g,x,y,k,kind) kind 'n'|'ic'|'big', k = scale 0..1; badge(g,x,y,w,label,col,k); chip(g,x,y,label,rot);
 *   pawn(g,x,y,s,rot,on); stopwatch(g,x,y,t); METRO_LINES path objects.
 * tech/metro-map params (deco:'none' removes the ground inks): kicker, words[3], lineLabels[3], lineW[3], stations[5], commits[2], flag, footer, titleStep. Anchors: kicker, title, highlight,
 *   mainLine, featureLine, hotfixLine, commitA, commitB, flag, footer.
 * tech/isotype-crowd params: kicker, headline, left (0-100 pawns turning red), subtitle, caption, watch. Anchors: kicker, headline, disc, pawns, subtitle, caption.
 * Usage:
 *   import { assets } from './seeds.js';
 *   assets['tech/metro-map'].draw(g, t, { words: ['Plan.', 'Ship.', 'Learn.'] });
 *   assets['tech/isotype-crowd'].draw(g, t, { left: 40, at: { pawns: 1 } });
 */
import { W, H, INK, TOMATO, MUSTARD, GREEN, PINK, SHADOW, AQUA, LEAF, CREAM, SERIF, MONO, PAPER } from '../core/palette.js';
import { cl, lerp, eo, eio, eb, A, rrect, txt, halftoneDisc, poly, polyAt, strokePoly, grainOver } from '../core/core.js';
import { defAsset } from './kit.js';

export function station(g, x, y, k, kind) {
  if (k <= 0) return; g.save(); g.translate(x, y); g.scale(k, k);
  const r = kind === 'big' ? 21 : kind === 'ic' ? 15 : 12;
  g.fillStyle = SHADOW; g.beginPath(); g.arc(4, 4, r, 0, 7); g.fill();
  g.fillStyle = CREAM; g.strokeStyle = INK; g.lineWidth = 5; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill(); g.stroke();
  if (kind !== 'n') { g.lineWidth = 3.5; g.beginPath(); g.arc(0, 0, r - 8, 0, 7); g.stroke() }
  g.restore();
}
export function badge(g, x, y, w, label, col, k) {
  if (k <= 0) return; g.save(); g.translate(x, y); g.scale(k, k);
  g.fillStyle = SHADOW; rrect(g, -w / 2 + 3, -14 + 3, w, 28, 14); g.fill();
  g.fillStyle = col; rrect(g, -w / 2, -14, w, 28, 14); g.fill(); g.strokeStyle = INK; g.lineWidth = 3.5; g.stroke();
  g.font = `700 14px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = CREAM; g.fillText(label, 0, 1); g.restore();
}
export function chip(g, x, y, label, rot) {
  g.save(); g.translate(x, y); g.rotate(rot);
  g.fillStyle = SHADOW; rrect(g, -29 + 5, -17 + 5, 58, 34, 9); g.fill();
  g.fillStyle = MUSTARD; rrect(g, -29, -17, 58, 34, 9); g.fill(); g.strokeStyle = INK; g.lineWidth = 4; g.stroke();
  g.font = `700 15px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = INK; g.fillText(label, 0, 1); g.restore();
}
export function pawn(g, x, y, s, rot, on) {
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(s, s);
  if (on) { g.fillStyle = SHADOW; rrect(g, -10, -23, 26, 28, 12); g.fill(); g.beginPath(); g.arc(3, -31, 9.5, 0, 7); g.fill() }
  g.fillStyle = on ? TOMATO : CREAM; g.strokeStyle = on ? INK : 'rgba(34,30,26,.5)'; g.lineWidth = 3;
  rrect(g, -13, -26, 26, 28, 12); g.fill(); g.stroke(); g.beginPath(); g.arc(0, -34, 9.5, 0, 7); g.fill(); g.stroke(); g.restore();
}
export function stopwatch(g, x, y, t) {
  g.save(); g.translate(x, y); g.rotate(-.18);
  g.fillStyle = SHADOW; g.beginPath(); g.arc(5, 5, 44, 0, 7); g.fill();
  g.fillStyle = INK; rrect(g, -8, -64, 16, 14, 3); g.fill(); g.save(); g.rotate(.8); rrect(g, -6, -62, 12, 10, 3); g.fill(); g.restore();
  g.fillStyle = CREAM; g.strokeStyle = INK; g.lineWidth = 6; g.beginPath(); g.arc(0, 0, 44, 0, 7); g.fill(); g.stroke();
  g.lineWidth = 3; g.lineCap = 'round'; for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283; g.beginPath(); g.moveTo(Math.cos(a) * 32, Math.sin(a) * 32); g.lineTo(Math.cos(a) * 38, Math.sin(a) * 38); g.stroke() }
  const a = -Math.PI / 2 + (t / 3) * 6.283;
  g.fillStyle = TOMATO; g.globalAlpha = .85; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 30, -Math.PI / 2, a); g.closePath(); g.fill(); g.globalAlpha = 1;
  g.strokeStyle = INK; g.lineWidth = 5; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 30, Math.sin(a) * 30); g.stroke();
  g.fillStyle = INK; g.beginPath(); g.arc(0, 0, 5, 0, 7); g.fill(); g.restore();
}

// ---------------- metro map ----------------
const MAIN = poly([[100, 430], [1150, 430]]), FEAT = poly([[300, 430], [400, 330], [760, 330], [860, 430]]), HOT = poly([[520, 430], [620, 530], [900, 530], [1000, 430]]);
const P1 = poly([[100, 430], [300, 430], [400, 330], [760, 330], [860, 430], [1150, 430]]), P2 = poly([[100, 430], [520, 430], [620, 530], [900, 530], [1000, 430], [1150, 430]]);
export const METRO_LINES = { MAIN, FEAT, HOT, P1, P2 };
const metro = defAsset({
  id: 'tech/metro-map', title: 'Metro map (branch and merge)', duration: 5,
  description: 'Transit-map explainer with three coloured lines that draw themselves, labelled stations, commit chips riding the lines and a release flag. Use for workflows, version control, pipelines or any "paths that diverge and merge" idea.',
  params: {
    kicker: ['string', 'ROUTE MAP  No. 42', 'small mono kicker above the title'],
    words: ['array', ['Branch.', 'Build.', 'Merge.'], 'three headline words; the third is italic with a mustard highlight'],
    lineLabels: ['array', ['main', 'feature/login', 'hotfix'], 'badge text on the main / feature / hotfix line'],
    lineW: ['array', [74, 134, 90], 'badge widths in px, to fit the labels'],
    stations: ['array', ['init', 'login form', 'tests pass', 'fix crash', 'production'], 'labels: start, two on the feature line, one on hotfix, end'],
    commits: ['array', ['a3f9', '7be2'], 'text of the two chips that ride the lines'],
    flag: ['string', 'v2.0', 'text on the release flag'],
    footer: ['string', 'ALL ROADS LEAD TO MAIN.', 'small mono footer line'],
    titleStep: ['number', .3, 'seconds between the three title words']
  },
  anchors: { kicker: [0, 'kicker fades in'], title: [.15, 'first title word (others follow by titleStep)'], highlight: [1.25, 'mustard highlighter swipe on word 3'], mainLine: [.3, 'main line starts drawing'], featureLine: [1.1, 'feature line starts'], hotfixLine: [1.5, 'hotfix line starts'], commitA: [2.1, 'first chip departs'], commitB: [2.3, 'second chip departs'], flag: [2.7, 'flag pops at terminus'], footer: [2.4, 'footer fades in'] },
  markerKinds: ['pop', 'whoosh', 'slide', 'stamp', 'tick'], tags: ['workflow', 'git', 'map', 'process', 'seed'],
  example: "assets['tech/metro-map'].draw(g, t, { words: ['Plan.', 'Ship.', 'Learn.'], flag: 'v1' })"
}, (g, T, p, at) => {
  const a = (d, dur) => eo((T - d) / dur);
  if (p.bg !== false) { g.fillStyle = PAPER; g.fillRect(0, 0, W, H) }
  if (p.bg !== false && p.deco !== 'none') {
    g.save(); g.globalCompositeOperation = 'multiply';
    g.strokeStyle = AQUA; g.lineWidth = 74; g.lineCap = 'round'; g.beginPath(); g.moveTo(-40, 650); g.bezierCurveTo(300, 600, 520, 708, 800, 650); g.bezierCurveTo(980, 612, 1120, 650, 1330, 596); g.stroke();
    g.fillStyle = LEAF; g.beginPath(); g.moveTo(930, 170); g.bezierCurveTo(1010, 130, 1150, 150, 1200, 210); g.bezierCurveTo(1240, 270, 1170, 312, 1080, 302); g.bezierCurveTo(980, 292, 880, 230, 930, 170); g.fill();
    g.fillStyle = 'rgba(242,163,181,.55)'; rrect(g, 1040, 64, 120, 64, 10); g.fill(); rrect(g, 1210, 330, 60, 110, 10); g.fill(); rrect(g, 60, 520, 120, 70, 10); g.fill();
    g.restore();
  }
  const kk = a(at.kicker, .4); g.save(); g.globalAlpha = kk; g.fillStyle = TOMATO; g.fillRect(80, 64, 16, 16); g.restore();
  txt(g, p.kicker, 108, 78, { f: MONO, s: 17, w: 700, ls: 4, k: kk });
  const words = p.words, styles = ['', '', 'italic']; let x = 80; const xs = [], ws = [];
  words.forEach((w, i) => { g.font = `${styles[i]} 700 72px ${SERIF}`; const m = g.measureText(w).width; xs.push(x); ws.push(m); x += m + 26 });
  const hk = a(at.highlight, .6); if (hk > 0) { g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = MUSTARD; g.translate(xs[2] - 10, 92); g.rotate(-.012); g.fillRect(0, 0, (ws[2] + 20) * hk, 66); g.restore() }
  words.forEach((w, i) => {
    const k = a(at.title + i * p.titleStep, .45);
    txt(g, w, xs[i] + 4, 156 + 4, { f: SERIF, s: 72, w: 700, st: styles[i], c: PINK, mul: 1, k });
    txt(g, w, xs[i], 156, { f: SERIF, s: 72, w: 700, st: styles[i], k })
  });
  const dM = eio((T - at.mainLine) / 1.3) * MAIN.T, dF = eio((T - at.featureLine) / 1.0) * FEAT.T, dH = eio((T - at.hotfixLine) / 1.0) * HOT.T;
  strokePoly(g, FEAT, dF, 16, TOMATO); strokePoly(g, HOT, dH, 16, GREEN); strokePoly(g, MAIN, dM, 16, INK);
  badge(g, 200, 430, p.lineW[0], p.lineLabels[0], INK, eb((dM - 130) / 60));
  badge(g, 450, 330, p.lineW[1], p.lineLabels[1], TOMATO, eb((dF - 190) / 60));
  badge(g, 680, 530, p.lineW[2], p.lineLabels[2], GREEN, eb((dH - 200) / 60));
  const cur = { M: dM, F: dF, H: dH }, S = p.stations;
  const ST = [
    { x: 100, y: 430, l: 'M', d: 0, k: 'n', label: S[0], ly: 474 },
    { x: 300, y: 430, l: 'M', d: 200, k: 'ic' }, { x: 520, y: 430, l: 'M', d: 420, k: 'ic' },
    { x: 860, y: 430, l: 'M', d: 760, k: 'ic' }, { x: 1000, y: 430, l: 'M', d: 900, k: 'ic' },
    { x: 1150, y: 430, l: 'M', d: 985, k: 'big', label: S[4], ly: 480 },
    { x: 560, y: 330, l: 'F', d: 301, k: 'n', label: S[1], ly: 374 }, { x: 700, y: 330, l: 'F', d: 441, k: 'n', label: S[2], ly: 374 },
    { x: 800, y: 530, l: 'H', d: 321, k: 'n', label: S[3], ly: 574 }];
  ST.forEach(s => {
    const k = eb((cur[s.l] - s.d + 6) / 60); station(g, s.x, s.y, k, s.k);
    if (s.label) txt(g, s.label, s.x, s.ly, { f: MONO, s: s.k === 'big' ? 19 : 18, w: 700, al: 'center', k: cl(k) })
  });
  [[P1, at.commitA, p.commits[0]], [P2, at.commitB, p.commits[1]]].forEach(([P, t0, lab]) => {
    if (T < t0) return; const d = eio((T - t0) / 2.7) * P.T, fade = 1 - cl((T - (t0 + 2.55)) / .35); if (fade <= 0) return;
    g.save(); g.globalAlpha = fade;
    for (let j = 1; j <= 4; j++) { const q = d - j * 26; if (q < 0) continue; const pt = polyAt(P, q); g.fillStyle = INK; g.globalAlpha = fade * (.55 - j * .1); g.beginPath(); g.arc(pt[0], pt[1], 6 - j, 0, 7); g.fill() }
    g.globalAlpha = fade; const pt = polyAt(P, d), p2 = polyAt(P, d + 6), rot = Math.atan2(p2[1] - pt[1], p2[0] - pt[0]) * .3;
    chip(g, pt[0], pt[1] - 3 + Math.sin(T * 14) * 1.2, lab, rot); g.restore()
  });
  const fk = eb((T - at.flag) / .5); if (fk > 0) {
    g.save(); g.translate(1150, 430); g.scale(fk, fk);
    g.strokeStyle = INK; g.lineWidth = 5; g.lineCap = 'round'; g.beginPath(); g.moveTo(0, -20); g.lineTo(0, -112); g.stroke();
    const w1 = Math.sin(T * 5) * 4, w2 = Math.sin(T * 5 + 1.2) * 3;
    g.fillStyle = SHADOW; g.beginPath(); g.moveTo(4, -108); g.lineTo(78, -108 + w1 + 4); g.lineTo(64, -86 + w1 + 4); g.lineTo(78, -64 + w2 + 4); g.lineTo(4, -64); g.closePath(); g.fill();
    g.fillStyle = MUSTARD; g.beginPath(); g.moveTo(0, -112); g.lineTo(74, -112 + w1); g.lineTo(60, -90 + w1); g.lineTo(74, -68 + w2); g.lineTo(0, -68); g.closePath(); g.fill(); g.strokeStyle = INK; g.lineWidth = 4; g.lineJoin = 'round'; g.stroke();
    g.font = `700 16px ${MONO}`; g.fillStyle = INK; g.textAlign = 'left'; g.fillText(p.flag, 8, -84); g.restore()
  }
  txt(g, p.footer, 80, 690, { f: MONO, s: 16, w: 700, ls: 3, c: 'rgba(34,30,26,.75)', k: a(at.footer, .5) });
  if (p.bg !== false) grainOver(g, .5);
}, (p, at) => {
  const m = [{ id: 'kicker', t: at.kicker + .1, kind: 'tick' }, { id: 'main-line', t: at.mainLine + .1, kind: 'whoosh' }, { id: 'feature-line', t: at.featureLine + .1, kind: 'whoosh' },
    { id: 'hotfix-line', t: at.hotfixLine + .1, kind: 'whoosh' }, { id: 'highlight', t: at.highlight + .1, kind: 'slide' }, { id: 'commit-a', t: at.commitA, kind: 'whoosh' },
    { id: 'commit-b', t: at.commitB, kind: 'whoosh' }, { id: 'flag', t: at.flag + .15, kind: 'stamp' }];
  p.words.forEach((w, i) => m.push({ id: 'word-' + i, t: at.title + i * p.titleStep + .15, kind: 'pop' }));
  return m;
});

// ---------------- isotype crowd ----------------
const crowd = defAsset({
  id: 'tech/isotype-crowd', noDeco: true, title: 'Isotype crowd (100 people, N turn red)', duration: 5,
  description: 'Ten-by-ten grid of pawn icons where N of 100 flip red one by one while a giant misregistered number counts up on a halftone disc, with a stopwatch. Use for "X out of 100" statistics and drop-off rates.',
  params: {
    kicker: ['string', 'THE COST OF WAITING', 'mono kicker'], headline: ['string', 'Out of every 100 visitors…', 'italic serif line under the kicker'],
    left: ['number', 53, 'how many of the 100 pawns turn red (0-100); also the big number'], subtitle: ['string', 'never see the page.', 'italic line under the number'],
    caption: ['string', 'WHEN LOAD TIME HITS 3 SECONDS', 'mono caption'], watch: ['boolean', true, 'show the stopwatch top right'],
    pawnStep: ['number', .032, 'seconds between consecutive pawns flipping']
  },
  anchors: { kicker: [0, 'kicker fades in'], headline: [.15, 'headline fades in'], disc: [.1, 'halftone disc grows'], pawns: [.4, 'first pawn starts flipping'], subtitle: [1.3, 'subtitle fades in'], caption: [1.5, 'caption fades in'] },
  markerKinds: ['tick', 'pop'], tags: ['statistic', 'crowd', 'percent', 'isotype', 'seed'],
  example: "assets['tech/isotype-crowd'].draw(g, t, { left: 27, subtitle: 'bounce.' })"
}, (g, T, p, at) => {
  const a = (d, dur) => eo((T - d) / dur);
  if (p.bg !== false) { g.fillStyle = PAPER; g.fillRect(0, 0, W, H) }
  const kk = a(at.kicker, .4); g.save(); g.globalAlpha = kk; g.fillStyle = TOMATO; g.fillRect(100, 56, 16, 16); g.restore();
  txt(g, p.kicker, 128, 70, { f: MONO, s: 17, w: 700, ls: 4, k: kk });
  txt(g, p.headline, 100, 118, { f: SERIF, s: 40, w: 700, st: 'italic', k: a(at.headline, .5) });
  halftoneDisc(g, 880, 350, 215, 15, MUSTARD, a(at.disc, .9));
  let n = 0; const L = cl(Math.round(p.left), 0, 100);
  for (let i = 0; i < 100; i++) {
    const c = i % 10, r = (i / 10) | 0, cx = 100 + c * 54 + 27, cy = 196 + r * 49 + 30;
    const left = i < L, q = left ? (T - (at.pawns + i * p.pawnStep)) / .45 : -1;
    const on = left && q >= .2; if (on) n++;
    const hop = left && q > 0 && q < 1 ? Math.sin(Math.PI * q) * 20 : 0;
    const rot = left && q > 0 && q < 1 ? Math.sin(q * 6.283) * .28 : (on ? .07 : 0);
    const sc = .82 * (hop > 0 ? 1 + .14 * Math.sin(Math.PI * q) : 1);
    pawn(g, cx, cy - hop, sc, rot, on)
  }
  g.save(); g.font = `700 330px ${SERIF}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.globalCompositeOperation = 'multiply'; g.fillStyle = TOMATO; g.fillText(String(n), 886, 486);
  g.globalCompositeOperation = 'source-over'; g.lineWidth = 5; g.lineJoin = 'round'; g.strokeStyle = INK; g.strokeText(String(n), 880, 480); g.restore();
  txt(g, p.subtitle, 880, 556, { f: SERIF, s: 42, w: 700, st: 'italic', al: 'center', k: a(at.subtitle, .5) });
  txt(g, p.caption, 880, 606, { f: MONO, s: 17, w: 700, ls: 3, al: 'center', k: a(at.caption, .5) });
  if (p.watch) stopwatch(g, 1160, 150, T);
  if (p.bg !== false) grainOver(g, .5);
}, (p, at) => {
  const m = [{ id: 'kicker', t: at.kicker + .1, kind: 'tick' }, { id: 'headline', t: at.headline + .1, kind: 'tick' }, { id: 'subtitle', t: at.subtitle + .1, kind: 'pop' }];
  const L = cl(Math.round(p.left), 0, 100);
  for (let i = 0; i < L; i++) m.push({ id: 'pawn-' + i, t: at.pawns + i * p.pawnStep + .09, kind: 'tick' });
  if (L) m.push({ id: 'total', t: at.pawns + (L - 1) * p.pawnStep + .45, kind: 'pop' });
  return m;
});

// ---------------- parts ----------------
const partSpec = (id, title, description, extra) => ({ id, kind: 'part', mode: 'technical', title, description, duration: 2, tags: ['seed', 'part'], markerKinds: ['pop'], ...extra });
const popM = (p, at) => [{ id: 'pop', t: at.in + .1, kind: 'pop' }];
const part = {
  'tech/station': defAsset(partSpec('tech/station', 'Station dot', 'Metro station marker (ring dot). Use as a node on a route, timeline or flow.', { bounds: [-30, -30, 60, 60], params: { kind: ['string', 'ic', "'n' small, 'ic' interchange, 'big' terminus"] }, anchors: { in: [0, 'pops in'] } }),
    (g, t, p, at) => station(g, 0, 0, eb(A(t, at.in, .35)) * (1 + .03 * Math.sin(t * 2.5)), p.kind), popM),
  'tech/badge': defAsset(partSpec('tech/badge', 'Line badge', 'Rounded mono label pill (branch name, tag, status). Colour is a palette colour.', { bounds: [-100, -20, 200, 40], params: { label: ['string', 'main', 'text'], w: ['number', 90, 'width px'], col: ['color', INK, 'fill colour'] }, anchors: { in: [0, 'pops in'] } }),
    (g, t, p, at) => { g.translate(0, Math.sin(t * 2.2) * 2); badge(g, 0, 0, p.w, p.label, p.col, eb(A(t, at.in, .35))) }, popM),
  'tech/chip': defAsset(partSpec('tech/chip', 'Commit chip', 'Mustard tag chip with short mono text, slightly tilted; use as a token, id or packet.', { bounds: [-40, -30, 80, 60], params: { label: ['string', 'a3f9', 'text, max 5 chars'], rot: ['number', -.05, 'rotation radians'] }, anchors: { in: [0, 'pops in'] } }),
    (g, t, p, at) => { const k = eb(A(t, at.in, .35)); g.save(); g.scale(k, k); chip(g, 0, Math.sin(t * 3) * 1.5, p.label, p.rot + Math.sin(t * 1.7) * .02); g.restore() }, popM),
  'tech/pawn': defAsset(partSpec('tech/pawn', 'Isotype pawn', 'Single isotype person icon, outline (off) or red (on). Scale ~2-3 for a hero icon.', { bounds: [-20, -50, 40, 56], origin: [0, 0], params: { on: ['boolean', true, 'red when true'], s: ['number', 1.4, 'scale'] }, anchors: { in: [0, 'pops in'], flip: [1, 'turns red (only when on=true)'] }, markerKinds: ['pop', 'tick'] }),
    (g, t, p, at) => { const k = eb(A(t, at.in, .35)), q = (t - at.flip) / .45, on = p.on && q >= .2, hop = p.on && q > 0 && q < 1 ? Math.sin(Math.PI * q) * 12 : 0; pawn(g, 0, 20 - hop + Math.sin(t * 2.2) * 2, p.s * k, p.on && q > 0 && q < 1 ? Math.sin(q * 6.283) * .28 : (on ? .07 : 0), on) }, (p, at) => [...popM(p, at), ...(p.on ? [{ id: 'flip', t: at.flip + .09, kind: 'tick' }] : [])]),
  'tech/stopwatch': defAsset(partSpec('tech/stopwatch', 'Stopwatch', 'Paper stopwatch whose red wedge sweeps one turn every 3 s (hand keeps ticking after).', { bounds: [-60, -70, 120, 120], params: { s: ['number', 1.4, 'scale'] }, anchors: { in: [0, 'pops in'] }, markerKinds: ['pop'] }),
    (g, t, p, at) => { const k = eb(A(t, at.in, .4)) * p.s; g.scale(k, k); stopwatch(g, 0, 0, Math.max(0, t - at.in)) }, popM)
};
export const assets = { 'tech/metro-map': metro, 'tech/isotype-crowd': crowd, ...part };
