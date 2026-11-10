/**
 * scenes-b.js - P0 technical scenes, part 2 (paper look, 1280x720, kind 'scene'; params.bg=false = transparent overlay).
 * Registered ids:
 *  tech/app-window   params: mode 'list'|'bars'|'form', url, items[], tags[], values[], fields[], inputs[], button, toast, target; anchors: window, cursor, type, click, result, scroll
 *  tech/code-window  params: filename, lines[], highlight, error, errorText, cps; anchors: window, type, highlight, error
 *  tech/proof-card   params: image (CanvasImageSource, optional), caption, badge, ring[x,y,w,h] normalised, tilt, kicker; anchors: card, ring, stamp
 *  tech/title-card   params: kicker, lines[], accent (line index), sub; anchors: kicker, lines, accent, sub
 * Usage:
 *   import { assets } from './scenes-b.js';
 *   assets['tech/app-window'].draw(g, t, { mode: 'form', inputs: ['Ada', 'ada@x.io'] });
 *   assets['tech/proof-card'].draw(g, t, { image: someImageBitmapOrCanvas, caption: 'Week 3 result' });
 */
import { W, H, INK, PAPER, TOMATO, MUSTARD, GREEN, PINK, SHADOW, AQUA, LEAF, CREAM, SERIF, SANS, MONO, cl, lerp, eo, eio, eb, A, rrect, txt, shade, defAsset, frame, finish, card, pill, kicker, headline, fit, idle, typed, cursor, checkMark, circ } from './kit.js';
import { halftoneDisc } from '../core/core.js';

const ACC = [TOMATO, MUSTARD, GREEN, PINK];
const wpath = (w, t) => { if (t <= w[0][0]) return [w[0][1], w[0][2]]; for (let i = 1; i < w.length; i++) if (t <= w[i][0]) { const q = eio((t - w[i - 1][0]) / (w[i][0] - w[i - 1][0] || 1)); return [lerp(w[i - 1][1], w[i][1], q), lerp(w[i - 1][2], w[i][2], q)] } const l = w[w.length - 1]; return [l[1], l[2]] };

// ---------------- app-window ----------------
const WX = 140, WY = 112, WW = 1000, WH = 548, CY = 176;
const appTiming = (p, at) => { const tot = (p.inputs || []).slice(0, 2).reduce((a, s) => a + s.length, 0); const c = p.mode === 'form' ? Math.max(at.click, at.type + tot / p.cps + .9) : at.click; return { click: c, result: c + (at.result - at.click), scroll: at.scroll - at.click + c } };
const app = defAsset({
  id: 'tech/app-window', title: 'App / browser window with cursor', duration: 7,
  description: 'Generic browser window with a moving cursor that clicks, types or scrolls; the content is a list, a bar list or a form given as params. Use to explain a UI, a product flow or "click here, then this happens".',
  params: { kicker: ['string', 'LIVE DEMO', 'mono kicker above the window'], mode: ['string', 'list', "'list' | 'bars' | 'form'"], url: ['string', 'app.example.com/invoices', 'text in the address pill'],
    items: ['array', ['Invoice #1042', 'Invoice #1043', 'Invoice #1044', 'Invoice #1045', 'Invoice #1046', 'Invoice #1047', 'Invoice #1048'], 'row labels (list and bars)'], tags: ['array', ['PAID', 'DUE', 'PAID', 'OVERDUE', 'PAID', 'DUE', 'PAID'], 'status pills (list mode)'],
    values: ['array', [72, 55, 91, 38, 64, 47], 'bar values 0-100 (bars mode)'], target: ['number', 2, 'row the cursor clicks (list/bars)'], heading: ['string', 'Join the newsletter', 'form heading'],
    fields: ['array', ['Name', 'Email'], 'form field labels (max 2)'], inputs: ['array', ['Ada Lovelace', 'ada@example.com'], 'text typed into the fields'], button: ['string', 'Subscribe', 'form button label'],
    toast: ['string', 'Done', 'green confirmation pill after the click'], cps: ['number', 14, 'typing speed, characters per second'] },
  anchors: { window: [0, 'window pops in'], cursor: [.9, 'cursor appears and starts moving'], type: [1.2, 'typing starts (form mode)'], click: [2.6, 'click moment (form mode waits for typing to finish)'], result: [2.9, 'toast / highlight result'], scroll: [3.8, 'list scrolls (list mode with overflow)'] },
  markerKinds: ['pop', 'tick', 'stamp', 'slide', 'chime', 'whoosh'], tags: ['ui', 'app', 'browser', 'cursor', 'click', 'demo', 'form', 'screen'],
  example: "assets['tech/app-window'].draw(g, t, { mode: 'form', heading: 'Get early access', inputs: ['Sam', 'sam@mail.com'], button: 'Join' })"
}, (g, t, p, at) => {
  frame(g, p, 'a'); kicker(g, p.kicker, 80, 78, eo(A(t, 0, .4))); const tm = appTiming(p, at), wk = eb(A(t, at.window, .55)); if (wk <= 0) { finish(g, p); return }
  const n = cl(p.items.length, 1, p.mode === 'bars' ? 6 : 8), tg = cl(p.target, 0, n - 1); let click = null;
  g.save(); g.translate(WX + WW / 2, WY + WH / 2 + 4 * (1 - wk)); g.rotate(idle(t, .22, .004)); g.scale(.9 + .1 * wk, .9 + .1 * wk); g.globalAlpha = cl(wk * 1.4); g.translate(-WX - WW / 2, -WY - WH / 2);
  card(g, WX, WY, WW, WH, { r: 20, lw: 5, sh: 9 }); g.fillStyle = SHADOW; g.save(); rrect(g, WX, WY, WW, 56, 20); g.clip(); g.fillRect(WX, WY, WW, 56); g.restore();
  g.strokeStyle = INK; g.lineWidth = 4; g.beginPath(); g.moveTo(WX, WY + 56); g.lineTo(WX + WW, WY + 56); g.stroke(); rrect(g, WX, WY, WW, WH, 20); g.stroke();
  [TOMATO, MUSTARD, GREEN].forEach((c, i) => { g.fillStyle = c; g.strokeStyle = INK; g.lineWidth = 3; g.beginPath(); g.arc(WX + 36 + i * 30, WY + 28, 10, 0, 7); g.fill(); g.stroke() });
  g.fillStyle = CREAM; rrect(g, WX + 150, WY + 12, 700, 32, 16); g.fill(); g.lineWidth = 3; g.stroke(); fit(g, p.url, WX + 176, WY + 35, 650, { s: 18, f: MONO, rise: 0 });
  g.save(); rrect(g, WX + 3, CY, WW - 6, WH - (CY - WY) - 3, 16); g.clip();
  if (p.mode === 'form') {
    txt(g, p.heading, 640, 246, { f: SERIF, s: 38, w: 700, st: 'italic', al: 'center', k: eo(A(t, at.window + .3, .5)), rise: 0 }); let tt = at.type, caret = null;
    p.fields.slice(0, 2).forEach((fl, i) => {
      const y = 290 + i * 112, k = eo(A(t, at.window + .4 + i * .15, .4)), val = (p.inputs[i] || ''), shown = typed(val, t, tt, p.cps), focus = t >= tt && t < tm.click + .01 && shown.length <= val.length;
      g.save(); g.globalAlpha = k; txt(g, fl.toUpperCase(), 330, y + 6, { f: MONO, s: 16, w: 700, ls: 3, c: 'rgba(34,30,26,.65)', rise: 0 });
      g.fillStyle = focus && shown.length < val.length + 1 && t - tt < val.length / p.cps + .4 ? shade(MUSTARD, .75) : CREAM; rrect(g, 330, y + 18, 620, 58, 12); g.fill(); g.strokeStyle = INK; g.lineWidth = focus ? 4.5 : 3.5; g.stroke();
      fit(g, shown, 352, y + 58, 560, { s: 28, w: 500, f: SANS, rise: 0 }); g.font = `500 28px ${SANS}`; const cx = 352 + g.measureText(shown).width + 3;
      if (t >= tt && t < tt + val.length / p.cps + 1.6 && (shown.length < val.length || (t % 1) < .5)) { g.fillStyle = INK; g.fillRect(cx, y + 34, 3, 30) }
      g.restore(); tt += val.length / p.cps + .35;
    });
    const by = 290 + Math.min(2, p.fields.length) * 112 + 12, pr = A(t, tm.click, .12) * (1 - A(t, tm.click + .12, .15));
    g.save(); g.translate(330 + 130, by + 32); g.scale(1 - .06 * pr, 1 - .06 * pr); g.translate(-130, -32); g.globalAlpha = eo(A(t, at.window + .8, .4));
    g.fillStyle = SHADOW; rrect(g, 4, 5 - 4 * pr, 260, 64, 14); g.fill(); g.fillStyle = TOMATO; rrect(g, 0, 0, 260, 64, 14); g.fill(); g.strokeStyle = INK; g.lineWidth = 4; g.stroke();
    txt(g, p.button, 130, 42, { s: 26, c: CREAM, al: 'center', rise: 0 }); g.restore(); click = [330 + 190, by + 50];
  } else {
    const rowH = p.mode === 'list' ? 76 : 70, y0 = p.mode === 'list' ? 190 : 214, maxS = Math.max(0, y0 + n * rowH - (WY + WH) + 8), sc = p.mode === 'list' ? maxS * eio(A(t, tm.scroll, .7)) : 0;
    g.translate(0, -sc);
    for (let i = 0; i < n; i++) {
      const k = eo(A(t, at.window + .4 + i * .09, .4)), y = y0 + i * rowH, sel = i === tg && t >= tm.result; if (k <= 0) continue; g.save(); g.globalAlpha = k; g.translate((1 - k) * 50, 0);
      if (p.mode === 'list') {
        g.fillStyle = sel ? shade(MUSTARD, .55) : CREAM; rrect(g, 170, y, 940, 62, 14); g.fill(); g.strokeStyle = INK; g.lineWidth = sel ? 5 : 3.5; g.stroke();
        g.fillStyle = ACC[i % 4]; g.beginPath(); g.arc(214, y + 31, 17, 0, 7); g.fill(); g.lineWidth = 3.5; g.stroke(); fit(g, p.items[i], 252, y + 41, 560, { s: 28, w: 600, rise: 0 });
        const tgx = p.tags[i] || ''; pill(g, 1020, y + 31, 120, 34, tgx === 'PAID' ? GREEN : tgx === 'DUE' ? MUSTARD : TOMATO, tgx, { s: 16 }); if (sel) { g.strokeStyle = INK; g.lineWidth = 5; g.lineCap = 'round'; g.beginPath(); g.moveTo(1112, y + 19); g.lineTo(1124, y + 31); g.lineTo(1112, y + 43); g.stroke() }
        if (i === tg) click = [900, y + 31];
      } else {
        const v = p.values[i] ?? 50, bx = 420, bw = 640 * v / 100 * eo(A(t, at.window + .5 + i * .12, .6)); fit(g, p.items[i], 190, y + 40, 210, { s: 24, w: 600, rise: 0 });
        g.fillStyle = 'rgba(34,30,26,.08)'; rrect(g, bx, y + 14, 640, 36, 18); g.fill(); g.fillStyle = SHADOW; rrect(g, bx + 3, y + 17, Math.max(8, bw), 36, 18); g.fill(); g.fillStyle = sel ? TOMATO : MUSTARD; rrect(g, bx, y + 14, Math.max(8, bw), 36, 18); g.fill(); g.strokeStyle = INK; g.lineWidth = 4; g.stroke();
        if (bw > 70) txt(g, v + '%', bx + bw - 14, y + 40, { f: MONO, s: 18, w: 700, al: 'right', c: sel ? CREAM : INK, rise: 0 }); if (i === tg) click = [bx + Math.min(bw, 640 * v / 100) - 30, y + 32];
      }
      g.restore();
    }
  }
  g.restore();
  const tk = eb(A(t, tm.result, .4)); if (tk > 0) { g.save(); g.translate(WX + WW - 150, WY + WH + 2 + idle(t, .5, 2)); g.scale(tk, tk); pill(g, 0, 0, 170, 42, GREEN, '', {}); checkMark(g, -52, 1, 1.15, CREAM, 1); txt(g, p.toast, -26, 7, { s: 20, c: CREAM, rise: 0 }); g.restore() }
  g.restore();
  // cursor path
  const c0 = [WX + WW - 120, WY + WH - 70], tgp = click || [640, 400], wps = [[at.cursor, c0[0], c0[1]], [tm.click - .25, tgp[0] + 6, tgp[1] + 4], [tm.click, tgp[0], tgp[1]]];
  if (p.mode === 'form') { const f1 = [560, 338]; wps.splice(1, 0, [at.cursor + .6, f1[0], f1[1]]) }
  if (t >= at.cursor) { const k = eo(A(t, at.cursor - .05, .2)); let [cx, cy] = wpath(wps, t); const pr = A(t, tm.click, .1) * (1 - A(t, tm.click + .1, .15)); cx += idle(t, .35, 3) * eo(A(t, tm.click + .5, .5)); cy += idle(t, .27, 2, 1) * eo(A(t, tm.click + .5, .5));
    const rp = A(t, tm.click, .45); if (rp > 0 && rp < 1) { g.strokeStyle = TOMATO; g.globalAlpha = 1 - rp; g.lineWidth = 5; g.beginPath(); g.arc(cx, cy, 8 + 36 * eo(rp), 0, 7); g.stroke(); g.globalAlpha = 1 }
    g.globalAlpha = k; cursor(g, cx, cy, 1.15, pr); g.globalAlpha = 1 }
  finish(g, p);
}, (p, at) => { const tm = appTiming(p, at), m = [{ id: 'window', t: at.window + .15, kind: 'pop' }, { id: 'cursor', t: at.cursor, kind: 'whoosh' }, { id: 'click', t: tm.click, kind: 'tick' }, { id: 'result', t: tm.result + .1, kind: 'chime' }];
  if (p.mode === 'form') { let tt = at.type; p.inputs.slice(0, 2).forEach((s, i) => { for (let k = 0; k < s.length; k += 2) m.push({ id: `key-${i}-${k}`, t: tt + k / p.cps, kind: 'tick' }); tt += s.length / p.cps + .35 }) }
  if (p.mode === 'list') m.push({ id: 'scroll', t: tm.scroll, kind: 'slide' }); return m });

// ---------------- code-window ----------------
const KW = /^(const|let|var|return|await|async|function|if|else|import|from|export|for|while|new|try|catch|throw|true|false|null|def|class|in|of)$/;
const tokens = s => { const out = [], re = /(\/\/.*$|#.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_$][\w$]*\b)|(\s+|.)/g; let m; while ((m = re.exec(s))) { if (m[1]) out.push([m[0], 'c']); else if (m[2]) out.push([m[0], 's']); else if (m[3]) out.push([m[0], 'n']); else if (m[4]) out.push([m[0], KW.test(m[0]) ? 'k' : 'i']); else out.push([m[0], 'p']) } return out };
const SYN = { k: TOMATO, s: GREEN, n: shade(MUSTARD, -.45), c: 'rgba(34,30,26,.5)', i: INK, p: INK };
const code = defAsset({
  id: 'tech/code-window', title: 'Code window (typing, highlight, error)', duration: 7,
  description: 'Paper-style editor window where lines type themselves with generic syntax colours, one line gets a mustard highlight and one gets a red squiggle with an error message. Use to show code, a bug, a fix or a command.',
  params: { kicker: ['string', 'THE BUG', 'mono kicker'], filename: ['string', 'app.js', 'tab title'], lines: ['array', ['async function load(id) {', '  const user = await getUser(id);', '  const name = user.profile.name;', '  return `Hello, ${name}`;', '}', '// crashes when profile is missing'], 'up to 9 code lines'],
    highlight: ['number', 1, 'line index with the mustard highlight (-1 none)'], error: ['number', 2, 'line index with the red squiggle (-1 none)'], errorText: ['string', "TypeError: profile is undefined", 'message in the error pill'], cps: ['number', 34, 'typing speed in characters per second'] },
  anchors: { window: [0, 'window pops in'], type: [.7, 'typing starts'], highlight: [3.2, 'highlight swipes in'], error: [4.2, 'squiggle draws and error pill drops in'] },
  markerKinds: ['pop', 'tick', 'slide', 'stamp'], tags: ['code', 'editor', 'bug', 'programming', 'developer', 'syntax'],
  example: "assets['tech/code-window'].draw(g, t, { filename: 'main.py', lines: ['def add(a, b):', '    return a + b'], error: -1, highlight: 1 })"
}, (g, t, p, at) => {
  frame(g, p, 'c'); kicker(g, p.kicker, 80, 78, eo(A(t, 0, .4))); const wk = eb(A(t, at.window, .5)); if (wk <= 0) { finish(g, p); return }
  const L = p.lines.slice(0, 9), LH = 50, X = 120, Y = 112, Wd = 1040, Ht = 70 + L.length * LH + 34;
  g.save(); g.translate(640, Y + Ht / 2); g.scale(.92 + .08 * wk, .92 + .08 * wk); g.globalAlpha = cl(wk * 1.4); g.translate(-640, -Y - Ht / 2);
  card(g, X, Y, Wd, Ht, { r: 18, lw: 5, sh: 9 }); g.save(); rrect(g, X, Y, Wd, 52, 18); g.clip(); g.fillStyle = SHADOW; g.fillRect(X, Y, Wd, 52); g.restore(); g.strokeStyle = INK; g.lineWidth = 4; g.beginPath(); g.moveTo(X, Y + 52); g.lineTo(X + Wd, Y + 52); g.stroke();
  [TOMATO, MUSTARD, GREEN].forEach((c, i) => { g.fillStyle = c; g.lineWidth = 3; g.beginPath(); g.arc(X + 34 + i * 28, Y + 26, 9, 0, 7); g.fill(); g.stroke() });
  g.fillStyle = CREAM; rrect(g, X + 130, Y + 10, 190, 42, 10); g.fill(); g.lineWidth = 3.5; g.stroke(); txt(g, p.filename, X + 225, Y + 38, { f: MONO, s: 18, w: 700, al: 'center', rise: 0 });
  g.fillStyle = 'rgba(34,30,26,.07)'; g.fillRect(X + 3, Y + 55, 70, Ht - 58);
  let used = 0, endX = 0, endY = 0, ly = 0; const FS = 26; g.font = `700 ${FS}px ${MONO}`; const cw = g.measureText('M').width; const total = Math.floor((t - at.type) * p.cps);
  const hk = eo(A(t, at.highlight, .5)); if (p.highlight >= 0 && hk > 0) { g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = MUSTARD; g.fillRect(X + 3, Y + 70 + p.highlight * LH - 2, (Wd - 6) * hk, LH); g.restore() }
  L.forEach((ln, i) => {
    const y = Y + 70 + i * LH + 34, n = Math.max(0, Math.min(ln.length, total - used)); txt(g, String(i + 1), X + 58, y, { f: MONO, s: 18, w: 700, al: 'right', c: 'rgba(34,30,26,.4)', rise: 0 });
    let x = X + 96; tokens(ln.slice(0, n)).forEach(([s, ty]) => { txt(g, s, x, y, { f: MONO, s: FS, w: ty === 'k' ? 700 : 400, c: SYN[ty], rise: 0 }); x += cw * s.length });
    if (total >= used && total <= used + ln.length + 1 || i === L.length - 1) { endX = x; endY = y }
    if (i === p.error && t >= at.error) { const q = eo(A(t, at.error, .5)), x0 = X + 96 + cw * (ln.length - ln.trimStart().length), x1 = X + 96 + cw * ln.length; g.strokeStyle = TOMATO; g.lineWidth = 3.5; g.lineCap = 'round'; g.beginPath(); for (let u = x0; u <= x0 + (x1 - x0) * q; u += 4) { const yy = y + 9 + (Math.floor((u - x0) / 4) % 2 ? 4 : 0); u === x0 ? g.moveTo(u, yy) : g.lineTo(u, yy) } g.stroke(); ly = y }
    used += ln.length;
  });
  if (total < used + 1 || (t % 1) < .5) { g.fillStyle = INK; g.fillRect(endX + 2, endY - 24, 3, 30) }
  g.restore();
  const ek = eb(A(t, at.error + .15, .45)); if (p.error >= 0 && ek > 0) { const yy = Y + 70 + (p.error + 1) * LH + 2 + (1 - ek) * -14; g.font = `700 20px ${MONO}`; const w0 = Math.min(560, g.measureText(p.errorText).width + 70); g.save(); g.globalAlpha = cl(ek); g.translate(X + Wd - 40 - w0, yy); g.scale(cl(ek, 0, 1.05), cl(ek, 0, 1.05)); const w = w0;
    g.fillStyle = SHADOW; rrect(g, 4, 4, w, 44, 12); g.fill(); g.fillStyle = TOMATO; rrect(g, 0, 0, w, 44, 12); g.fill(); g.strokeStyle = INK; g.lineWidth = 4; g.stroke(); txt(g, '!', 24, 30, { f: MONO, s: 24, c: CREAM, al: 'center', rise: 0 }); fit(g, p.errorText, 46, 30, w - 60, { f: MONO, s: 20, c: CREAM, rise: 0 }); g.restore() }
  finish(g, p);
}, (p, at) => { const L = p.lines.slice(0, 9), m = [{ id: 'window', t: at.window + .15, kind: 'pop' }]; const tot = L.reduce((a, s) => a + s.length, 0); for (let k = 0; k < tot; k += 3) m.push({ id: 'key-' + k, t: at.type + k / p.cps, kind: 'tick' });
  if (p.highlight >= 0) m.push({ id: 'highlight', t: at.highlight + .1, kind: 'slide' }); if (p.error >= 0) m.push({ id: 'error', t: at.error + .3, kind: 'stamp' }); return m });

// ---------------- proof-card ----------------
const imgSize = im => [im.naturalWidth || im.videoWidth || im.width || 1, im.naturalHeight || im.videoHeight || im.height || 1];
const proof = defAsset({
  id: 'tech/proof-card', title: 'Proof card (screenshot on paper)', duration: 5,
  description: 'Your screenshot (params.image) on a taped paper card that drops in with a slight tilt and shadow, then a red ring circles the key area and a VERIFIED stamp lands. Use for evidence, results, testimonials or "here is the real thing".',
  params: { kicker: ['string', 'THE PROOF', 'mono kicker'], image: ['image', null, 'ImageBitmap, HTMLImageElement or canvas; null draws a placeholder screenshot'], caption: ['string', 'Real result, week 3', 'caption on the card'],
    badge: ['string', 'VERIFIED', 'stamp text (empty hides it)'], ring: ['array', [.5, .28, .38, .24], 'highlight ring [x,y,w,h] in 0..1 image coordinates; [] hides it'], tilt: ['number', -.03, 'resting card rotation in radians'] },
  anchors: { card: [.1, 'card drops in'], ring: [1.5, 'red ring draws around the highlight'], stamp: [2.3, 'stamp thuds down'] },
  markerKinds: ["slide", "pop", "stamp", "tick", "thud", "whoosh"], tags: ['screenshot', 'proof', 'evidence', 'image', 'testimonial', 'result'],
  example: "assets['tech/proof-card'].draw(g, t, { image: screenshotBitmap, caption: 'Dashboard, March', ring: [.1, .2, .3, .2] })"
}, (g, t, p, at) => {
  frame(g, p, 'b'); kicker(g, p.kicker, 80, 78, eo(A(t, 0, .4))); const k = eb(A(t, at.card, .7)); if (k <= 0) { finish(g, p); return }
  const CW = 860, CH = 480, IX = 20, IY = 20, IW = CW - 40, IH = CH - 100, sett = eo(A(t, at.card + .7, .6));
  g.save(); g.translate(640, 400 + (1 - k) * -420 + idle(t, .3, 4 * sett)); g.rotate(p.tilt * lerp(2.2, 1, cl(k)) + idle(t, .22, .006 * sett, 2)); g.translate(-CW / 2, -CH / 2);
  card(g, 0, 0, CW, CH, { r: 14, lw: 5, sh: 12, fill: CREAM });
  g.save(); rrect(g, IX, IY, IW, IH, 8); g.clip(); g.fillStyle = shade(PAPER, -.04); g.fillRect(IX, IY, IW, IH);
  if (p.image) { const [iw, ih] = imgSize(p.image), s = Math.max(IW / iw, IH / ih); g.drawImage(p.image, IX + (IW - iw * s) / 2, IY + (IH - ih * s) / 2, iw * s, ih * s) }
  else { g.fillStyle = AQUA; g.fillRect(IX, IY, IW, 46); [0, 1, 2].forEach(i => { g.fillStyle = [TOMATO, MUSTARD, GREEN][i]; g.beginPath(); g.arc(IX + 28 + i * 24, IY + 23, 7, 0, 7); g.fill() }); g.fillStyle = CREAM; rrect(g, IX + 120, IY + 10, 360, 26, 13); g.fill();
    for (let i = 0; i < 4; i++) { g.fillStyle = [LEAF, AQUA, 'rgba(242,163,181,.6)', 'rgba(242,181,49,.5)'][i]; rrect(g, IX + 24 + i * 196, IY + 74, 180, 90, 12); g.fill() }
    g.fillStyle = 'rgba(34,30,26,.12)'; for (let i = 0; i < 5; i++) { rrect(g, IX + 24, IY + 190 + i * 30, 300 + (i * 97) % 260, 14, 7); g.fill() } g.fillStyle = MUSTARD; for (let i = 0; i < 6; i++) { rrect(g, IX + 520 + i * 50, IY + 330 - (i * 37 % 100 + 30), 34, (i * 37 % 100 + 30), 4); g.fill() }
    txt(g, 'YOUR SCREENSHOT', IX + IW - 20, IY + IH - 16, { f: MONO, s: 15, w: 700, ls: 3, al: 'right', c: 'rgba(34,30,26,.45)', rise: 0 }) }
  g.restore(); g.strokeStyle = INK; g.lineWidth = 4; rrect(g, IX, IY, IW, IH, 8); g.stroke();
  fit(g, p.caption, 30, CH - 28, 560, { s: 34, f: SERIF, st: 'italic', rise: 0 });
  if (p.ring.length === 4) { const rk = eio(A(t, at.ring, .7)); if (rk > 0) { const [rx, ry, rw, rh] = p.ring, x = IX + rx * IW, y = IY + ry * IH, w = rw * IW, h = rh * IH, per = 2 * (w + h); g.save(); g.strokeStyle = TOMATO; g.lineWidth = 6 + idle(t, .6, 1.2) * eo(A(t, at.ring + .8, .3)); g.lineCap = 'round'; g.setLineDash([per * rk, per]); rrect(g, x - 10, y - 10, w + 20, h + 20, Math.min(30, h / 2)); g.stroke(); g.restore() } }
  [[70, -4, -.5], [CW - 70, -4, .5]].forEach(([x, y, r]) => { g.save(); g.translate(x, y); g.rotate(r); g.globalCompositeOperation = 'multiply'; g.fillStyle = 'rgba(242,181,49,.85)'; g.fillRect(-48, -16, 96, 32); g.restore() });
  const sk = eb(A(t, at.stamp, .3)); if (p.badge && sk > 0) { g.save(); g.translate(CW - 150, CH - 52); g.rotate(-.2); const sc = 1 + (1 - sk) * 1.2; g.scale(sc, sc); g.globalAlpha = cl(sk); g.font = `700 24px ${MONO}`; const w = g.measureText(p.badge).width + 40; g.strokeStyle = TOMATO; g.lineWidth = 5; rrect(g, -w / 2, -24, w, 46, 10); g.stroke(); txt(g, p.badge, 0, 8, { f: MONO, s: 24, c: TOMATO, al: 'center', ls: 2, rise: 0 }); g.restore() }
  g.restore(); finish(g, p);
}, (p, at) => [{ id: 'drop', t: at.card + .3, kind: 'slide' }, { id: 'land', t: at.card + .55, kind: 'thud' }, ...(p.ring.length === 4 ? [{ id: 'ring', t: at.ring + .05, kind: 'whoosh' }] : []), ...(p.badge ? [{ id: 'stamp', t: at.stamp + .12, kind: 'stamp' }] : [])].map(m => m.kind === 'thud' || m.kind === 'whoosh' ? m : m));

// ---------------- title-card ----------------
const title = defAsset({
  id: 'tech/title-card', title: 'Title card', duration: 5,
  description: 'Opening or chapter title: mono kicker plus a large serif headline in 1-3 lines with riso misregistration, one italic accent line with a mustard highlight, and a subtitle. Use to open a video, introduce a section or state the main claim.',
  params: { kicker: ['string', 'EPISODE 01', 'mono kicker'], lines: ['array', ['Say hello', 'to paper.'], '1 to 3 headline lines'], accent: ['number', 1, 'index of the italic highlighted line (-1 none)'], sub: ['string', 'A calmer way to explain things', 'mono caps subtitle'], step: ['number', .28, 'seconds between lines'] },
  anchors: { kicker: [0, 'kicker fades in'], lines: [.2, 'first line rises in'], accent: [1.0, 'highlighter swipe on the accent line'], sub: [1.5, 'subtitle fades in'], disc: [.1, 'halftone disc grows'] },
  markerKinds: ['tick', 'pop', 'slide'], tags: ['title', 'intro', 'headline', 'opening', 'chapter'],
  example: "assets['tech/title-card'].draw(g, t, { kicker: 'PART TWO', lines: ['Why it', 'breaks'], accent: 1, sub: 'and how to fix it' })"
}, (g, t, p, at) => {
  frame(g, p, 'a'); kicker(g, p.kicker, 80, 78, eo(A(t, at.kicker, .4))); const L = p.lines.slice(0, 3), n = L.length;
  halftoneDisc(g, 1010, 400, 235 + idle(t, .4, 4), 16, p.accent >= 0 ? MUSTARD : PINK, eo(A(t, at.disc, .9)));
  let sz = 124; L.forEach((s, i) => { g.font = `${i === p.accent ? 'italic ' : ''}700 ${sz}px ${SERIF}`; const w = g.measureText(s).width; if (w > 1000) sz = Math.min(sz, Math.floor(sz * 1000 / w)) });
  const lh = sz * 1.08, y0 = 360 - (n - 1) * lh / 2 + sz * .3;
  L.forEach((s, i) => { const y = y0 + i * lh, it = i === p.accent ? 'italic' : ''; g.font = `${it} 700 ${sz}px ${SERIF}`; const w = g.measureText(s).width, hk = eo(A(t, at.accent, .6));
    if (i === p.accent && hk > 0) { g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = MUSTARD; g.translate(70, y - sz * .8); g.rotate(-.012); g.fillRect(0, 0, (w + 40) * hk, sz * .98); g.restore() }
    const k = eo(A(t, at.lines + i * p.step, .5)); const o = { f: SERIF, s: sz, w: 700, st: it, k }; txt(g, s, 84, y + 4, { ...o, c: PINK, mul: 1 }); txt(g, s, 80, y, o) });
  const sy = y0 + (n - 1) * lh + 70; txt(g, p.sub.toUpperCase(), 84, Math.min(sy, 660), { f: MONO, s: 20, w: 700, ls: 4, k: eo(A(t, at.sub, .5)), c: 'rgba(34,30,26,.8)' });
  finish(g, p);
}, (p, at) => { const m = [{ id: 'kicker', t: at.kicker + .1, kind: 'tick' }, { id: 'sub', t: at.sub + .1, kind: 'tick' }]; p.lines.slice(0, 3).forEach((s, i) => m.push({ id: 'line-' + i, t: at.lines + i * p.step + .12, kind: 'pop' })); if (p.accent >= 0) m.push({ id: 'accent', t: at.accent + .1, kind: 'slide' }); return m });

export const assets = { 'tech/app-window': app, 'tech/code-window': code, 'tech/proof-card': proof, 'tech/title-card': title };
