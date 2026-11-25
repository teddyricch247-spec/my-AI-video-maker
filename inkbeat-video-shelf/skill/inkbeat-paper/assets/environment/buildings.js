/**
 * environment/buildings.js — houses, shop fronts, apartment blocks, towers, huts.
 *
 * houseRow(g,t,off,by) is the exact market-street row; houseVariant(g,v,x,by,t,o) draws one of 8 house variants (HOUSE_NAMES); shopFront(g,v,x,by,t,o) one of 4 shops (SHOP_NAMES, text = sign);
 * drawBuilding(g,kind,x,by,t,o): apartment office_tower school clinic warehouse kiosk hut_a hut_b hut_c water_tower (BUILDING_KINDS). x = centre, by = ground line.
 * Registered: 'env/house-0..7', 'env/shop-<name>', 'env/building-<kind>' (params x,y,s plus wall colour / sign text).
 *
 *   assets['env/shop-bakery'].draw(g,t,{x:640,y:560,text:'BAKERY'});
 */
import { lerp, rng, shade, tiled, txt } from '../core/core.js';
import { W, H, TOMATO, MUSTARD, GREEN, PINK, CREAM, INK } from '../core/palette.js';
import { rrect } from '../core/core.js';
import { mk, P, XY, withDefaults } from './_meta.js';
import { FLAGC } from './street.js';

/** the market row of 12 seeded houses (exact v2 data) */
export const MK = (() => {
  const r = rng(11), walls = ['#F3DFC1', '#F0C9A6', '#E9B4A0', '#E8D49A', '#CFD8B0', '#F4E6D0'], roofs = ['#C4553A', '#B84A33', '#D06A45'], shut = [GREEN, TOMATO, '#5E8C8A', MUSTARD];
  const hs = []; let x = 0;
  for (let i = 0; i < 12; i++) {
    const w = 170 + (r() * 70 | 0), h = 250 + (r() * 90 | 0), wall = walls[i % walls.length];
    hs.push({ x, w, h, wall, shade: shade(wall, -.16), roof: roofs[i % 3], shut: shut[(i * 2 + 1) % 4], floors: h > 305 ? 3 : 2, lit: [r() < .5, r() < .4, r() < .5, r() < .4, r() < .5, r() < .4], flag: r() < .85, chim: r() < .5, gap: 46 + (r() * 40 | 0), fl: [r(), r(), r(), r(), r(), r()] });
    x += w + hs[i].gap
  }
  return { hs, P: x }
})();

/** terraced house with shutters, flower boxes, arched door (exact v2 drawHouse). h = house spec, x = left, by = ground y */
export function drawHouse(g, h, x, by) {
  g.fillStyle = h.wall; g.fillRect(x, by - h.h, h.w, h.h);
  g.fillStyle = h.shade; g.fillRect(x + h.w * .8, by - h.h, h.w * .2, h.h);
  if (h.chim) { g.fillStyle = shade(h.roof, -.1); g.fillRect(x + h.w * .64, by - h.h - 90, 20, 44) }
  const rt = by - h.h - 60;
  g.fillStyle = h.roof; g.beginPath(); g.moveTo(x - 12, by - h.h + 2); g.lineTo(x + h.w * .16, rt); g.lineTo(x + h.w * .84, rt); g.lineTo(x + h.w + 12, by - h.h + 2); g.closePath(); g.fill();
  g.fillStyle = shade(h.roof, -.2); g.beginPath(); g.moveTo(x + h.w * .84, rt); g.lineTo(x + h.w + 12, by - h.h + 2); g.lineTo(x + h.w * .72, by - h.h + 2); g.lineTo(x + h.w * .7, rt); g.closePath(); g.fill();
  g.strokeStyle = shade(h.roof, -.24); g.lineWidth = 2;
  for (let k = 1; k < 4; k++) { const yy = rt + k * 15.5, q = (yy - rt) / 62; g.beginPath(); g.moveTo(lerp(x + h.w * .16, x - 12, q), yy); g.lineTo(lerp(x + h.w * .84, x + h.w + 12, q), yy); g.stroke() }
  g.fillStyle = 'rgba(90,40,30,.2)'; g.fillRect(x, by - h.h + 2, h.w, 12);
  const y0 = by - h.h + 36, y1 = by - 132, ys = h.floors === 3 ? [y0, (y0 + y1) / 2, y1] : [y0, y1];
  ys.forEach((wy, ri) => [.2, .56].forEach((cx, ci) => {
    const wx = x + h.w * cx, lit = h.lit[ri * 2 + ci];
    g.fillStyle = h.shut; g.fillRect(wx - 10, wy, 9, 46); g.fillRect(wx + 31, wy, 9, 46);
    g.fillStyle = lit ? '#FFE7A6' : '#6B4A42'; g.fillRect(wx, wy, 30, 46);
    g.fillStyle = h.wall; g.fillRect(wx + 13, wy, 4, 46); g.fillRect(wx, wy + 21, 30, 4);
    g.fillStyle = shade(h.wall, -.25); g.fillRect(wx - 6, wy + 46, 42, 5);
    if (h.fl[ri * 2 + ci] < .4) { g.fillStyle = '#6E4A3C'; g.fillRect(wx - 4, wy + 50, 38, 9);[TOMATO, PINK, MUSTARD, TOMATO].forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc(wx + 2 + i * 10, wy + 49, 5, 0, 7); g.fill() }) }
  }));
  const dx = x + h.w * .36; g.fillStyle = shade(h.shut, -.15); g.beginPath(); g.moveTo(dx, by); g.lineTo(dx, by - 62); g.arc(dx + 20, by - 62, 20, Math.PI, 0); g.lineTo(dx + 40, by); g.closePath(); g.fill();
  g.fillStyle = shade(h.wall, -.3); g.fillRect(dx - 6, by - 6, 52, 6); g.fillStyle = CREAM; g.beginPath(); g.arc(dx + 32, by - 30, 2.6, 0, 7); g.fill();
}
/** row of houses with alley depth and flag strings between them (exact v2 houseRow). off = scroll px */
export function houseRow(g, t, off, by) {
  tiled(MK.P, off, (ox) => {
    MK.hs.forEach((h, i) => {
      const x = ox + h.x; if (x > W + 40 || x + h.w < -40 - h.gap) return;
      g.fillStyle = '#BE8573'; g.fillRect(x + h.w, by - 330, h.gap, 330);
      drawHouse(g, h, x, by);
      if (h.flag) {
        const x1 = x + h.w - 4, x2 = x + h.w + h.gap + 4, ly = by - 176;
        g.strokeStyle = 'rgba(34,30,26,.55)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x1, ly); g.quadraticCurveTo((x1 + x2) / 2, ly + 26, x2, ly + 2); g.stroke();
        const n = Math.max(2, Math.floor(h.gap / 16));
        for (let k = 1; k <= n; k++) {
          const u = k / (n + 1), fx = lerp(x1, x2, u), fy = ly + 26 * 2 * u * (1 - u) + u * 2;
          g.save(); g.translate(fx, fy); g.rotate(Math.sin(t * 2.4 + i + k) * .14); g.fillStyle = FLAGC[(i + k) % 5]; g.fillRect(-6, 0, 12, 20); g.restore()
        }
      }
    })
  }, 500)
}

// ============================================================== NEW BUILDINGS (anchor: bottom-centre at (x,by); sizes at s=1)
const WALLS = ['#F3DFC1', '#F0C9A6', '#E9B4A0', '#E8D49A', '#CFD8B0', '#F4E6D0', '#E3C0B0', '#D9E0C2'];
const win = (g, x, y, w, h, lit, shut, wall) => { if (shut) { g.fillStyle = shut; g.fillRect(x - 8, y, 7, h); g.fillRect(x + w + 1, y, 7, h) } g.fillStyle = lit ? '#FFE7A6' : '#6B4A42'; g.fillRect(x, y, w, h); g.fillStyle = wall; g.fillRect(x + w / 2 - 2, y, 4, h); g.fillRect(x, y + h / 2 - 2, w, 4); g.fillStyle = shade(wall, -.25); g.fillRect(x - 4, y + h, w + 8, 4) };
const door = (g, x, by, col, wall, round = true, w = 38) => { g.fillStyle = col; g.beginPath(); g.moveTo(x, by); g.lineTo(x, by - 56); if (round) g.arc(x + w / 2, by - 56, w / 2, Math.PI, 0); else g.lineTo(x + w, by - 56); g.lineTo(x + w, by); g.closePath(); g.fill(); g.fillStyle = CREAM; g.beginPath(); g.arc(x + w - 7, by - 28, 2.4, 0, 7); g.fill(); g.fillStyle = shade(wall, -.3); g.fillRect(x - 5, by - 5, w + 10, 5) };
/** eight house variants. v = 0..7 */
export const HOUSE_NAMES = ['terraced-2', 'terraced-3', 'flat-roof-balcony', 'gable-attic', 'bungalow', 'hip-roof-chimney', 'tin-roof-shack', 'townhouse-dormer'];
export function houseVariant(g, v, x, by, t = 0, o = {}) {
  v = ((v % 8) + 8) % 8; const wall = o.wall || WALLS[v], roofs = ['#C4553A', '#B84A33', '#D06A45', '#A5503A', '#8E9A6B', '#B5603F', '#8A8F94', '#9A4B3A'], roof = o.roof || roofs[v], shut = o.shut || [GREEN, TOMATO, '#5E8C8A', MUSTARD][v % 4];
  const sp = [[190, 280], [190, 340], [210, 270], [180, 250], [290, 170], [230, 240], [170, 150], [200, 300]][v], [w, h] = sp, L = x - w / 2; const lit = i => ((v * 7 + i * 5) % 3) !== 0;
  g.save();
  if (v < 2) { drawHouse(g, { x: 0, w, h, wall, shade: shade(wall, -.16), roof, shut, floors: v ? 3 : 2, lit: [1, 0, 1, 1, 0, 1].map(Boolean), flag: 0, chim: v === 0, gap: 40, fl: [.2, .8, .3, .9, .8, .2] }, L, by) }
  else {
    g.fillStyle = wall; g.fillRect(L, by - h, w, h); g.fillStyle = shade(wall, -.16); g.fillRect(L + w * .82, by - h, w * .18, h);
    if (v === 2) { g.fillStyle = shade(roof, -.1); g.fillRect(L - 6, by - h - 14, w + 12, 16); g.fillStyle = shade(wall, .06); g.fillRect(L, by - h + 2, w, 8); [0, 1].forEach(r => [.2, .62].forEach((cx, ci) => win(g, L + w * cx, by - h + 34 + r * 96, 34, 50, lit(r * 2 + ci), shut, wall))); g.fillStyle = INK; g.globalAlpha = .75; g.fillRect(L + w * .1, by - h + 140, w * .56, 4); for (let i = 0; i < 9; i++) g.fillRect(L + w * .1 + i * (w * .56 / 8), by - h + 118, 3, 26); g.globalAlpha = 1; door(g, L + w * .72, by, shut, wall, false, 36) }
    if (v === 3) { g.fillStyle = roof; g.beginPath(); g.moveTo(L - 12, by - h + 4); g.lineTo(x, by - h - 78); g.lineTo(L + w + 12, by - h + 4); g.closePath(); g.fill(); g.fillStyle = shade(roof, -.2); g.beginPath(); g.moveTo(x, by - h - 78); g.lineTo(L + w + 12, by - h + 4); g.lineTo(x + 6, by - h + 4); g.closePath(); g.fill(); g.fillStyle = CREAM; g.beginPath(); g.arc(x, by - h - 22, 17, 0, 7); g.fill(); g.fillStyle = '#6B4A42'; g.beginPath(); g.arc(x, by - h - 22, 12, 0, 7); g.fill(); [[.24], [.62]].forEach(([cx], ci) => win(g, L + w * cx, by - h + 40, 34, 46, lit(ci), shut, wall)); [[.24], [.62]].forEach(([cx], ci) => win(g, L + w * cx, by - h + 116, 34, 46, lit(ci + 3), shut, wall)); door(g, x - 19, by, shut, wall) }
    if (v === 4) { g.fillStyle = roof; g.beginPath(); g.moveTo(L - 14, by - h + 2); g.lineTo(L + 40, by - h - 48); g.lineTo(L + w - 40, by - h - 48); g.lineTo(L + w + 14, by - h + 2); g.closePath(); g.fill(); g.fillStyle = shade(roof, -.18); g.beginPath(); g.moveTo(L + w - 40, by - h - 48); g.lineTo(L + w + 14, by - h + 2); g.lineTo(L + w - 60, by - h + 2); g.closePath(); g.fill(); [.14, .4, .76].forEach((cx, ci) => win(g, L + w * cx, by - h + 34, 38, 56, lit(ci), shut, wall)); door(g, L + w * .56, by, shut, wall); g.fillStyle = shade(wall, -.22); g.fillRect(L - 4, by - 6, w + 8, 6) }
    if (v === 5) { g.fillStyle = shade(roof, -.1); g.fillRect(L + w * .66, by - h - 70, 22, 50); g.fillStyle = roof; g.beginPath(); g.moveTo(L - 12, by - h + 2); g.lineTo(L + 30, by - h - 56); g.lineTo(L + w - 30, by - h - 56); g.lineTo(L + w + 12, by - h + 2); g.closePath(); g.fill(); g.fillStyle = shade(roof, -.2); g.beginPath(); g.moveTo(L + w - 30, by - h - 56); g.lineTo(L + w + 12, by - h + 2); g.lineTo(L + w - 46, by - h + 2); g.closePath(); g.fill(); g.strokeStyle = shade(roof, -.24); g.lineWidth = 2; for (let k = 1; k < 4; k++) { const yy = by - h - 56 + k * 14; g.beginPath(); g.moveTo(lerp(L + 30, L - 12, k / 4), yy); g.lineTo(lerp(L + w - 30, L + w + 12, k / 4), yy); g.stroke() } [[.22, 0], [.58, 0], [.22, 1], [.58, 1]].forEach(([cx, r], ci) => win(g, L + w * cx, by - h + 30 + r * 80, 32, 44, lit(ci), shut, wall)); door(g, L + w * .4, by - 0, shut, wall, true, 34) }
    if (v === 6) { g.fillStyle = roof; g.beginPath(); g.moveTo(L - 14, by - h + 8); g.lineTo(L + 20, by - h - 26); g.lineTo(L + w - 8, by - h - 26); g.lineTo(L + w + 14, by - h + 8); g.closePath(); g.fill(); g.strokeStyle = shade(roof, -.2); g.lineWidth = 2.4; for (let i = 0; i < 12; i++) { const px = L + 12 + i * 14; g.beginPath(); g.moveTo(px, by - h - 24); g.lineTo(px - 8, by - h + 8); g.stroke() } win(g, L + 22, by - h + 40, 34, 40, lit(0), shut, wall); door(g, L + w - 64, by, shut, wall, false, 34); g.fillStyle = '#8A5A32'; g.fillRect(L + w + 6, by - 26, 24, 26); g.fillStyle = '#6E4A3C'; g.fillRect(L + w + 6, by - 30, 24, 5) }
    if (v === 7) { g.fillStyle = roof; g.beginPath(); g.moveTo(L - 12, by - h + 2); g.lineTo(L + 28, by - h - 52); g.lineTo(L + w - 28, by - h - 52); g.lineTo(L + w + 12, by - h + 2); g.closePath(); g.fill(); g.fillStyle = wall; g.fillRect(x - 20, by - h - 30, 40, 36); g.fillStyle = roof; g.beginPath(); g.moveTo(x - 26, by - h - 30); g.lineTo(x, by - h - 58); g.lineTo(x + 26, by - h - 30); g.closePath(); g.fill(); g.fillStyle = lit(0) ? '#FFE7A6' : '#6B4A42'; g.fillRect(x - 9, by - h - 24, 18, 22); [0, 1, 2].forEach(r => [.2, .62].forEach((cx, ci) => win(g, L + w * cx, by - h + 28 + r * 80, 30, 42, lit(r * 2 + ci), shut, wall))); door(g, x - 19, by, shut, wall) }
  }
  g.restore();
}
/** four shop fronts with striped awnings. v = 0 bakery, 1 grocer, 2 tailor, 3 cafe */
export const SHOP_NAMES = ['bakery', 'grocer', 'tailor', 'cafe'];
export function shopFront(g, v, x, by, t = 0, o = {}) {
  v = ((v % 4) + 4) % 4; const cols = [[TOMATO, CREAM], [GREEN, CREAM], [MUSTARD, CREAM], ['#5E8C8A', CREAM]][v], wall = o.wall || WALLS[v + 2], w = 250, h = 200, L = x - w / 2, name = o.text || SHOP_NAMES[v].toUpperCase();
  g.save(); g.fillStyle = wall; g.fillRect(L, by - h, w, h); g.fillStyle = shade(wall, -.16); g.fillRect(L + w - 22, by - h, 22, h);
  g.fillStyle = '#6B4A42'; g.fillRect(L + 22, by - 124, w - 74, 108); g.fillStyle = '#FFE7A6'; g.globalAlpha = .55; g.fillRect(L + 26, by - 120, w - 82, 100); g.globalAlpha = 1;
  g.fillStyle = '#8B5E46'; g.fillRect(L + 18, by - 50, w - 66, 34); g.fillStyle = '#A87556'; g.fillRect(L + 14, by - 56, w - 58, 7);
  // goods
  const good = [['#E8B86A', 14, 10], ['#C4653F', 10, 14], ['#8DBB4C', 9, 9], ['#F2A3B5', 12, 12]][v];
  for (let i = 0; i < 6; i++) { g.fillStyle = [good[0], shade(good[0], -.12), shade(good[0], .1)][i % 3]; g.beginPath(); g.ellipse(L + 44 + i * 26, by - 64 - (i % 2) * 4, good[1], good[2], 0, 0, 7); g.fill() }
  if (v === 3) { g.fillStyle = CREAM; g.beginPath(); g.arc(L + 70, by - 96, 14, 0, 7); g.fill(); g.fillStyle = '#7A4A32'; g.beginPath(); g.arc(L + 70, by - 96, 9, 0, 7); g.fill() }
  if (v === 2) { g.strokeStyle = INK; g.lineWidth = 2; g.beginPath(); g.moveTo(L + 40, by - 118); g.lineTo(L + w - 70, by - 118); g.stroke(); [0, 1, 2].forEach(i => { g.fillStyle = [TOMATO, MUSTARD, PINK][i]; g.fillRect(L + 52 + i * 40, by - 116, 22, 46) }) }
  door(g, L + w - 48, by, cols[0], wall, false, 30);
  const n = 8, top = by - 168, bot = by - 128, aw = w + 40, sw = aw / n;
  g.fillStyle = shade(wall, -.3); g.fillRect(L - 2, by - h + 6, w + 4, 30); g.fillStyle = CREAM; rrect(g, L + 22, by - h + 10, w - 44, 22, 4); g.fill(); txt(g, name, x, by - h + 26, { s: 14, al: 'center', c: INK });
  for (let i = 0; i < n; i++) { const x0 = L - 20 + i * sw; g.fillStyle = cols[i % 2]; g.beginPath(); g.moveTo(x0 + 6, top); g.lineTo(x0 + sw - 6, top); g.lineTo(x0 + sw, bot); g.lineTo(x0, bot); g.closePath(); g.fill(); g.beginPath(); g.arc(x0 + sw / 2, bot, sw / 2, 0, Math.PI); g.fill() }
  g.fillStyle = 'rgba(90,40,30,.18)'; g.fillRect(L - 20, bot + 2, aw, 5); g.restore();
}
function tower(g, x, by, floors, w, wall, glass, flat = true, t = 0, seed = 0) {
  const fh = 44, h = floors * fh + 20, L = x - w / 2; g.fillStyle = wall; g.fillRect(L, by - h, w, h); g.fillStyle = shade(wall, -.15); g.fillRect(L + w * .8, by - h, w * .2, h); g.fillStyle = shade(wall, .12); g.fillRect(L - 4, by - h - 8, w + 8, 10);
  const cols = Math.max(2, Math.floor((w - 24) / 38)); for (let r = 0; r < floors; r++) for (let c = 0; c < cols; c++) { const wx = L + 14 + c * ((w - 28) / cols), lit = (((r * 5 + c * 3 + seed) % 5) < 2); g.fillStyle = lit ? '#FFE7A6' : glass; g.fillRect(wx, by - h + 16 + r * fh, (w - 28) / cols - 8, 26) }
  g.fillStyle = shade(wall, -.3); g.fillRect(x - 20, by - 50, 40, 50); g.fillStyle = '#6B4A42'; g.fillRect(x - 16, by - 46, 32, 46); g.fillStyle = '#FFE7A6'; g.globalAlpha = .3; g.fillRect(x - 16, by - 46, 32, 46); g.globalAlpha = 1; return h;
}
export const BUILDING_KINDS = ['apartment', 'office_tower', 'school', 'clinic', 'warehouse', 'kiosk', 'hut_a', 'hut_b', 'hut_c', 'water_tower'];
export function drawBuilding(g, kind, x, by, t = 0, o = {}) {
  g.save();
  switch (kind) {
    case 'apartment': { const h = tower(g, x, by, 5, 210, o.wall || '#E3C0B0', '#6B4A42', true, t, 1); for (let r = 0; r < 4; r++) { g.fillStyle = INK; g.globalAlpha = .6; g.fillRect(x - 100, by - 60 - r * 44, 38, 3); g.globalAlpha = 1 } g.fillStyle = '#8E8A84'; g.fillRect(x + 60, by - h - 24, 30, 18); g.fillRect(x - 70, by - h - 30, 4, 24); break }
    case 'office_tower': { const w = 170, floors = 12, h = floors * 40 + 20, L = x - w / 2; g.fillStyle = o.wall || '#9DB8C9'; g.fillRect(L, by - h, w, h); g.fillStyle = shade(o.wall || '#9DB8C9', -.14); g.fillRect(L + w * .78, by - h, w * .22, h); for (let r = 0; r < floors; r++) for (let c = 0; c < 4; c++) { const lit = (((r * 3 + c * 7) % 7) < 2); g.fillStyle = lit ? '#FFE7A6' : '#DDE8EE'; g.globalAlpha = lit ? 1 : .8; g.fillRect(L + 12 + c * 38, by - h + 14 + r * 40, 26, 24); g.globalAlpha = 1 } g.fillStyle = '#6E7C86'; g.fillRect(L - 6, by - h - 10, w + 12, 12); g.fillRect(x - 3, by - h - 52, 6, 44); g.fillStyle = TOMATO; g.beginPath(); g.arc(x, by - h - 54, 4, 0, 7); g.fill(); g.fillStyle = '#6E7C86'; g.fillRect(x - 24, by - 54, 48, 54); g.fillStyle = '#FFE7A6'; g.globalAlpha = .4; g.fillRect(x - 20, by - 50, 40, 50); g.globalAlpha = 1; break }
    case 'school': { const w = 330, h = 150, L = x - w / 2, wall = o.wall || '#E8D49A'; g.fillStyle = wall; g.fillRect(L, by - h, w, h); g.fillStyle = shade(wall, -.15); g.fillRect(L + w - 30, by - h, 30, h); g.fillStyle = TOMATO; g.fillRect(L - 8, by - h - 14, w + 16, 18); g.fillStyle = shade(wall, .1); g.beginPath(); g.moveTo(x - 50, by - h - 14); g.lineTo(x, by - h - 70); g.lineTo(x + 50, by - h - 14); g.closePath(); g.fill(); g.fillStyle = CREAM; g.beginPath(); g.arc(x, by - h - 36, 14, 0, 7); g.fill(); g.strokeStyle = INK; g.lineWidth = 2.4; g.beginPath(); g.moveTo(x, by - h - 36); g.lineTo(x, by - h - 46); g.moveTo(x, by - h - 36); g.lineTo(x + 7, by - h - 34); g.stroke(); [0, 1, 2, 3, 4].forEach(i => { if (i === 2) return; win(g, L + 20 + i * 62, by - h + 34, 34, 46, i % 2 === 0, GREEN, wall) }); door(g, x - 21, by, GREEN, wall, true, 42); g.strokeStyle = INK; g.lineWidth = 2.6; g.beginPath(); g.moveTo(L + w - 12, by - h - 6); g.lineTo(L + w - 12, by - h - 50); g.stroke(); const wv = Math.sin(t * 4) * 3; g.fillStyle = MUSTARD; g.beginPath(); g.moveTo(L + w - 12, by - h - 50); g.lineTo(L + w + 14, by - h - 46 + wv); g.lineTo(L + w - 12, by - h - 34); g.fill(); break }
    case 'clinic': { const w = 280, h = 140, L = x - w / 2, wall = o.wall || '#F4E6D0'; g.fillStyle = wall; g.fillRect(L, by - h, w, h); g.fillStyle = shade(wall, -.15); g.fillRect(L + w - 26, by - h, 26, h); g.fillStyle = '#7EB09E'; g.fillRect(L - 6, by - h - 12, w + 12, 16); g.fillStyle = TOMATO; rrect(g, x - 20, by - h + 12, 40, 40, 6); g.fill(); g.fillStyle = CREAM; g.fillRect(x - 5, by - h + 18, 10, 28); g.fillRect(x - 14, by - h + 27, 28, 10);[0, 1, 3, 4].forEach((i) => win(g, L + 20 + i * 52, by - h + 62, 32, 40, true, null, wall)); door(g, x - 17, by, '#7EB09E', wall, false, 34); g.fillStyle = '#7EB09E'; g.fillRect(L + 6, by - 12, w - 12, 8); break }
    case 'warehouse': { const w = 340, h = 130, L = x - w / 2, wall = o.wall || '#B9A98E'; g.fillStyle = wall; g.fillRect(L, by - h, w, h); g.fillStyle = '#8A8F94'; g.beginPath(); g.moveTo(L - 10, by - h + 4); g.lineTo(L + 30, by - h - 36); g.lineTo(L + w - 30, by - h - 36); g.lineTo(L + w + 10, by - h + 4); g.closePath(); g.fill(); g.strokeStyle = shade('#8A8F94', -.2); g.lineWidth = 2; for (let i = 0; i < 14; i++) { g.beginPath(); g.moveTo(L + 30 + i * 20, by - h - 34); g.lineTo(L + 20 + i * 21, by - h + 2); g.stroke() } g.fillStyle = shade(wall, -.2); g.fillRect(L + 30, by - 98, 120, 98); g.fillRect(L + 170, by - 98, 120, 98); g.strokeStyle = shade(wall, -.4); g.lineWidth = 2; for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(L + 30, by - 98 + i * 16); g.lineTo(L + 150, by - 98 + i * 16); g.moveTo(L + 170, by - 98 + i * 16); g.lineTo(L + 290, by - 98 + i * 16); g.stroke() } g.fillStyle = MUSTARD; g.fillRect(L + 30, by - 114, 260, 8); break }
    case 'kiosk': { const w = 120, h = 100, L = x - w / 2; g.fillStyle = o.wall || MUSTARD; g.fillRect(L, by - h, w, h); g.fillStyle = shade(o.wall || MUSTARD, -.15); g.fillRect(L + w - 18, by - h, 18, h); g.fillStyle = '#6B4A42'; g.fillRect(L + 14, by - 82, w - 42, 40); g.fillStyle = '#FFE7A6'; g.globalAlpha = .6; g.fillRect(L + 17, by - 79, w - 48, 34); g.globalAlpha = 1; g.fillStyle = '#8B5E46'; g.fillRect(L + 8, by - 42, w - 30, 8); for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? CREAM : TOMATO; g.beginPath(); g.moveTo(L - 8 + i * 23, by - 98); g.lineTo(L - 8 + (i + 1) * 23, by - 98); g.lineTo(L - 12 + (i + 1) * 23, by - 74); g.lineTo(L - 12 + i * 23, by - 74); g.closePath(); g.fill() } g.fillStyle = INK; g.globalAlpha = .6; g.fillRect(L + 18, by - 30, 40, 4); g.globalAlpha = 1; break }
    case 'hut_a': case 'hut_b': case 'hut_c': {
      const k = kind.slice(-1), wall = o.wall || { a: '#D9A878', b: '#E3BE8A', c: '#C98E66' }[k], th = { a: '#B8944F', b: '#A57F46', c: '#8E6B3C' }[k], w = { a: 120, b: 100, c: 140 }[k], h = { a: 70, b: 84, c: 62 }[k];
      g.fillStyle = wall; g.beginPath(); g.moveTo(x - w / 2, by); g.lineTo(x - w / 2, by - h); g.quadraticCurveTo(x, by - h - 6, x + w / 2, by - h); g.lineTo(x + w / 2, by); g.closePath(); g.fill(); g.fillStyle = shade(wall, -.16); g.beginPath(); g.moveTo(x + w * .18, by); g.lineTo(x + w * .18, by - h + 2); g.lineTo(x + w / 2, by - h); g.lineTo(x + w / 2, by); g.closePath(); g.fill();
      const rh = { a: 70, b: 80, c: 56 }[k]; g.fillStyle = th; g.beginPath(); g.moveTo(x - w / 2 - 14, by - h + 6); g.quadraticCurveTo(x - w * .2, by - h - rh * .55, x, by - h - rh); g.quadraticCurveTo(x + w * .2, by - h - rh * .55, x + w / 2 + 14, by - h + 6); g.quadraticCurveTo(x, by - h + 16, x - w / 2 - 14, by - h + 6); g.fill(); g.strokeStyle = shade(th, -.22); g.lineWidth = 2; for (let i = 0; i < 6; i++) { const q = (i + 1) / 7; g.beginPath(); g.moveTo(x - w / 2 - 12 + q * (w / 2 + 12), by - h + 8 - q * (rh - 2)); g.quadraticCurveTo(x - 6, by - h + 12 - q * rh * .5, x + w / 2 + 12 - q * (w / 2 + 12), by - h + 8 - q * (rh - 2)); g.stroke() }
      g.fillStyle = '#5A3A2A'; g.beginPath(); g.moveTo(x - 14, by); g.lineTo(x - 14, by - 38); g.arc(x, by - 38, 14, Math.PI, 0); g.lineTo(x + 14, by); g.closePath(); g.fill(); g.strokeStyle = shade(wall, -.28); g.lineWidth = 3; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(x - w / 2 + 6 + i * (w - 12) / 3, by - 14); g.lineTo(x - w / 2 + 12 + i * (w - 12) / 3, by - 22); g.stroke() }
      if (k === 'b') { g.fillStyle = '#6B4A42'; g.fillRect(x + 22, by - 52, 16, 16); g.fillStyle = TOMATO; g.fillRect(x - 40, by - 46, 10, 10) } break
    }
    case 'water_tower': { const c = o.wall || '#B9A98E'; g.strokeStyle = '#6E4A3C'; g.lineWidth = 7; g.lineCap = 'round'; [[-36, -110, -44, 0], [36, -110, 44, 0], [-12, -110, -16, 0], [12, -110, 16, 0]].forEach(([a, b, c2, d]) => { g.beginPath(); g.moveTo(x + a, by + b); g.lineTo(x + c2, by + d); g.stroke() }); g.lineWidth = 4; g.beginPath(); g.moveTo(x - 40, by - 60); g.lineTo(x + 14, by - 20); g.moveTo(x + 40, by - 60); g.lineTo(x - 14, by - 20); g.stroke(); g.fillStyle = '#9A8E7A'; rrect(g, x - 56, by - 190, 112, 82, 10); g.fill(); g.fillStyle = shade('#9A8E7A', -.16); g.beginPath(); g.moveTo(x + 14, by - 190); g.lineTo(x + 56, by - 190); g.lineTo(x + 56, by - 108); g.lineTo(x + 14, by - 108); g.closePath(); g.fill(); g.fillStyle = TOMATO; g.beginPath(); g.moveTo(x - 62, by - 188); g.lineTo(x, by - 224); g.lineTo(x + 62, by - 188); g.closePath(); g.fill(); g.fillStyle = shade('#9A8E7A', .2); g.fillRect(x - 56, by - 156, 112, 6); break }
  }
  g.restore();
}
const BH = { apartment: 260, office_tower: 560, school: 220, clinic: 150, warehouse: 170, kiosk: 100, hut_a: 130, hut_b: 160, hut_c: 120, water_tower: 230 };
const NICEB = { apartment: 'Apartment block', office_tower: 'Office tower', school: 'School', clinic: 'Clinic', warehouse: 'Warehouse', kiosk: 'Kiosk', hut_a: 'Round village hut (A)', hut_b: 'Round village hut (B)', hut_c: 'Round village hut (C)', water_tower: 'Water tower' };
const bounds = (h, w = 380) => [-w / 2, -h - 30, w, h + 50];
export const assets = {
  ...Object.fromEntries(HOUSE_NAMES.map((n, v) => ['env/house-' + v, mk('env/house-' + v, { title: 'House variant ' + v + ' (' + n + ')', description: `House, variant ${v} (${n}); eight variants differ in roof, floors and balconies. Use in rows for villages, towns and streets.`, tags: ['building', 'house', n, 'town'], params: { ...XY, wall: P('color', null, 'wall colour'), roof: P('color', null, 'roof colour') }, bounds: bounds(380, 300), origin: [0, 0], example: `assets['env/house-${v}'].draw(g,t,{x:640,y:560})` }, (g, t, p) => { const q = withDef(p); g.save(); g.translate(q.x, q.y); g.scale(q.s, q.s); houseVariant(g, v, 0, 0, t, q); g.restore() })])),
  ...Object.fromEntries(SHOP_NAMES.map((n, v) => ['env/shop-' + n, mk('env/shop-' + n, { title: 'Shop front: ' + n, description: `Shop front with striped awning and display counter (${n}); text param sets the sign. Use for markets, streets, commerce scenes.`, tags: ['building', 'shop', n, 'awning', 'commerce'], params: { ...XY, text: P('string', n.toUpperCase(), 'sign text') }, bounds: bounds(230, 300), origin: [0, 0], example: `assets['env/shop-${n}'].draw(g,t,{x:640,y:560,text:'BAKERY'})` }, (g, t, p) => { const q = withDef(p); g.save(); g.translate(q.x, q.y); g.scale(q.s, q.s); shopFront(g, v, 0, 0, t, q); g.restore() })])),
  ...Object.fromEntries(BUILDING_KINDS.map(k => ['env/building-' + k, mk('env/building-' + k, { title: NICEB[k], description: `${NICEB[k]} in flat paper-cut style, anchored bottom-centre; scale with s. Use as scenery or a location establishing shot.`, tags: ['building', k, 'scenery'], params: { ...XY, wall: P('color', null, 'wall colour override') }, bounds: bounds(BH[k], 380), origin: [0, 0], example: `assets['env/building-${k}'].draw(g,t,{x:640,y:560})` }, (g, t, p) => { const q = withDef(p); g.save(); g.translate(q.x, q.y); g.scale(q.s, q.s); drawBuilding(g, k, 0, 0, t, q); g.restore() })])),
};
function withDef(p) { return { x: 640, y: 560, s: 1, ...(p || {}) } }

