/**
 * people/characters.js — character presets, skin tones, hair, accessories and clothing.
 *
 * A character spec is a plain object:
 *   { skin, hair:{style,col}, top:{kind,col,accent,len,sleeve}, pants, shoe, s (scale), headS, acc:{glasses,backpack,bag,lanyard,hat,tie,helmet,stetho}, wrap:{col,accent} }
 *   hair.style: bun cap afro braids short curly ponytail bald headwrap
 *   top.kind:   coat shirt blazer hoodie apron scrubs uniform jacket dress
 * PRESETS (names): ama kofi child elder_woman elder_man office_woman office_man developer shopkeeper doctor student rider
 *   character('doctor', {skin: SKINS[2]}) -> spec ; characterNames() -> list.   SKINS: 8 tones light -> deep.
 * drawHairBack / drawHairFront / drawHeadAcc / drawBodyBack / drawTorso / drawBodyFront are used by the rig (head frame: origin = head centre, radius 21.5;
 * torso frame: origin = hip centre, y up is negative, shoulders at y=-52). All work in 'side' (facing +x) and 'front' views.
 * Registered assets: 'people/char-<name>' — a standing, idle character (view side|front) for catalogs and quick use.
 *
 *   const spec = character('developer');          // then pass to drawPerson(g,t,{...spec,x,y})
 *   assets['people/char-doctor'].draw(g,t,{view:'front',x:640,y:640,s:2});
 */
import { lerp, shade, rrect, cl } from '../core/core.js';
import { INK, TOMATO, MUSTARD, GREEN, PINK, CREAM, SHADOW, AQUA, LEAF } from '../core/palette.js';
import { defMeta, P, withDefaults } from '../environment/_meta.js';
import { drawPerson } from './rig.js';

export const SKINS = ['#FBE0C4', '#F0C7A0', '#E0AC7E', '#C58C5F', '#A66E4A', '#8B5A3C', '#6B4430', '#4A2E22'];
const HAIR_DARK = '#241713', HAIR_BROWN = '#4A2E22', HAIR_GREY = '#BDB5A8';

// ---------------------------------------------------------------- hair
/** hair drawn BEHIND the head circle. head frame, facing +x in side view. t for secondary motion (ponytail/braid swing). */
export function drawHairBack(g, view, c, t = 0, lag = 0) {
  const h = c.hair || {}, col = h.col || HAIR_DARK, side = view === 'side', cx = side ? -3 : 0;
  g.fillStyle = col; g.strokeStyle = col; g.lineCap = 'round'; g.lineJoin = 'round';
  const disc = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill() };
  switch (h.style) {
    case 'bun': if (side) { disc(-19, -27, 11); disc(-5, -5, 25) } else { disc(0, -4, 24); disc(0, -29, 11) } break;
    case 'afro': disc(cx, -11, 31); disc(cx - 18, -4, 14); disc(cx + 18, -4, 14); disc(cx, -30, 14); if (!side) { disc(-24, -16, 11); disc(24, -16, 11) } break;
    case 'curly': disc(cx, -4, 23); for (let i = 0; i < 9; i++) { const a = Math.PI + i * Math.PI / 8; disc(cx + Math.cos(a) * 23, -4 + Math.sin(a) * 23, 8.5) } break;
    case 'braids': {
      disc(cx, -4, 24); const sw = Math.sin(t * 2.1 + lag) * 2.2;
      const braid = (x, y) => { g.lineWidth = 8; g.beginPath(); g.moveTo(x, y); g.lineTo(x + sw * .3, y + 14); g.lineTo(x + sw, y + 30); g.stroke(); for (let k = 0; k < 4; k++) { g.fillStyle = shade(col, k % 2 ? .12 : -.1); g.beginPath(); g.arc(x + sw * (k + .5) / 4, y + 5 + k * 7, 3.6, 0, 7); g.fill() } g.fillStyle = col; g.fillStyle = h.tie || MUSTARD; g.beginPath(); g.arc(x + sw, y + 31, 3.2, 0, 7); g.fill(); g.fillStyle = col };
      if (side) { braid(-17, 6); braid(-9, 10) } else { braid(-22, 4); braid(22, 4) } break
    }
    case 'ponytail': {
      disc(cx, -4, 24); const sw = Math.sin(t * 2.6 + lag) * 4; g.lineWidth = 10;
      if (side) { g.beginPath(); g.moveTo(-18, -12); g.quadraticCurveTo(-34 - sw * .5, -2, -30 - sw, 24); g.stroke(); g.fillStyle = h.tie || TOMATO; g.beginPath(); g.arc(-20, -12, 4, 0, 7); g.fill() }
      else { g.beginPath(); g.moveTo(14, -22); g.quadraticCurveTo(34 + sw * .3, -18, 30 + sw, 14); g.stroke(); g.fillStyle = h.tie || TOMATO; g.beginPath(); g.arc(15, -22, 4, 0, 7); g.fill() } break
    }
    case 'cap': case 'short': disc(cx, -4, 24); break;
    case 'headwrap': disc(cx, -3, 22); break;
    default: break; // bald
  }
}
/** hair / headgear drawn IN FRONT of the head circle (fringe, cap, wrap, helmet, hat) */
export function drawHairFront(g, view, c, t = 0) {
  const h = c.hair || {}, side = view === 'side', col = h.col || HAIR_DARK, a = c.acc || {};
  if (h.style === 'cap') {
    g.fillStyle = h.cap || GREEN; g.beginPath(); g.ellipse(side ? -1 : 0, -8, 25.5, 17, 0, Math.PI, 2 * Math.PI); g.fill();
    if (side) { g.beginPath(); g.ellipse(16, -7, 15, 4.5, 0, 0, 7); g.fill() } else { g.fillStyle = shade(h.cap || GREEN, -.18); g.beginPath(); g.ellipse(0, -8.5, 26, 6, 0, 0, Math.PI); g.fill() }
  } else if (h.style === 'short') {
    g.fillStyle = col; g.beginPath(); g.ellipse(side ? 0 : 0, -7, 22.8, 15, 0, Math.PI, 2 * Math.PI); g.fill();
    g.beginPath(); g.moveTo(side ? -22 : -22.5, -7); g.lineTo(side ? -22 : -22.5, 2); g.lineTo(side ? -15 : -18, -4); g.closePath(); g.fill(); if (!side) { g.beginPath(); g.moveTo(22.5, -7); g.lineTo(22.5, 2); g.lineTo(18, -4); g.closePath(); g.fill() }
    g.beginPath(); g.ellipse(side ? 8 : 0, -17, 13, 4, side ? -.15 : 0, 0, 7); g.fill();
  } else if (h.style === 'curly') {
    g.fillStyle = col; for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(-12 + i * 6.2 + (side ? 3 : 0), -17 + Math.abs(i - 2) * 2.2, 6.2, 0, 7); g.fill() }
  } else if (h.style === 'afro') {
    g.fillStyle = col; for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(-10 + i * 7 + (side ? 3 : 0), -19 + Math.abs(i - 1.5) * 2.4, 6.6, 0, 7); g.fill() }
  } else if (h.style === 'braids' || h.style === 'ponytail' || h.style === 'bun') {
    g.fillStyle = col; g.beginPath(); g.ellipse(side ? 1 : 0, -9, 22.6, 12.5, 0, Math.PI, 2 * Math.PI); g.fill(); g.beginPath(); g.ellipse(side ? 9 : 0, -17, 12, 3.6, side ? -.15 : 0, 0, 7); g.fill();
    if (!side) { g.beginPath(); g.moveTo(-22.5, -9); g.lineTo(-22.5, 2); g.lineTo(-18, -5); g.closePath(); g.fill(); g.beginPath(); g.moveTo(22.5, -9); g.lineTo(22.5, 2); g.lineTo(18, -5); g.closePath(); g.fill() }
  } else if (h.style === 'headwrap') {
    const w = c.wrap || {}, wc = w.col || TOMATO, ac = w.accent || MUSTARD;
    g.fillStyle = wc; g.beginPath(); g.ellipse(side ? -1 : 0, -8, 25, 17.5, 0, Math.PI, 2 * Math.PI); g.fill();
    g.fillRect(side ? -24 : -24.5, -8, 49, 5.5); g.fillStyle = ac; g.save(); g.beginPath(); g.ellipse(side ? -1 : 0, -8, 25, 17.5, 0, Math.PI, 2 * Math.PI); g.rect(side ? -24 : -24.5, -8, 49, 5.5); g.clip();
    for (let i = -3; i < 4; i++) { g.beginPath(); g.moveTo(i * 8 - 3, -30); g.lineTo(i * 8 + 3, -30); g.lineTo(i * 8 + 11, 0); g.lineTo(i * 8 + 5, 0); g.closePath(); g.fill() } g.restore();
    g.fillStyle = wc; g.beginPath(); if (side) { g.ellipse(-18, -26, 10, 8, -.5, 0, 7) } else { g.ellipse(14, -28, 10, 8, .4, 0, 7) } g.fill();
    g.fillStyle = shade(wc, -.2); g.beginPath(); if (side) { g.ellipse(-20, -25, 5, 3.6, -.5, 0, 7) } else { g.ellipse(15, -27, 5, 3.6, .4, 0, 7) } g.fill();
  }
  if (a.helmet) {
    const hc = a.helmet === true ? TOMATO : a.helmet;
    g.fillStyle = hc; g.beginPath(); g.ellipse(side ? -1 : 0, -6, 26, 22, 0, Math.PI, 2 * Math.PI); g.fill(); g.fillRect(side ? -26 : -26, -6, 52, 5);
    g.fillStyle = shade(hc, -.2); g.fillRect(-26, -4, 52, 3); g.fillStyle = CREAM; g.globalAlpha = .9; g.fillRect(side ? -6 : -2.5, -28, 5, 22); g.globalAlpha = 1;
    g.strokeStyle = INK; g.lineWidth = 1.8; g.lineCap = 'round'; g.beginPath(); if (side) { g.moveTo(-18, -2); g.lineTo(-17, 15); g.lineTo(2, 17) } else { g.moveTo(-20, -2); g.lineTo(-19, 15); g.moveTo(20, -2); g.lineTo(19, 15) } g.stroke();
  }
  if (a.hat) {
    const hc = a.hat === true ? MUSTARD : a.hat;
    g.fillStyle = shade(hc, -.15); g.beginPath(); g.ellipse(side ? 1 : 0, -13, 31, 5.5, 0, 0, 7); g.fill();
    g.fillStyle = hc; g.beginPath(); g.moveTo(-17, -13); g.lineTo(-15, -29); g.quadraticCurveTo(0, -34, 15, -29); g.lineTo(17, -13); g.closePath(); g.fill(); g.fillStyle = TOMATO; g.fillRect(-16.5, -18, 33, 4.5);
  }
}
/** glasses etc. drawn on the face */
export function drawHeadAcc(g, view, c) {
  const a = c.acc || {}, side = view === 'side';
  if (a.glasses) {
    g.strokeStyle = INK; g.lineWidth = 1.9; g.fillStyle = 'rgba(207,230,220,.38)';
    const ring = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.stroke() };
    if (side) { ring(12.5, -1, 6.4); g.beginPath(); g.moveTo(6.2, -1); g.lineTo(-12, 1); g.stroke() } else { ring(-8.4, -1, 6.2); ring(8.4, -1, 6.2); g.beginPath(); g.moveTo(-2.2, -1.5); g.lineTo(2.2, -1.5); g.stroke() }
  }
}
// ---------------------------------------------------------------- body
export const SH_Y = -52;
/** things behind the torso (backpack body) */
export function drawBodyBack(g, view, c) {
  const a = c.acc || {}; if (!a.backpack) return; const col = a.backpackCol || (a.backpack === true ? '#5E8C8A' : a.backpack);
  g.fillStyle = col;
  if (view === 'side') { rrect(g, -31, -52, 22, 44, 7); g.fill(); g.fillStyle = shade(col, -.2); rrect(g, -31, -24, 22, 14, 5); g.fill() }
  else { rrect(g, -27, -56, 54, 46, 9); g.fill(); g.fillStyle = shade(col, -.2); rrect(g, -17, -20, 34, 12, 5); g.fill() }
}
/** the torso with clothing, in torso frame. breath: 0..1 chest scale */
export function drawTorso(g, view, c, t = 0, breath = 0) {
  const top = c.top || {}, kind = top.kind || 'coat', col = top.col || TOMATO, acc = top.accent || MUSTARD, side = view === 'side';
  const len = top.len ?? .5, hem = lerp(-4, 40, len), hw = side ? 22 + len * 8 : 25 + len * 6, sw = side ? 18 : 22;
  const sy = -57 - breath * .8;
  g.fillStyle = shade(c.skin, 0); g.fillRect(side ? -4 : -5, -76, side ? 12 : 11, 20);                                   // neck
  g.fillStyle = col; g.beginPath(); g.moveTo(-sw, sy); g.quadraticCurveTo(0, sy - 10, sw, sy);
  if (side) { g.lineTo(hw, hem); g.quadraticCurveTo(0, hem + 6, -hw, hem) } else { g.quadraticCurveTo(sw + 2, -30, hw, hem); g.quadraticCurveTo(0, hem + 6, -hw, hem); g.quadraticCurveTo(-sw - 2, -30, -sw, sy) }
  g.closePath(); g.fill();
  if (side) { g.fillStyle = shade(col, -.14); g.beginPath(); g.moveTo(-sw, sy); g.lineTo(-7, sy - 3); g.lineTo(-hw * .35, hem + 3); g.lineTo(-hw, hem); g.closePath(); g.fill() }
  else { g.fillStyle = shade(col, -.1); g.beginPath(); g.moveTo(sw * .55, sy); g.lineTo(sw, sy); g.quadraticCurveTo(sw + 2, -30, hw, hem); g.lineTo(hw * .62, hem); g.closePath(); g.fill() }
  const cx = side ? 4 : 0;
  switch (kind) {
    case 'coat': g.fillStyle = acc; rrect(g, -15, -67, 30, 11, 5.5); g.fill(); g.fillStyle = 'rgba(34,30,26,.4)'; g.beginPath(); g.arc(side ? 8 : 0, -40, 2.3, 0, 7); g.fill(); g.beginPath(); g.arc(side ? 8 : 0, -24, 2.3, 0, 7); g.fill(); break;
    case 'dress': g.fillStyle = acc; rrect(g, -15, -67, 30, 9, 4.5); g.fill(); g.fillStyle = shade(col, -.16); g.fillRect(-hw, hem - 7, hw * 2, 4); break;
    case 'shirt': case 'uniform': {
      g.fillStyle = CREAM; g.beginPath(); g.moveTo(cx - 9, sy - 2); g.lineTo(cx + 1, sy + 13); g.lineTo(cx + 11, sy - 2); g.closePath(); g.fill();
      g.fillStyle = shade(col, .1); g.beginPath(); g.moveTo(cx - 10, sy - 3); g.lineTo(cx - 1, sy + 12); g.lineTo(cx - 12, sy + 6); g.closePath(); g.fill(); g.beginPath(); g.moveTo(cx + 12, sy - 3); g.lineTo(cx + 1, sy + 12); g.lineTo(cx + 12, sy + 6); g.closePath(); g.fill();
      if (kind === 'uniform') { g.fillStyle = acc; g.beginPath(); g.moveTo(-sw + 2, sy + 6); g.lineTo(sw - 2, sy + 6); g.lineTo(sw - 5, 6); g.lineTo(-sw + 5, 6); g.closePath(); g.globalAlpha = .9; g.fill(); g.globalAlpha = 1 }
      g.fillStyle = 'rgba(34,30,26,.35)'; for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(cx + 1, sy + 14 + i * 12, 1.8, 0, 7); g.fill() } break
    }
    case 'blazer': {
      g.fillStyle = CREAM; g.beginPath(); g.moveTo(cx - 7, sy - 2); g.lineTo(cx + 1, -2 + sy * .5 + 10); g.lineTo(cx + 9, sy - 2); g.closePath(); g.fill();
      g.fillStyle = shade(col, -.2); g.beginPath(); g.moveTo(cx - 11, sy - 3); g.lineTo(cx + 1, -14); g.lineTo(cx - 4, sy + 6); g.closePath(); g.fill(); g.beginPath(); g.moveTo(cx + 13, sy - 3); g.lineTo(cx + 1, -14); g.lineTo(cx + 6, sy + 6); g.closePath(); g.fill();
      g.strokeStyle = shade(col, -.3); g.lineWidth = 1.8; g.beginPath(); g.moveTo(cx + 1, -14); g.lineTo(cx + 1, hem); g.stroke(); break
    }
    case 'hoodie': {
      g.fillStyle = shade(col, -.18); g.beginPath(); g.ellipse(side ? -9 : 0, sy - 5, side ? 12 : 19, 8, 0, 0, 7); g.fill();
      g.fillStyle = shade(col, -.12); rrect(g, -12, -22, 24, 13, 5); g.fill();
      g.strokeStyle = CREAM; g.lineWidth = 1.8; g.lineCap = 'round'; g.beginPath(); g.moveTo(cx - 4, sy + 2); g.lineTo(cx - 5, -34); g.moveTo(cx + 6, sy + 2); g.lineTo(cx + 7, -34); g.stroke(); break
    }
    case 'apron': {
      g.fillStyle = CREAM; g.beginPath(); g.moveTo(side ? -2 : -13, sy + 3); g.lineTo(side ? 14 : 13, sy + 3); g.lineTo(side ? hw : hw - 2, hem + 14); g.lineTo(side ? -hw + 6 : -hw + 2, hem + 14); g.closePath(); g.fill();
      g.fillStyle = acc; rrect(g, cx - 8, -32, 18, 12, 3); g.fill(); g.strokeStyle = shade(CREAM, -.3); g.lineWidth = 1.8; g.beginPath(); g.moveTo(side ? -2 : -13, sy + 3); g.lineTo(side ? -10 : -14, sy - 5); g.moveTo(side ? 14 : 13, sy + 3); g.lineTo(side ? 12 : 14, sy - 5); g.stroke(); break
    }
    case 'scrubs': {
      g.fillStyle = shade(col, -.18); g.beginPath(); g.moveTo(cx - 9, sy - 2); g.lineTo(cx + 1, sy + 14); g.lineTo(cx + 11, sy - 2); g.closePath(); g.fill();
      g.fillStyle = shade(col, -.1); rrect(g, cx - 9, -30, 14, 11, 2); g.fill(); break
    }
    case 'jacket': {
      g.fillStyle = acc; g.fillRect(-hw, -18, hw * 2, 5); g.fillRect(-hw + 2, -2, hw * 2 - 4, 4);
      g.strokeStyle = shade(col, -.3); g.lineWidth = 1.8; g.beginPath(); g.moveTo(cx + 1, sy); g.lineTo(cx + 1, hem); g.stroke(); break
    }
  }
}
/** things drawn on the front of the torso (tie, lanyard, bag strap, stethoscope, backpack straps) */
export function drawBodyFront(g, view, c, t = 0) {
  const a = c.acc || {}, side = view === 'side', cx = side ? 4 : 0;
  if (a.tie) { const tc = a.tie === true ? TOMATO : a.tie; g.fillStyle = tc; g.beginPath(); g.moveTo(cx - 3, -56); g.lineTo(cx + 4, -56); g.lineTo(cx + 3, -45); g.lineTo(cx + 5, -26); g.lineTo(cx + .5, -20); g.lineTo(cx - 4, -26); g.lineTo(cx - 2, -45); g.closePath(); g.fill() }
  if (a.lanyard) {
    const lc = a.lanyard === true ? MUSTARD : a.lanyard; g.strokeStyle = lc; g.lineWidth = 2; g.lineCap = 'round'; g.beginPath(); g.moveTo(cx - 8, -62); g.lineTo(cx + .5, -30); g.lineTo(cx + 9, -62); g.stroke();
    g.fillStyle = CREAM; rrect(g, cx - 5, -32, 11, 14, 2); g.fill(); g.fillStyle = INK; g.globalAlpha = .6; g.fillRect(cx - 3, -29, 7, 2); g.fillRect(cx - 3, -24, 5, 1.6); g.globalAlpha = 1; g.fillStyle = lc; g.fillRect(cx - 5, -32, 11, 3);
  }
  if (a.stetho) { g.strokeStyle = '#4A4540'; g.lineWidth = 2.6; g.lineCap = 'round'; g.beginPath(); g.moveTo(cx - 9, -60); g.quadraticCurveTo(cx - 12, -28, cx + 2, -26); g.moveTo(cx + 10, -60); g.quadraticCurveTo(cx + 13, -30, cx + 2, -26); g.stroke(); g.fillStyle = '#8E8A84'; g.beginPath(); g.arc(cx + 2, -24, 4, 0, 7); g.fill() }
  if (a.backpack) {
    const col = a.backpackCol || (a.backpack === true ? '#5E8C8A' : a.backpack); g.strokeStyle = shade(col, -.25); g.lineWidth = 5; g.lineCap = 'round';
    if (side) { g.beginPath(); g.moveTo(-6, -54); g.quadraticCurveTo(8, -34, -2, -10); g.stroke() } else { g.beginPath(); g.moveTo(-13, -55); g.lineTo(-11, -4); g.moveTo(13, -55); g.lineTo(11, -4); g.stroke() }
  }
  if (a.bag) {
    const col = a.bagCol || (a.bag === true ? MUSTARD : a.bag); g.strokeStyle = shade(col, -.3); g.lineWidth = 3; g.lineCap = 'round';
    if (side) { g.beginPath(); g.moveTo(-10, -56); g.lineTo(10, -4); g.stroke(); g.fillStyle = col; rrect(g, 2, -12, 22, 18, 4); g.fill(); g.fillStyle = shade(col, -.2); g.fillRect(2, -12, 22, 5) }
    else { g.beginPath(); g.moveTo(-14, -56); g.lineTo(18, -4); g.stroke(); g.fillStyle = col; rrect(g, 8, -12, 22, 18, 4); g.fill(); g.fillStyle = shade(col, -.2); g.fillRect(8, -12, 22, 5) }
  }
}
// ---------------------------------------------------------------- presets
export const PRESETS = {
  ama: e => ({ name: 'Ama', skin: '#8B5A3C', hair: { style: 'bun', col: HAIR_DARK }, top: { kind: 'coat', col: TOMATO, accent: MUSTARD, len: .8 }, pants: '#4A3A33', shoe: '#2A1B17', s: 1.22, ...e }),
  kofi: e => ({ name: 'Kofi', skin: '#C58C5F', hair: { style: 'cap', col: HAIR_DARK, cap: GREEN }, top: { kind: 'coat', col: MUSTARD, accent: CREAM, len: .3 }, pants: '#3F5E52', shoe: '#3A2A22', s: 1.34, ...e }),
  child: e => ({ name: 'Child', skin: '#A66E4A', hair: { style: 'curly', col: HAIR_DARK }, top: { kind: 'shirt', col: PINK, accent: MUSTARD, len: .2, sleeve: 'short' }, pants: '#5E8C8A', shoe: TOMATO, s: .82, headS: 1.18, ...e }),
  elder_woman: e => ({ name: 'Elder woman', skin: '#6B4430', hair: { style: 'headwrap', col: HAIR_GREY }, wrap: { col: MUSTARD, accent: TOMATO }, top: { kind: 'dress', col: GREEN, accent: CREAM, len: .95 }, pants: '#4A3A33', shoe: '#3A2A22', s: 1.16, ...e }),
  elder_man: e => ({ name: 'Elder man', skin: '#8B5A3C', hair: { style: 'short', col: HAIR_GREY }, top: { kind: 'shirt', col: '#7A8F6A', accent: CREAM, len: .45 }, pants: '#5A4A3E', shoe: '#2A1B17', acc: { glasses: true }, s: 1.2, ...e }),
  office_woman: e => ({ name: 'Office woman', skin: '#E0AC7E', hair: { style: 'ponytail', col: HAIR_BROWN, tie: TOMATO }, top: { kind: 'blazer', col: '#3F5E52', accent: CREAM, len: .5 }, pants: '#2E2A26', shoe: INK, acc: { lanyard: MUSTARD }, s: 1.22, ...e }),
  office_man: e => ({ name: 'Office man', skin: '#C58C5F', hair: { style: 'short', col: HAIR_DARK }, top: { kind: 'shirt', col: '#9DB8C9', accent: CREAM, len: .45 }, pants: '#3A3F4A', shoe: INK, acc: { tie: TOMATO }, s: 1.3, ...e }),
  developer: e => ({ name: 'Developer', skin: '#F0C7A0', hair: { style: 'afro', col: HAIR_DARK }, top: { kind: 'hoodie', col: '#6C5B7B', accent: CREAM, len: .55 }, pants: '#3A3F4A', shoe: CREAM, acc: { backpack: '#E8452C', glasses: true }, s: 1.24, ...e }),
  shopkeeper: e => ({ name: 'Shopkeeper', skin: '#6B4430', hair: { style: 'bald', col: HAIR_DARK }, top: { kind: 'apron', col: '#E9B4A0', accent: TOMATO, len: .5 }, pants: '#5A4A3E', shoe: '#3A2A22', s: 1.3, ...e }),
  doctor: e => ({ name: 'Doctor', skin: '#4A2E22', hair: { style: 'bun', col: INK }, top: { kind: 'scrubs', col: '#6FA8A0', accent: CREAM, len: .5, sleeve: 'short' }, pants: '#5E8C8A', shoe: CREAM, acc: { stetho: true }, s: 1.24, ...e }),
  student: e => ({ name: 'Student', skin: '#A66E4A', hair: { style: 'braids', col: HAIR_DARK, tie: MUSTARD }, top: { kind: 'uniform', col: CREAM, accent: GREEN, len: .45 }, pants: '#3F5E52', shoe: INK, acc: { backpack: MUSTARD }, s: 1.02, headS: 1.08, ...e }),
  rider: e => ({ name: 'Delivery rider', skin: '#E0AC7E', hair: { style: 'short', col: HAIR_DARK }, top: { kind: 'jacket', col: TOMATO, accent: MUSTARD, len: .4 }, pants: '#2E2A26', shoe: INK, acc: { helmet: MUSTARD, backpack: '#F2B531', backpackCol: '#E9B94A' }, s: 1.28, ...e }),
};
export const characterNames = () => Object.keys(PRESETS);
/** build a spec from a preset name with shallow overrides (override nested objects wholesale, e.g. {acc:{glasses:true}}) */
export function character(name, over = {}) { const f = PRESETS[name] || PRESETS.ama; return f(over) }

function mkAsset(name) {
  const DEF = { view: 'side', x: 640, y: 650, s: null, dir: 1, face: 'smile', moving: false };
  const draw = (g, t, params) => {
    const p = withDefaults(params, DEF); const spec = character(name, p.spec || {});
    drawPerson(g, t, { ...spec, x: p.x, y: p.y, s: p.s ?? spec.s, dir: p.dir, view: p.view, face: p.face, walk: p.moving ? { speed: 130 } : null });
  };
  const meta = defMeta({
    id: 'people/char-' + name, kind: 'character', mode: 'story', title: 'Character: ' + PRESETS[name]({}).name, duration: 6,
    description: `${PRESETS[name]({}).name} preset: standing with idle breathing and blinking, side or front view. Use as a quick ready-dressed person; for gestures/walking call drawPerson with character('${name}').`,
    params: { view: P('string', 'side', "'side' | 'front'"), x: P('number', 640, 'ground x'), y: P('number', 650, 'ground y'), s: P('number', null, 'scale (default = preset scale)'), dir: P('number', 1, 'facing +1/-1'), face: P('string', 'smile', 'expression'), moving: P('bool', false, 'walk in place') },
    anchors: {}, markers: [], tags: ['character', 'person', name], bounds: [540, 360, 200, 300], origin: [640, 650], example: `assets['people/char-${name}'].draw(g,t,{view:'front'})`
  });
  return { meta, draw, markers: () => [] };
}
export const assets = Object.fromEntries(characterNames().map(n => ['people/char-' + n, mkAsset(n)]));
