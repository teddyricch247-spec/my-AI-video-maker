/**
 * environment/terrain.js — parallax hills, dunes, mountains, crop rows, water, ground strips.
 *
 * drawHills / drawMountains / drawCropRows / drawWater / drawGround / drawDunesAsset (g,t,o): full-width layers that scroll with o.cam (camera px) at their own parallax rate.
 *   hills pal = warm|green|dry|cool|night; ground kind = street|grass|sand|dirt|tile; water kind = river|sea.
 * Helpers kept for the seed scenes (exact ports): hillLayer, hillVillage, duneFn, DUNES, FGN, drawDune, duneArches, foregroundSand, dryTufts.
 * Registered: 'env/hills', 'env/mountains', 'env/crops', 'env/water', 'env/ground', 'env/dunes'.
 *
 *   assets['env/water'].draw(g,t,{kind:'river',y:540,h:180});
 */
import { cl, lerp, rng, shade, tiled } from '../core/core.js';
import { W, H, AQUA, CREAM, INK, TOMATO } from '../core/palette.js';
import { mk, P, ANC, withDefaults } from './_meta.js';
import { cobbleStreet } from './street.js';
import { drawPlant } from './plants.js';

/** sine-sum hill layer (exact market port). off = world offset in px. */
export function hillLayer(g, off, base, amp, col, f) {
  g.fillStyle = col; g.beginPath(); g.moveTo(0, H);
  for (let x = 0; x <= W; x += 10) { const wx = x + off; g.lineTo(x, base - amp * (.6 * Math.sin(wx * f) + .4 * Math.sin(wx * f * 2.7 + 1))) }
  g.lineTo(W, H); g.fill();
}
/** little distant village on the first hill (exact market port) */
export function hillVillage(g, cam) {
  tiled(260, cam * .12, (ox, k) => {
    const r = rng(k * 31 + 3), wx = ox + 60 + r() * 100, hy = 400 - 34 * (.6 * Math.sin((wx + cam * .12) * .0053) + .4 * Math.sin((wx + cam * .12) * .0053 * 2.7 + 1)) - 8;
    g.fillStyle = '#E3A28F'; g.fillRect(wx, hy - 26 - r() * 16, 22, 30 + r() * 16); g.fillStyle = '#D58D7C'; g.beginPath(); g.moveTo(wx - 3, hy - 26); g.lineTo(wx + 11, hy - 40); g.lineTo(wx + 25, hy - 26); g.fill()
  }, 100);
}
export const duneFn = (base, amp, f1, f2, p) => wx => base - amp * (.62 * Math.sin(wx * f1 + p) + .38 * Math.sin(wx * f2 + p * 1.7));
export const DUNES = [
  { d: .05, fn: duneFn(398, 14, .0062, .015, .4), col: '#F6C9A2' },
  { d: .10, fn: duneFn(444, 24, .0050, .012, 1.9), col: '#F0B188' },
  { d: .20, fn: duneFn(496, 34, .0046, .011, 3.1), col: '#E39770' },
  { d: .38, fn: duneFn(556, 40, .0042, .010, .7), col: '#CC7552' },
  { d: .65, fn: duneFn(606, 28, .0040, .011, 2.2), col: '#B05A40' }];
export const FGN = duneFn(626, 12, .0045, .012, 1.2);
/** one dune layer with shaded lee side and lit crest (exact dunes port) */
export function drawDune(g, D, cam) {
  const off = cam * D.d;
  g.fillStyle = D.col; g.beginPath(); g.moveTo(0, H); for (let x = 0; x <= W; x += 8)g.lineTo(x, D.fn(x + off)); g.lineTo(W, H); g.closePath(); g.fill();
  g.fillStyle = shade(D.col, -.15); g.beginPath(); const top = [], bot = [];
  for (let x = 0; x <= W; x += 8) { const y = D.fn(x + off), s = (D.fn(x + off + 4) - D.fn(x + off - 4)) / 8, hh = s < 0 ? Math.min(120, -s * 340) : 0; top.push([x, y]); bot.push([x, y + hh]) }
  top.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); for (let i = bot.length - 1; i >= 0; i--)g.lineTo(bot[i][0], bot[i][1]); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(255,240,205,.55)'; g.lineWidth = 2.5; g.lineCap = 'round';
  let run = false; g.beginPath();
  for (let x = 0; x <= W; x += 8) { const s = (D.fn(x + off + 4) - D.fn(x + off - 4)) / 8, y = D.fn(x + off); if (s > 0) { run ? g.lineTo(x, y) : g.moveTo(x, y); run = true } else run = false }
  g.stroke();
}
/** sandstone arch silhouette on a dune (exact dunes port) */
export function duneArches(g, D, cam) {
  tiled(2400, cam * D.d + 600, (ox) => {
    const wx = ox + 700, y = D.fn(wx + cam * D.d - 0) + 4; g.fillStyle = shade(D.col, -.12);
    g.fillRect(wx, y - 74, 16, 74); g.fillRect(wx + 56, y - 74, 16, 74); g.beginPath(); g.arc(wx + 36, y - 74, 36, Math.PI, 0); g.lineTo(wx + 56, y - 74); g.arc(wx + 36, y - 74, 20, 0, Math.PI, true); g.closePath(); g.fill()
  }, 400);
}
/** foreground sand + ripple lines + (separately) footprints; exact dunes port */
export function foregroundSand(g, cam) {
  const off = cam; g.fillStyle = '#EDB583'; g.beginPath(); g.moveTo(0, H); for (let x = 0; x <= W; x += 8)g.lineTo(x, FGN(x + off) + 22); g.lineTo(W, H); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(205,150,100,.55)'; g.lineWidth = 2.5; g.lineCap = 'round';
  for (let j = 0; j < 4; j++) { g.beginPath(); for (let x = 0; x <= W; x += 10) { const wx = x + off, y = FGN(wx) + 50 + j * 24 + 5 * Math.sin(wx * .02 + j * 1.7); x ? g.lineTo(x, y) : g.moveTo(x, y) } g.stroke() }
}
/** foreground dry-grass tufts that sway (exact dunes port) */
export function dryTufts(g, t, cam) {
  tiled(520, cam * 1.5, (ox, k) => {
    const r = rng(k * 13 + 9); g.strokeStyle = '#8E3F2F'; g.lineWidth = 4; g.lineCap = 'round';
    for (let b = 0; b < 8; b++) { const bx = ox + 60 + b * 6 + r() * 4, hh = 50 + r() * 70, lean = (r() - .5) * 50 + Math.sin(t * 1.5 + b + k) * 5; g.beginPath(); g.moveTo(bx, H + 4); g.quadraticCurveTo(bx + lean * .3, H - hh * .6, bx + lean, H - hh); g.stroke() }
  }, 100);
}

// ============================================================ full terrain library (all take cam = world scroll px)
export const HILL_PAL = {
  warm: ['#EBB3A0', '#DD9C8C', '#C98577'], green: ['#B9D09A', '#8FB87A', '#6E9A5E'], dry: ['#E6C493', '#D3A56F', '#B88555'], cool: ['#B9C9D1', '#9DB3BE', '#7F99A8'], night: ['#5A4A78', '#463A66', '#34294F'],
};
/** three parallax hill layers. o={cam, pal:'warm|green|dry|cool|night' or array of 3 colours, base:420, amp:40} */
export function drawHills(g, t, o0) {
  const o = withDefaults(o0, { cam: 0, pal: 'green', base: 400, amp: 40 }), pal = Array.isArray(o.pal) ? o.pal : (HILL_PAL[o.pal] || HILL_PAL.green);
  hillLayer(g, o.cam * .08, o.base, o.amp, pal[0], .0042); hillLayer(g, o.cam * .15, o.base + 40, o.amp * .9, pal[1], .0053); hillLayer(g, o.cam * .25, o.base + 90, o.amp * 1.1, pal[2], .0036);
}
/** jagged mountain range with snow caps. o={cam, base, col, snow} */
export function drawMountains(g, t, o0) {
  const o = withDefaults(o0, { cam: 0, base: 440, col: '#9DB3BE', snow: true, par: .06, h: 220 });
  const f = wx => { const a = Math.abs(Math.sin(wx * .0042 + .8)) * .65 + Math.abs(Math.sin(wx * .0097 + 2.1)) * .3 + Math.abs(Math.sin(wx * .021)) * .08; return o.base - o.h * a };
  const off = o.cam * o.par; g.fillStyle = o.col; g.beginPath(); g.moveTo(0, H); for (let x = 0; x <= W; x += 6) g.lineTo(x, f(x + off)); g.lineTo(W, H); g.closePath(); g.fill();
  g.fillStyle = shade(o.col, -.14); g.beginPath(); const tp = [], bt = []; for (let x = 0; x <= W; x += 6) { const y = f(x + off), sl = (f(x + off + 3) - f(x + off - 3)) / 6; tp.push([x, y]); bt.push([x, y + (sl < 0 ? Math.min(90, -sl * 160) : 0)]) } tp.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); for (let i = bt.length - 1; i >= 0; i--) g.lineTo(bt[i][0], bt[i][1]); g.closePath(); g.fill();
  if (o.snow) { const thr = o.base - o.h * .62; g.fillStyle = 'rgba(255,250,240,.92)'; let run = []; const flush = () => { if (run.length > 1) { g.beginPath(); run.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); for (let i = run.length - 1; i >= 0; i--) { const p = run[i], d = Math.min(30, (thr - p[1]) * 1.3); g.lineTo(p[0], p[1] + d * (.6 + .4 * Math.abs(Math.sin(p[0] * .13)))) } g.closePath(); g.fill() } run = [] }; for (let x = 0; x <= W; x += 6) { const y = f(x + off); if (y < thr) run.push([x, y]); else flush() } flush() }
}
/** perspective crop field: rows of crop plants receding from y0 to the bottom. o={cam,y0:470,rows:5,kind:'crop',soil} */
export function drawCropRows(g, t, o0) {
  const o = withDefaults(o0, { cam: 0, y0: 470, rows: 5, soil: '#B98B62', kind: 'crop', par: 1, gap: 90 });
  const g0 = g.createLinearGradient(0, o.y0, 0, H); g0.addColorStop(0, shade(o.soil, .15)); g0.addColorStop(1, shade(o.soil, -.12)); g.fillStyle = g0; g.fillRect(0, o.y0, W, H - o.y0);
  for (let r = 0; r < o.rows; r++) {
    const u = (r + .5) / o.rows, y = lerp(o.y0 + 16, H - 8, u * u), s = lerp(.35, 1.2, u * u), gap = lerp(84, 176, u * u);
    g.strokeStyle = shade(o.soil, -.22); g.lineWidth = lerp(3, 10, u * u); g.beginPath(); g.moveTo(0, y + 6 * s); g.lineTo(W, y + 6 * s); g.stroke();
    tiled(gap, o.cam * (.5 + u) * o.par, (ox, k) => drawPlant(g, o.kind, t, { x: ox + gap / 2, y, s, seed: k + r * 7, wind: 1 }), 100);
  }
}
/** river or sea band with moving ripples. o={y:560,h:160,kind:'river'|'sea',cam,col,hl (highlight)} */
export function drawWater(g, t, o0) {
  const o = withDefaults(o0, { y: 540, h: 180, kind: 'river', cam: 0, col: '#7FB8AE', hl: 'rgba(255,255,255,.55)' });
  const g0 = g.createLinearGradient(0, o.y, 0, o.y + o.h); g0.addColorStop(0, shade(o.col, .22)); g0.addColorStop(1, shade(o.col, -.14)); g.fillStyle = g0;
  if (o.kind === 'sea') { g.beginPath(); g.moveTo(0, o.y); for (let x = 0; x <= W; x += 10) g.lineTo(x, o.y + Math.sin((x + t * 40) * .02) * 3); g.lineTo(W, o.y + o.h); g.lineTo(0, o.y + o.h); g.closePath(); g.fill() } else g.fillRect(0, o.y, W, o.h);
  g.strokeStyle = o.hl; g.lineCap = 'round'; const rows = Math.max(3, Math.round(o.h / 26));
  for (let r = 0; r < rows; r++) { const u = (r + .5) / rows, y = o.y + 10 + u * (o.h - 20), len = lerp(30, 90, u), per = lerp(120, 240, u), sp = (o.kind === 'river' ? 26 : 14) * lerp(.6, 1.4, u); g.lineWidth = lerp(1.8, 4, u);
    tiled(per, -(o.cam * lerp(.4, 1, u)) - t * sp * (o.kind === 'river' ? -1 : 0) + t * 0, (ox, k) => { const rr = rng(k * 19 + r * 7), x = ox + rr() * per * .7, ph = Math.sin(t * 1.4 + k + r) * 5; g.globalAlpha = .45 + .4 * Math.sin(t * 1.1 + k * 2 + r); g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + len / 2, y - 5 + ph * .2, x + len, y); g.stroke() }, 100) }
  g.globalAlpha = 1;
}
/** ground strip from y down to the bottom. kind: street grass sand dirt tile. o={y:520,cam} */
export function drawGround(g, t, o0) {
  const o = withDefaults(o0, { kind: 'street', y: 520, cam: 0 }), y = o.y;
  g.save();
  if (o.kind === 'street') { g.translate(0, y - 520); g.fillStyle = '#B98B72'; g.fillRect(0, 700, W, 400); cobbleStreet(g, o.cam) }
  else if (o.kind === 'grass') { const g0 = g.createLinearGradient(0, y, 0, H); g0.addColorStop(0, '#A9C876'); g0.addColorStop(1, '#7FA864'); g.fillStyle = g0; g.fillRect(0, y, W, H - y); g.strokeStyle = 'rgba(70,110,60,.35)'; g.lineWidth = 3; g.lineCap = 'round'; for (let r = 0; r < 4; r++) { const yy = y + 30 + r * ((H - y - 40) / 4); tiled(110 + r * 20, o.cam * (.6 + r * .15), (ox, k) => { const rr = rng(k * 17 + r); const x = ox + rr() * 60; g.beginPath(); g.moveTo(x, yy); g.lineTo(x - 4, yy - 12 - r * 2); g.moveTo(x + 6, yy); g.lineTo(x + 8, yy - 14 - r * 2); g.stroke() }, 50) } }
  else if (o.kind === 'sand') { const g0 = g.createLinearGradient(0, y, 0, H); g0.addColorStop(0, '#F0C390'); g0.addColorStop(1, '#E0A66E'); g.fillStyle = g0; g.fillRect(0, y, W, H - y); g.strokeStyle = 'rgba(205,150,100,.55)'; g.lineWidth = 2.5; g.lineCap = 'round'; for (let j = 0; j < 4; j++) { g.beginPath(); for (let x = 0; x <= W; x += 10) { const wx = x + o.cam, yy = y + 36 + j * ((H - y - 50) / 4) + 5 * Math.sin(wx * .02 + j * 1.7); x ? g.lineTo(x, yy) : g.moveTo(x, yy) } g.stroke() } }
  else if (o.kind === 'dirt') { const g0 = g.createLinearGradient(0, y, 0, H); g0.addColorStop(0, '#C9A073'); g0.addColorStop(1, '#A47A52'); g.fillStyle = g0; g.fillRect(0, y, W, H - y); g.fillStyle = 'rgba(90,60,40,.22)'; const rt = [y + (H - y) * .35, y + (H - y) * .7]; rt.forEach(yy => { g.fillRect(0, yy, W, 12) }); tiled(150, o.cam, (ox, k) => { const rr = rng(k * 11 + 3); [0, 1, 2].forEach(i => { g.fillStyle = i % 2 ? '#B58E63' : '#8E6B48'; g.beginPath(); g.ellipse(ox + rr() * 140, y + 20 + rr() * (H - y - 40), 3 + rr() * 6, 2 + rr() * 3, 0, 0, 7); g.fill() }) }, 50) }
  else if (o.kind === 'tile') { g.fillStyle = '#E9DCC0'; g.fillRect(0, y, W, H - y); const rows = 5; for (let r = 0; r < rows; r++) { const u0 = r / rows, u1 = (r + 1) / rows, y0 = y + (H - y) * u0 * u0, y1 = y + (H - y) * u1 * u1, sw = lerp(60, 150, u1 * u1) * 1.4; tiled(sw, o.cam * (.5 + u1) + (r % 2 ? sw / 2 : 0), (ox, k) => { g.fillStyle = ((k + r) % 2) ? '#E0D1B0' : '#EADFC6'; g.fillRect(ox + 1, y0 + 1, sw - 2, y1 - y0 - 2) }, 0) } }
  g.restore();
}
const NICE_T = { hills: 'Parallax hills', mountains: 'Mountains', crops: 'Crop rows', water: 'River or sea', ground: 'Ground strip', dunes: 'Sand dunes' };
export function drawDunesAsset(g, t, o0) {
  const o = withDefaults(o0, { cam: 0 }); DUNES.forEach((D, i) => { drawDune(g, D, o.cam); if (i === 1 && o.arches !== false) duneArches(g, D, o.cam) }); foregroundSand(g, o.cam); if (o.tufts !== false) dryTufts(g, t, o.cam);
}
export const assets = {
  'env/hills': mk('env/hills', { title: NICE_T.hills, description: 'Three layers of rolling hills scrolling in parallax; pal = warm | green | dry | cool | night. Use behind villages and farms.', tags: ['terrain', 'hills', 'parallax', 'background', 'landscape'], params: { cam: P('number', 0, 'camera scroll px'), pal: P('string', 'green', 'warm|green|dry|cool|night or 3 colours'), base: P('number', 400, 'ridge y'), amp: P('number', 40, 'hill height') }, bounds: [0, 300, 1280, 420], origin: [0, 0], example: "assets['env/hills'].draw(g,t,{cam:t*100,pal:'green'})" }, drawHills),
  'env/mountains': mk('env/mountains', { title: NICE_T.mountains, description: 'Jagged mountain range with snow caps in parallax. Use for far backgrounds, journeys, cold regions.', tags: ['terrain', 'mountains', 'parallax', 'background', 'snow'], params: { cam: P('number', 0, 'camera px'), base: P('number', 440, 'base y'), col: P('color', '#9DB3BE', 'rock colour'), snow: P('bool', true, 'snow caps'), h: P('number', 220, 'height') }, bounds: [0, 200, 1280, 520], origin: [0, 0] }, drawMountains),
  'env/crops': mk('env/crops', { title: NICE_T.crops, description: 'Ploughed field with receding rows of crop plants (maize by default); rows scroll with cam. Use for farms and agriculture.', tags: ['terrain', 'farm', 'crops', 'field', 'agriculture'], params: { cam: P('number', 0, 'camera px'), y0: P('number', 470, 'field top y'), rows: P('number', 5, 'rows'), kind: P('string', 'crop', 'plant kind'), soil: P('color', '#B98B62', 'soil') }, bounds: [0, 440, 1280, 280], origin: [0, 0] }, drawCropRows),
  'env/water': mk('env/water', { title: NICE_T.water, description: 'River or sea band with animated ripples; kind = river | sea. Use for crossings, boats, coasts.', tags: ['terrain', 'water', 'river', 'sea', 'ripples'], params: { y: P('number', 540, 'top y'), h: P('number', 180, 'band height'), kind: P('string', 'river', 'river|sea'), cam: P('number', 0, 'camera px'), col: P('color', '#7FB8AE', 'water colour') }, bounds: [0, 500, 1280, 220], origin: [0, 0] }, drawWater),
  'env/ground': mk('env/ground', { title: NICE_T.ground, description: 'Ground strip filling from y to the bottom of the frame; kind = street (cobbles), grass, sand, dirt (dirt road) or tile (indoor floor). Scrolls with cam.', tags: ['terrain', 'ground', 'street', 'grass', 'sand', 'dirt', 'tile', 'floor'], params: { kind: P('string', 'street', 'street|grass|sand|dirt|tile'), y: P('number', 520, 'top y'), cam: P('number', 0, 'camera px') }, bounds: [0, 500, 1280, 220], origin: [0, 0] }, drawGround),
  'env/dunes': mk('env/dunes', { title: NICE_T.dunes, description: 'Five layers of golden sand dunes with shaded lee sides, arches and foreground sand, in parallax. Use for desert and journey scenes.', tags: ['terrain', 'desert', 'dunes', 'sand', 'parallax'], params: { cam: P('number', 0, 'camera px'), arches: P('bool', true, 'sandstone arch'), tufts: P('bool', true, 'dry grass tufts') }, bounds: [0, 380, 1280, 340], origin: [0, 0] }, drawDunesAsset),
};

