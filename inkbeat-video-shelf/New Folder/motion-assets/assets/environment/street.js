/**
 * environment/street.js — market stall, cobbled street, bunting and street furniture.
 *
 * stall, cobbleStreet, bunting are exact seed ports (market-street). drawFurniture(g,kind,t,o): lamp_post sign bench bus_stop fence crates traffic_light billboard (FURN_KINDS);
 * traffic_light cycles red/amber/green every 9 s; lamp_post night:true lights it; text param sets the sign / billboard / bus-stop label (keep short).
 * Registered: 'env/street-<kind>'.
 *
 *   assets['env/street-bus_stop'].draw(g,t,{x:640,y:600,text:'BUS 42'});
 */
import { lerp, shade, tiled, rrect, txt } from '../core/core.js';
import { W, H, TOMATO, MUSTARD, GREEN, PINK, CREAM } from '../core/palette.js';

export const FLAGC = [TOMATO, MUSTARD, CREAM, GREEN, PINK];

/** market stall with striped awning and fruit crates (exact v2 stall). x = left, by = ground y; width 300 */
export function stall(g, x, by) {
  const w = 300;
  g.fillStyle = 'rgba(95,50,40,.42)'; g.fillRect(x + 8, by - 172, w - 8, 110);
  g.fillStyle = '#6E4A3C'; g.fillRect(x, by - 200, 8, 200); g.fillRect(x + w - 8, by - 200, 8, 200);
  g.fillStyle = '#8B5E46'; g.fillRect(x + 8, by - 68, w - 16, 68); g.fillStyle = '#A87556'; g.fillRect(x + 4, by - 76, w - 8, 10);
  const prod = [['#F08A24'], ['#F5D142'], ['#8DBB4C'], [TOMATO]];
  [0, 1, 2].forEach(c => {
    const cx = x + 22 + c * 88; g.fillStyle = '#B07A4A'; g.fillRect(cx, by - 112, 76, 36); g.fillStyle = shade('#B07A4A', -.2); g.fillRect(cx, by - 86, 76, 10);
    for (let k = 0; k < 7; k++) { g.fillStyle = prod[(c + k % 2) % 4][0]; g.beginPath(); g.arc(cx + 10 + (k % 4) * 18 + (k > 3 ? 9 : 0), by - 112 - (k > 3 ? 10 : 0) + 2, 9, 0, 7); g.fill() }
  });
  const top = by - 212, bot = by - 150, n = 8, sw = (w + 32) / n;
  for (let i = 0; i < n; i++) {
    const c = i % 2 ? CREAM : TOMATO, x0 = x - 16 + i * sw;
    g.fillStyle = c; g.beginPath(); g.moveTo(x + i * (w / n), top); g.lineTo(x + (i + 1) * (w / n), top); g.lineTo(x0 + sw, bot); g.lineTo(x0, bot); g.closePath(); g.fill();
    g.beginPath(); g.arc(x0 + sw / 2, bot, sw / 2, 0, Math.PI); g.fill()
  }
  g.fillStyle = 'rgba(90,40,30,.18)'; g.fillRect(x - 16, bot + 2, w + 32, 6);
}
/** cobblestone street (exact v2 street). off = scroll px (rows scroll at slightly different speeds) */
export function cobbleStreet(g, off) {
  g.fillStyle = '#E7CBAA'; g.fillRect(0, 520, W, 48);
  g.fillStyle = '#CBA584'; g.fillRect(0, 562, W, 7);
  const rows = [569, 591, 617, 649, 687, 725], pal = ['#DDBB9C', '#D2AE90', '#E3C5A8', '#CDA386'];
  for (let r = 0; r < 5; r++) {
    const y0 = rows[r], y1 = rows[r + 1], sh = y1 - y0, sw = sh * 2.5, o = off * (.84 + r * .045) + (r % 2 ? sw / 2 : 0);
    g.fillStyle = '#B98B72'; g.fillRect(0, y0, W, sh);
    tiled(sw, o, (ox, k) => { g.fillStyle = pal[((k * 7 + r * 3) % 4 + 4) % 4]; rrect(g, ox + 1.5, y0 + 2, sw - 4, sh - 4, 7); g.fill() }, 0)
  }
}
/** flag bunting strings across the screen (exact v2 bunting) */
export function bunting(g, t, off, y0, sag, per, seed) {
  tiled(per, off, (ox, k) => {
    const x0 = ox, x1 = ox + per;
    g.strokeStyle = 'rgba(34,30,26,.6)'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2, y0 + sag * 2, x1, y0); g.stroke();
    for (let i = 1; i <= 11; i++) {
      const u = i / 12, fx = lerp(x0, x1, u);
      const yy = y0 + sag * 2 * u * (1 - u) * 1; g.save(); g.translate(fx, yy); g.rotate(Math.sin(t * 2.2 + i * .7 + k) * .12);
      g.fillStyle = FLAGC[(i + k + seed) % 5]; g.beginPath(); g.moveTo(-15, 0); g.lineTo(15, 0); g.lineTo(0, 36); g.closePath(); g.fill(); g.restore()
    }
  }, 200)
}
const ASSETS = {};

// ============================================================== street furniture (anchor: ground point x,y)
import { mk, P, XY, withDefaults } from './_meta.js';
import { INK, SHADOW, AQUA, LEAF, SERIF } from '../core/palette.js';
const WOOD = '#8A5A32', METAL = '#5E5A56';
export const FURN_KINDS = ['lamp_post', 'sign', 'bench', 'bus_stop', 'fence', 'crates', 'traffic_light', 'billboard'];
/** street furniture. kind: lamp_post sign bench bus_stop fence crates traffic_light billboard. o={x,y,s,text,night (lamp lit),phase (traffic light seconds offset),col,w} */
export function drawFurniture(g, kind, t, o = {}) {
  g.save(); g.translate(o.x ?? 640, o.y ?? 560); g.scale(o.s ?? 1, o.s ?? 1);
  switch (kind) {
    case 'lamp_post': {
      g.fillStyle = METAL; g.fillRect(-4, -170, 8, 170); g.fillRect(-12, -6, 24, 6); g.beginPath(); g.moveTo(-3, -170); g.quadraticCurveTo(-3, -190, 18, -190); g.lineTo(18, -184); g.quadraticCurveTo(4, -184, 4, -170); g.fill();
      const lit = o.night ? 1 : 0, fl = lit ? .92 + .08 * Math.sin(t * 9) : 0; g.fillStyle = lit ? '#FFE7A6' : '#E9DFC8'; g.beginPath(); g.moveTo(10, -184); g.lineTo(32, -184); g.lineTo(28, -172); g.lineTo(14, -172); g.closePath(); g.fill();
      if (lit) { g.fillStyle = `rgba(255,231,166,${.18 * fl})`; g.beginPath(); g.moveTo(14, -172); g.lineTo(28, -172); g.lineTo(70, 0); g.lineTo(-28, 0); g.closePath(); g.fill() } g.fillStyle = METAL; g.fillRect(8, -188, 26, 5); break }
    case 'sign': {
      g.fillStyle = METAL; g.fillRect(-3, -120, 6, 120); const c = o.col || TOMATO; g.fillStyle = c; rrect(g, -34, -150, 68, 44, 8); g.fill(); g.fillStyle = CREAM; rrect(g, -29, -145, 58, 34, 5); g.fill(); txt(g, o.text || 'STOP', 0, -122, { s: 15, al: 'center', c: INK }); break }
    case 'bench': {
      g.fillStyle = WOOD; for (let i = 0; i < 3; i++) g.fillRect(-48, -52 + i * 10, 96, 7); g.fillRect(-48, -24, 96, 8); g.fillStyle = METAL; g.fillRect(-44, -24, 6, 24); g.fillRect(38, -24, 6, 24); g.fillRect(-46, -56, 6, 36); g.fillRect(40, -56, 6, 36); g.fillStyle = shade(WOOD, -.2); g.fillRect(-48, -17, 96, 3); break }
    case 'bus_stop': {
      const w = o.w || 190; g.fillStyle = 'rgba(207,230,220,.55)'; g.fillRect(-w / 2 + 6, -150, w - 12, 128); g.fillStyle = METAL; g.fillRect(-w / 2, -158, w, 8); g.fillRect(-w / 2, -150, 6, 150); g.fillRect(w / 2 - 6, -150, 6, 150); g.fillStyle = WOOD; g.fillRect(-w / 2 + 14, -46, w - 60, 8); g.fillRect(-w / 2 + 20, -38, 5, 38); g.fillRect(w / 2 - 70, -38, 5, 38);
      g.fillStyle = GREEN; g.fillRect(w / 2 + 14, -190, 6, 190); g.fillStyle = GREEN; rrect(g, w / 2 - 12, -190, 62, 34, 6); g.fill(); txt(g, o.text || 'BUS', w / 2 + 19, -167, { s: 17, al: 'center', c: CREAM }); g.fillStyle = TOMATO; g.fillRect(-w / 2 + 14, -138, 56, 16); break }
    case 'fence': {
      const w = o.w || 300, n = Math.round(w / 22); g.fillStyle = o.col || '#D9B88A'; for (let i = 0; i <= n; i++) { const x = -w / 2 + i * (w / n); g.beginPath(); g.moveTo(x - 6, 0); g.lineTo(x - 6, -58); g.lineTo(x, -66); g.lineTo(x + 6, -58); g.lineTo(x + 6, 0); g.closePath(); g.fill() } g.fillStyle = shade(o.col || '#D9B88A', -.18); g.fillRect(-w / 2 - 6, -44, w + 12, 7); g.fillRect(-w / 2 - 6, -20, w + 12, 7); break }
    case 'crates': {
      const c = o.col || '#B07A4A'; [[-26, 0, 50], [26, 0, 46], [0, -48, 48]].forEach(([x, y, w], i) => { g.fillStyle = i === 2 ? shade(c, .08) : c; g.fillRect(x - w / 2, y - 46, w, 46); g.strokeStyle = shade(c, -.3); g.lineWidth = 3; g.strokeRect(x - w / 2 + 3, y - 43, w - 6, 40); g.beginPath(); g.moveTo(x - w / 2 + 3, y - 43); g.lineTo(x + w / 2 - 3, y - 3); g.stroke() }); [[-30, -50, TOMATO], [-18, -50, MUSTARD], [-6, -50, GREEN]].forEach(([x, y, c]) => { g.fillStyle = c; g.beginPath(); g.arc(x + 20, y - 48, 7, 0, 7); g.fill() }); break }
    case 'traffic_light': {
      g.fillStyle = METAL; g.fillRect(-4, -150, 8, 150); g.fillStyle = INK; rrect(g, -16, -190, 32, 78, 8); g.fill(); const ph = ((t + (o.phase || 0)) % 9 + 9) % 9, st = ph < 4 ? 0 : ph < 5 ? 1 : 2; [[TOMATO, 0, -176], [MUSTARD, 1, -151], [GREEN, 2, -126]].forEach(([c, i, y]) => { g.fillStyle = i === (st === 0 ? 0 : st === 1 ? 1 : 2) ? c : shade(c, -.7); g.beginPath(); g.arc(0, y, 9, 0, 7); g.fill() }); g.fillStyle = 'rgba(255,255,255,.3)'; g.beginPath(); g.arc(-3, -179, 2.6, 0, 7); g.fill(); break }
    case 'billboard': {
      const w = o.w || 230, h = 112; g.fillStyle = METAL; g.fillRect(-w * .3, -h - 90, 8, h + 90); g.fillRect(w * .3 - 8, -h - 90, 8, h + 90); g.fillStyle = INK; rrect(g, -w / 2, -h - 150, w, h + 6, 6); g.fill(); g.fillStyle = o.col || MUSTARD; rrect(g, -w / 2 + 6, -h - 144, w - 12, h - 6, 4); g.fill(); txt(g, o.text || 'FRESH TODAY', 0, -h - 96, { s: 28, f: SERIF, al: 'center', c: INK }); g.fillStyle = TOMATO; g.beginPath(); g.arc(0, -h - 70, 10, 0, 7); g.fill(); break }
  }
  g.restore();
}
const FNICE = { lamp_post: 'Lamp post', sign: 'Street sign', bench: 'Bench', bus_stop: 'Bus stop shelter', fence: 'Fence', crates: 'Stacked crates', traffic_light: 'Traffic light', billboard: 'Billboard' };
Object.assign(ASSETS, Object.fromEntries(FURN_KINDS.map(k => ['env/street-' + k, mk('env/street-' + k, { title: FNICE[k], description: `${FNICE[k]} at its ground point (street furniture).${k === 'traffic_light' ? ' Cycles red, amber, green every 9 s.' : ''}${k === 'lamp_post' ? ' night:true lights it with a soft flicker.' : ''}`, tags: ['street', 'furniture', k, 'city'], params: { ...XY, text: P('string', null, 'sign / billboard text'), night: P('bool', false, 'lamp lit'), w: P('number', null, 'width (fence, bus stop, billboard)'), col: P('color', null, 'colour') }, bounds: [-120, -230, 240, 240], origin: [0, 0], example: `assets['env/street-${k}'].draw(g,t,{x:640,y:560})`, markerKinds: k === 'traffic_light' ? ['chime'] : [] }, (g, t, p) => drawFurniture(g, k, t, { x: 640, y: 560, s: 1, ...(p || {}) }), k === 'traffic_light' ? (p => { const ph = ((p && p.phase) || 0); const m = []; for (let k2 = 0; k2 < 3; k2++) { m.push({ id: 'green' + k2, t: 9 * k2 + 5 - ph, kind: 'chime' }) } return m.filter(q => q.t >= 0) }) : undefined)])));

export const assets = ASSETS;

