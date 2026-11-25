/**
 * people/props-held.js — props that attach to a hand joint and follow the wrist.
 *
 * PROPS[kind] = { mode:'follow'|'upright', hold:{pose, tgt:[fwd,lat,up]}, draw(g,t,o) }
 *   kinds: phone laptop tablet paper clipboard box bag basket balloons umbrella mug pen magnifier megaphone key flag signboard
 * Draw frame: origin = palm centre (grip point), +x = forward (direction the person faces / forearm), -y = up.
 * drawProp(g, kind, J, o, t): J = {x,y,ang,dir} scene position of the palm centre, forearm angle (radians, scene) and facing dir (+1/-1).
 *   o options: s (scale), col (accent colour), text (signboard / paper), open (laptop 0..1), scroll (phone px), tap (phone 0..1), tilt (rad), view.
 * In a person spec use  props:[{kind:'umbrella',hand:'R',at:0,to:Infinity,col:'#E8452C'}]  — the arm lifts into the prop's hold pose automatically.
 * Registered assets: 'people/prop-<kind>' (draw the prop alone at x,y,ang for catalog / close-ups).
 *
 *   drawProp(g,'mug',{x:300,y:400,ang:0,dir:1},{col:'#F2B531'},t);
 *   assets['people/prop-phone'].draw(g,t,{x:640,y:360,s:5,scroll:t*20});
 */
import { cl, lerp, shade, rrect, eo, txt } from '../core/core.js';
import { INK, TOMATO, MUSTARD, GREEN, PINK, CREAM, SHADOW, AQUA, LEAF, SANS } from '../core/palette.js';
import { defMeta, P, withDefaults, idled } from '../environment/_meta.js';

const fillPoly = (g, pts, col) => { g.fillStyle = col; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.fill() };

export const PROPS = {
  phone: {
    mode: 'upright', tilt0: -.12, hold: { pose: 'grip', tgt: [26, 22, -22] },
    draw(g, t, o) {
      g.fillStyle = INK; rrect(g, -6.5, -17, 13, 24, 3.4); g.fill();
      g.fillStyle = o.col || CREAM; rrect(g, -5, -15.4, 10, 19.6, 2.2); g.fill();
      g.save(); rrect(g, -5, -15.4, 10, 19.6, 2.2); g.clip();
      const sc = o.scroll || 0, cols = [TOMATO, MUSTARD, GREEN, PINK];
      for (let i = -1; i < 6; i++) { const y = -15 + ((i * 7 - sc) % 42 + 42) % 42 - 7; g.fillStyle = cols[(i + 40) % 4]; g.globalAlpha = .85; rrect(g, -4, y, 8, 5, 1.5); g.fill() }
      g.globalAlpha = 1; g.restore();
      if (o.tap > 0 && o.tap < 1) { g.fillStyle = `rgba(34,30,26,${.35 * (1 - o.tap)})`; g.beginPath(); g.arc(0, -4, 1.5 + o.tap * 7, 0, 7); g.fill() }
    }
  },
  laptop: {
    mode: 'upright', tilt0: 0, hold: { pose: 'flat_up', tgt: [28, 20, -26] },
    draw(g, t, o) {
      const open = o.open ?? 1, lid = 34 * eo(open), col = o.col || '#8E8A84';
      fillPoly(g, [[-27, 1], [27, 1], [23, -6], [-23, -6]], shade(col, -.15));
      g.fillStyle = shade(col, .2); rrect(g, -20, -5.2, 40, 2.6, 1); g.fill();
      if (lid > 1) { g.fillStyle = col; rrect(g, -23, -6 - lid, 46, lid, 3); g.fill(); g.fillStyle = shade(col, -.1); rrect(g, -20, -6 - lid + 3, 40, Math.max(0, lid - 6), 2); g.fill(); g.fillStyle = o.accent || TOMATO; g.beginPath(); g.arc(0, -6 - lid / 2, Math.min(3.5, lid / 8), 0, 7); g.fill() }
    }
  },
  tablet: {
    mode: 'upright', tilt0: -.1, hold: { pose: 'grip', tgt: [26, 20, -20] },
    draw(g, t, o) {
      g.fillStyle = INK; rrect(g, -17, -22, 34, 26, 3.5); g.fill(); g.fillStyle = o.col || CREAM; rrect(g, -15, -20, 30, 22, 2); g.fill();
      [[-10, 5, TOMATO], [-3, 10, MUSTARD], [4, 7, GREEN], [11, 13, PINK]].forEach(([x, h, c], i) => { const hh = h * (.8 + .2 * Math.sin(t * 1.5 + i)); g.fillStyle = c; g.fillRect(x - 2.4, -3 - hh, 4.8, hh) });
    }
  },
  paper: {
    mode: 'upright', tilt0: -.05, hold: { pose: 'pinch', tgt: [30, 14, 12] },
    draw(g, t, o) {
      g.fillStyle = SHADOW; rrect(g, -12 + 1.5, -26 + 1.5, 24, 32, 1.5); g.fill(); g.fillStyle = o.col || CREAM; rrect(g, -12, -26, 24, 32, 1.5); g.fill();
      g.strokeStyle = 'rgba(34,30,26,.45)'; g.lineWidth = 1.6; g.lineCap = 'round'; for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(-8, -21 + i * 4.6); g.lineTo(i % 3 === 2 ? 2 : 8, -21 + i * 4.6); g.stroke() }
      g.fillStyle = TOMATO; g.fillRect(-8, -24.6, 6, 2);
    }
  },
  clipboard: {
    mode: 'upright', tilt0: -.08, hold: { pose: 'grip', tgt: [24, 16, -16] },
    draw(g, t, o) {
      g.fillStyle = o.col || '#B07A4A'; rrect(g, -15, -28, 30, 38, 3); g.fill(); g.fillStyle = CREAM; rrect(g, -12, -23, 24, 30, 1.5); g.fill();
      g.strokeStyle = 'rgba(34,30,26,.45)'; g.lineWidth = 1.6; g.lineCap = 'round'; for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(-8, -17 + i * 5); g.lineTo(i % 2 ? 4 : 8, -17 + i * 5); g.stroke() }
      g.fillStyle = '#8E8A84'; rrect(g, -6, -31, 12, 7, 2); g.fill();
    }
  },
  box: {
    mode: 'upright', tilt0: 0, hold: { pose: 'flat_up', tgt: [26, 16, -22] },
    draw(g, t, o) {
      const c = o.col || '#C99A62'; g.fillStyle = c; rrect(g, -22, -30, 44, 32, 2); g.fill(); g.fillStyle = shade(c, -.14); g.fillRect(-22, -30, 44, 7);
      g.fillStyle = shade(c, .25); g.fillRect(-4, -30, 8, 32); g.fillStyle = INK; g.globalAlpha = .6; g.fillRect(8, -12, 9, 5); g.globalAlpha = 1;
    }
  },
  bag: {
    mode: 'upright', tilt0: 0, hold: { pose: 'grip', tgt: [14, 16, -30], hang: true },
    draw(g, t, o) {
      const sw = Math.sin(t * 2.2 + (o.ph || 0)) * .06; g.rotate(sw);
      const c = o.col || TOMATO; g.strokeStyle = shade(c, -.25); g.lineWidth = 2.2; g.lineCap = 'round'; g.beginPath(); g.moveTo(-6, 2); g.quadraticCurveTo(0, -9, 6, 2); g.stroke();
      fillPoly(g, [[-14, 6], [14, 6], [12, 34], [-12, 34]], c); fillPoly(g, [[6, 6], [14, 6], [12, 34], [4, 34]], shade(c, -.15));
      g.fillStyle = CREAM; g.beginPath(); g.arc(0, 20, 5, 0, 7); g.fill();
      g.fillStyle = LEAF; g.beginPath(); g.arc(-6, 5, 4.5, 0, 7); g.fill(); g.fillStyle = MUSTARD; g.beginPath(); g.arc(5, 4, 4, 0, 7); g.fill();
    }
  },
  basket: {
    mode: 'upright', tilt0: 0, hold: { pose: 'grip', tgt: [20, 22, -34], hang: true },
    draw(g, t, o) {
      const hx = 0, hy = 0;
      g.fillStyle = '#C58B4A'; g.beginPath(); g.moveTo(hx - 19, hy + 14); g.lineTo(hx + 19, hy + 14); g.lineTo(hx + 13, hy + 40); g.lineTo(hx - 13, hy + 40); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(60,30,10,.3)'; g.lineWidth = 2; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(hx - 17 + i * 1.5, hy + 20 + i * 7); g.lineTo(hx + 17 - i * 1.5, hy + 20 + i * 7); g.stroke() }
      [['#F08A24', -10, 10], ['#F5D142', 2, 6], ['#8DBB4C', 12, 11], [TOMATO, -2, 12]].forEach(([c, dx, dy]) => { g.fillStyle = c; g.beginPath(); g.arc(hx + dx, hy + dy, 8.5, 0, 7); g.fill() });
      g.strokeStyle = '#8A5A32'; g.lineWidth = 3.5; g.beginPath(); g.moveTo(hx - 17, hy + 15); g.quadraticCurveTo(hx, hy - 16, hx + 17, hy + 15); g.stroke();
    }
  },
  balloons: {
    mode: 'upright', tilt0: 0, hold: { pose: 'grip', tgt: [34, 20, 6] },
    draw(g, t, o) {
      [[-14, -118, TOMATO], [6, -142, MUSTARD], [26, -112, PINK], [40, -136, GREEN]].forEach(([dx, dy, c], i) => {
        const sx = Math.sin(t * 1.9 + i * 1.3) * 5, bx = dx + sx, by = dy;
        g.strokeStyle = 'rgba(34,30,26,.55)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(dx * .3, dy * .5, bx, by + 19); g.stroke();
        g.fillStyle = c; g.beginPath(); g.ellipse(bx, by, 15, 19, sx * .02, 0, 7); g.fill();
        g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.ellipse(bx - 5, by - 7, 3.5, 6, .5, 0, 7); g.fill();
        g.fillStyle = c; g.beginPath(); g.moveTo(bx - 3, by + 20); g.lineTo(bx + 3, by + 20); g.lineTo(bx, by + 24); g.closePath(); g.fill();
      });
    }
  },
  umbrella: {
    mode: 'upright', tilt0: .08, hold: { pose: 'grip', tgt: [26, 20, -6] },
    draw(g, t, o) {
      const c = o.col || TOMATO, R = 46, top = -62;
      g.strokeStyle = INK; g.lineWidth = 2.6; g.lineCap = 'round'; g.beginPath(); g.moveTo(0, top); g.lineTo(0, 12); g.arc(-5, 12, 5, 0, Math.PI); g.stroke();
      g.fillStyle = c; g.beginPath(); g.moveTo(-R, top + 14); g.quadraticCurveTo(-R * .95, top - 24, 0, top - 24); g.quadraticCurveTo(R * .95, top - 24, R, top + 14);
      const n = 4, w = 2 * R / n; for (let i = n; i > 0; i--) g.quadraticCurveTo(R - (i - .5) * w, top + 4, R - i * w + 0, top + 14); g.closePath(); g.fill();
      g.fillStyle = shade(c, -.18); g.beginPath(); g.moveTo(0, top - 24); g.quadraticCurveTo(R * .5, top - 22, R * .72, top + 8); g.lineTo(R * .3, top + 8); g.closePath(); g.fill();
      g.fillStyle = INK; g.fillRect(-1.2, top - 28, 2.4, 6);
    }
  },
  mug: {
    mode: 'upright', tilt0: 0, hold: { pose: 'grip', tgt: [22, 14, -4] },
    draw(g, t, o) {
      const c = o.col || CREAM; g.fillStyle = c; rrect(g, -7, -14, 14, 16, 3); g.fill(); g.strokeStyle = c; g.lineWidth = 3; g.beginPath(); g.arc(8, -6, 4.4, -1.4, 1.4); g.stroke();
      g.fillStyle = shade(c, -.14); g.fillRect(-7, -14, 14, 3.5); g.fillStyle = '#7A4A32'; g.fillRect(-5.5, -13.2, 11, 2);
      g.strokeStyle = 'rgba(34,30,26,.28)'; g.lineWidth = 1.8; g.lineCap = 'round';
      for (let i = 0; i < 2; i++) { const ph = t * 1.6 + i * 1.7; g.beginPath(); g.moveTo(-2 + i * 4, -17); g.bezierCurveTo(-5 + i * 4 + Math.sin(ph) * 2, -22, 1 + i * 4 + Math.sin(ph + 1) * 2, -26, -1 + i * 4 + Math.sin(ph + 2) * 2, -31); g.stroke() }
    }
  },
  pen: {
    mode: 'follow', rot: .35, hold: { pose: 'pinch', tgt: [26, 16, -10] },
    draw(g, t, o) { g.lineCap = 'round'; g.strokeStyle = o.col || TOMATO; g.lineWidth = 2.8; g.beginPath(); g.moveTo(-6, 0); g.lineTo(11, 0); g.stroke(); g.strokeStyle = INK; g.lineWidth = 2; g.beginPath(); g.moveTo(11, 0); g.lineTo(15.5, 0); g.stroke() }
  },
  magnifier: {
    mode: 'follow', rot: -.5, hold: { pose: 'grip', tgt: [34, 24, 10] },
    draw(g, t, o) { g.lineCap = 'round'; g.strokeStyle = '#8A5A32'; g.lineWidth = 4; g.beginPath(); g.moveTo(-6, 0); g.lineTo(6, 0); g.stroke(); g.fillStyle = 'rgba(207,230,220,.7)'; g.beginPath(); g.arc(16, 0, 10.5, 0, 7); g.fill(); g.strokeStyle = INK; g.lineWidth = 3.2; g.stroke(); g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.ellipse(13, -3.5, 3, 1.8, -.6, 0, 7); g.fill() }
  },
  megaphone: {
    mode: 'follow', rot: -.1, hold: { pose: 'grip', tgt: [34, 22, 4] },
    draw(g, t, o) {
      const c = o.col || TOMATO; fillPoly(g, [[-4, -4.5], [8, -5], [28, -14], [28, 14], [8, 5], [-4, 4.5]], c); fillPoly(g, [[8, -5], [28, -14], [28, -6], [8, -1]], shade(c, .18));
      g.fillStyle = INK; rrect(g, 26.5, -15, 4, 30, 2); g.fill(); g.fillStyle = shade(c, -.3); rrect(g, -8, -3, 8, 6, 2); g.fill();
    }
  },
  key: {
    mode: 'follow', rot: .2, hold: { pose: 'pinch', tgt: [28, 14, -2] },
    draw(g, t, o) { g.strokeStyle = o.col || MUSTARD; g.lineWidth = 2.6; g.lineCap = 'round'; g.beginPath(); g.moveTo(-4, 0); g.lineTo(13, 0); g.moveTo(10, 0); g.lineTo(10, 4.5); g.moveTo(13.5, 0); g.lineTo(13.5, 3.5); g.stroke(); g.beginPath(); g.arc(-8, 0, 4.2, 0, 7); g.stroke() }
  },
  flag: {
    mode: 'upright', tilt0: .06, hold: { pose: 'grip', tgt: [26, 20, 0] },
    draw(g, t, o) {
      const c = o.col || TOMATO; g.strokeStyle = INK; g.lineWidth = 3; g.lineCap = 'round'; g.beginPath(); g.moveTo(0, 16); g.lineTo(0, -66); g.stroke();
      const w = i => Math.sin(t * 5 - i * .9) * 3; g.fillStyle = c; g.beginPath(); g.moveTo(1, -64);
      for (let i = 1; i <= 6; i++) g.lineTo(1 + i * 7, -64 + w(i) * (i / 6)); for (let i = 6; i >= 1; i--) g.lineTo(1 + i * 7, -40 + w(i + 1) * (i / 6)); g.lineTo(1, -40); g.closePath(); g.fill();
      g.fillStyle = shade(c, -.2); g.beginPath(); g.moveTo(1, -64); g.lineTo(8, -64 + w(1) / 6); g.lineTo(8, -40 + w(2) / 6); g.lineTo(1, -40); g.closePath(); g.fill();
      g.fillStyle = MUSTARD; g.beginPath(); g.arc(0, -68, 3, 0, 7); g.fill();
    }
  },
  signboard: {
    mode: 'upright', tilt0: .03, hold: { pose: 'grip', tgt: [24, 18, 4] },
    draw(g, t, o) {
      g.strokeStyle = '#8A5A32'; g.lineWidth = 4; g.lineCap = 'round'; g.beginPath(); g.moveTo(0, 20); g.lineTo(0, -34); g.stroke();
      g.fillStyle = SHADOW; rrect(g, -34 + 3, -80 + 3, 68, 48, 5); g.fill(); g.fillStyle = o.col || CREAM; rrect(g, -34, -80, 68, 48, 5); g.fill(); g.strokeStyle = INK; g.lineWidth = 3; g.stroke();
      g.save(); g.translate(0, -50); g.scale(o.dir || 1, 1); txt(g, o.text || 'HELLO', 0, 0, { s: 14, al: 'center', c: INK }); g.restore();
    }
  },
};
/** list of prop kinds */
export const PROP_KINDS = Object.keys(PROPS);

/** draw a prop at hand joint J={x,y,ang,dir}; see header for options */
export function drawProp(g, kind, J, o = {}, t = 0) {
  const d = PROPS[kind]; if (!d) return;
  g.save(); g.translate(J.x, J.y); const dir = J.dir || 1;
  if (d.mode === 'follow') { g.rotate((J.ang || 0)); g.scale(1, dir < 0 ? -1 : 1); g.rotate(d.rot || 0) }
  else { g.scale(dir, 1); g.rotate((d.tilt0 || 0) + (o.tilt || 0)) }
  const s = o.s ?? 1; g.scale(s, s); d.draw(g, t, { ...o, dir: o.sdir ?? dir }); g.restore();
}

function mkAsset(kind) {
  const draw = (g, t, params) => { const p = withDefaults(params, { x: 640, y: 440, ang: 0, s: 4, dir: 1 }); drawProp(g, kind, { x: p.x, y: p.y, ang: p.ang, dir: p.dir }, p, t) };
  const meta = defMeta({
    id: 'people/prop-' + kind, kind: 'prop', mode: 'both', title: kind[0].toUpperCase() + kind.slice(1) + ' (held prop)', duration: 4,
    description: `A paper-cut ${kind} drawn at the grip point; normally attached to a character's hand via person.props, but can also be drawn alone large for a close-up.`,
    params: { x: P('number', 640, 'grip x'), y: P('number', 440, 'grip y'), s: P('number', 4, 'scale'), ang: P('number', 0, 'forearm angle (follow props)'), col: P('color', null, 'accent colour'), text: P('string', 'HELLO', 'text (signboard)'), open: P('number', 1, 'laptop lid 0..1'), scroll: P('number', 0, 'phone scroll px'), tap: P('number', 0, 'phone tap 0..1') },
    anchors: {}, markers: [], tags: ['prop', 'held', kind], bounds: [440, 160, 400, 400], origin: [640, 440], example: `assets['people/prop-${kind}'].draw(g,t,{s:4})`
  });
  return { meta, draw, markers: () => [] };
}
export const assets = Object.fromEntries(PROP_KINDS.map(k => { const a = mkAsset(k); a.draw = idled(a.meta.id, a.draw, () => a.meta); return ['people/prop-' + k, a] }));
