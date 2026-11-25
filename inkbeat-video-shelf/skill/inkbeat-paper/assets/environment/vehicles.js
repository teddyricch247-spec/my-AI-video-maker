/**
 * environment/vehicles.js — side-view vehicles whose wheels turn with the ground distance they travel.
 *
 * drawVehicle(g, kind, t, o): kind = bus car taxi motorbike bicycle handcart truck boat train plane.
 *   o = { x,y (ground contact / waterline of the vehicle's CENTRE at t=0), s, dir (+1 faces right), speed (px/s), at:{start,stop} (s; null start = already moving; stop eases to rest),
 *         travel (default true: the vehicle itself moves dir*distance), col, text, doors (0..1 bus/taxi doors open) , rider (bool: draw a simple rider on bicycle / motorbike) }
 * Wheel angle = distance / radius, so tyres never slip. Distance eases over .6 s at start and stop (see locomotion.travelDist).
 * vehicleX(o,t) -> scene x of the vehicle centre at time t; vehicleMarkers(o) -> 'whoosh' (pass), 'thud' (stop), 'slide' (doors).
 * Registered: 'env/vehicle-<kind>'.
 *
 *   drawVehicle(g,t,'bus',{x:-300,y:600,speed:260,at:{start:0,stop:4.2}});
 *   assets['env/vehicle-taxi'].draw(g,t,{x:640,y:600,speed:0});
 */
import { lerp, shade, rrect, cl, eio, txt } from '../core/core.js';
import { INK, TOMATO, MUSTARD, GREEN, PINK, CREAM, SHADOW, AQUA, MONO } from '../core/palette.js';
import { travelDist } from '../people/locomotion.js';
import { mk, P, XY, withDefaults } from './_meta.js';

const DEFV = { x: 640, y: 600, s: 1, dir: 1, speed: 0, at: { start: null, stop: null }, travel: true };
function dist(o, t) { return travelDist(t, { speed: o.speed, from: o.at.start, to: o.at.stop, ramp: .6 }) }
export function vehicleX(o0, t) { const o = withDefaults(o0, DEFV); return o.x + (o.travel ? o.dir * dist(o, t) : 0) }
function wheel(g, x, y, r, ang, col = INK, hub = CREAM) {
  g.fillStyle = INK; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.fillStyle = '#6E6A66'; g.beginPath(); g.arc(x, y, r * .62, 0, 7); g.fill();
  g.save(); g.translate(x, y); g.rotate(ang); g.strokeStyle = hub; g.lineWidth = Math.max(2, r * .09); g.lineCap = 'round'; for (let i = 0; i < 5; i++) { const a = i * 1.2566; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * r * .55, Math.sin(a) * r * .55); g.stroke() } g.fillStyle = hub; g.beginPath(); g.arc(0, 0, r * .16, 0, 7); g.fill(); g.restore();
}
const winG = (g, x, y, w, h) => { g.fillStyle = '#CFE6DC'; rrect(g, x, y, w, h, 5); g.fill(); g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.moveTo(x + 6, y + h - 4); g.lineTo(x + 16, y + 4); g.lineTo(x + 24, y + 4); g.lineTo(x + 14, y + h - 4); g.closePath(); g.fill() };
export const VEHICLE_KINDS = ['bus', 'car', 'taxi', 'motorbike', 'bicycle', 'handcart', 'truck', 'boat', 'train', 'plane'];
export function drawVehicle(g, kind, t, o0) {
  const o = withDefaults(o0, DEFV), D = dist(o, t), x = o.x + (o.travel ? o.dir * D : 0), col = o.col, bounce = o.speed ? Math.sin(t * 16 + 1) * .0 : 0;
  g.save(); g.translate(x, o.y); g.scale(o.s * o.dir, o.s);
  const sh = (w) => { g.fillStyle = 'rgba(70,35,25,.22)'; g.beginPath(); g.ellipse(0, 3, w, 7, 0, 0, 7); g.fill() };
  const moving = o.speed ? cl(D > 0 ? 1 : 0) : 0, jig = o.speed && (o.at.stop == null || t < o.at.stop - .2) ? Math.sin(t * 17) * .6 : 0;
  switch (kind) {
    case 'bus': {
      const c = col || TOMATO, L = -150, Rr = 150; sh(150); g.translate(0, jig);
      g.fillStyle = c; rrect(g, L, -122, 300, 100, 14); g.fill(); g.fillStyle = shade(c, -.16); g.fillRect(L + 8, -50, 284, 28); g.fillStyle = CREAM; g.fillRect(L, -68, 300, 8);
      for (let i = 0; i < 5; i++) winG(g, L + 16 + i * 42, -108, 36, 38); winG(g, Rr - 62, -108, 52, 54); g.fillStyle = shade(c, -.2); const dw = 44 * (1 - (o.doors || 0) * .85); g.fillRect(L + 232 - 44, -110, 2, 86); g.fillStyle = '#CFE6DC'; g.fillRect(L + 222 - (o.doors ? 0 : 0), -104, 44 - dw * 0 - (o.doors || 0) * 30, 80); g.fillStyle = MUSTARD; g.beginPath(); g.arc(Rr - 6, -40, 6, 0, 7); g.fill(); g.fillStyle = TOMATO; g.beginPath(); g.arc(L + 6, -40, 5, 0, 7); g.fill(); g.fillStyle = INK; rrect(g, Rr - 96, -134, 84, 24, 5); g.fill(); g.save(); g.scale(o.dir, 1); txt(g, o.text || '42 CITY', (Rr - 54) * o.dir, -117, { s: Math.max(14, 14 / o.s), f: MONO, al: 'center', c: MUSTARD }); g.restore();
      const r = 26; wheel(g, L + 60, -r + 2, r, D / r); wheel(g, Rr - 60, -r + 2, r, D / r); break }
    case 'car': case 'taxi': {
      const c = col || (kind === 'taxi' ? MUSTARD : '#5E8C8A'); sh(95); g.translate(0, jig);
      g.fillStyle = c; g.beginPath(); g.moveTo(-92, -22); g.lineTo(-92, -50); g.quadraticCurveTo(-90, -60, -70, -62); g.lineTo(-44, -66); g.lineTo(-26, -96); g.quadraticCurveTo(-22, -100, -14, -100); g.lineTo(34, -100); g.quadraticCurveTo(44, -100, 50, -92); g.lineTo(70, -64); g.lineTo(86, -58); g.quadraticCurveTo(94, -54, 94, -40); g.lineTo(94, -22); g.closePath(); g.fill();
      g.fillStyle = shade(c, -.16); g.fillRect(-92, -40, 186, 14); winG(g, -20, -94, 30, 28); g.fillStyle = '#CFE6DC'; g.beginPath(); g.moveTo(16, -94); g.lineTo(36, -94); g.lineTo(54, -68); g.lineTo(16, -68); g.closePath(); g.fill(); g.fillStyle = shade(c, -.25); g.fillRect(8, -92, 3, 54);
      g.fillStyle = '#FFE7A6'; g.beginPath(); g.ellipse(90, -44, 5, 7, 0, 0, 7); g.fill(); g.fillStyle = TOMATO; g.fillRect(-94, -48, 5, 10);
      if (kind === 'taxi') { g.fillStyle = INK; rrect(g, -12, -122, 52, 22, 4); g.fill(); g.save(); g.scale(o.dir, 1); txt(g, 'TAXI', 14 * o.dir, -106, { s: Math.max(14, 14 / o.s), f: MONO, al: 'center', c: CREAM }); g.restore(); g.fillStyle = INK; for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? INK : CREAM; g.fillRect(-90 + i * 8, -34, 8, 6) } }
      const r = 19; wheel(g, -56, -r + 2, r, D / r); wheel(g, 58, -r + 2, r, D / r); g.fillStyle = shade(c, -.3); g.beginPath(); g.arc(-56, -r + 2 - 10, r + 5, Math.PI, 0); g.arc(58, -r + 2 - 10, 0, 0, 0); g.fill(); wheel(g, -56, -r + 2, r, D / r); wheel(g, 58, -r + 2, r, D / r); break }
    case 'motorbike': {
      sh(60); g.translate(0, jig); const r = 20, c = col || TOMATO; wheel(g, -42, -r + 1, r, D / r); wheel(g, 44, -r + 1, r, D / r);
      g.strokeStyle = INK; g.lineWidth = 5; g.lineCap = 'round'; g.beginPath(); g.moveTo(44, -r + 1); g.lineTo(32, -52); g.lineTo(26, -60); g.moveTo(-42, -r + 1); g.lineTo(-18, -34); g.lineTo(14, -34); g.lineTo(32, -52); g.stroke();
      g.fillStyle = c; g.beginPath(); g.moveTo(-6, -50); g.quadraticCurveTo(10, -66, 28, -56); g.lineTo(24, -40); g.lineTo(-4, -40); g.closePath(); g.fill(); g.fillStyle = shade(c, -.3); rrect(g, -34, -50, 34, 10, 4); g.fill(); g.strokeStyle = INK; g.lineWidth = 5; g.beginPath(); g.moveTo(26, -60); g.lineTo(22, -72); g.lineTo(34, -72); g.stroke(); g.fillStyle = '#FFE7A6'; g.beginPath(); g.arc(37, -58, 5, 0, 7); g.fill(); g.fillStyle = '#8E8A84'; rrect(g, -4, -32, 24, 8, 3); g.fill(); break }
    case 'bicycle': {
      sh(44); g.translate(0, jig * .5); const r = 22, c = col || GREEN; wheel(g, -34, -r + 1, r, D / r, INK, '#B8B0A0'); wheel(g, 34, -r + 1, r, D / r, INK, '#B8B0A0');
      const cx = Math.cos(D / 8 * 0) * 0, ph = D / 26; g.strokeStyle = c; g.lineWidth = 4.4; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(-34, -r + 1); g.lineTo(-8, -50); g.lineTo(26, -50); g.lineTo(34, -r + 1); g.moveTo(-8, -50); g.lineTo(2, -r + 1); g.lineTo(-34, -r + 1); g.moveTo(26, -50); g.lineTo(22, -66); g.lineTo(32, -66); g.moveTo(-8, -50); g.lineTo(-12, -58); g.stroke(); g.fillStyle = INK; rrect(g, -20, -62, 18, 5, 2.5); g.fill();
      g.strokeStyle = INK; g.lineWidth = 3.4; const px = 2 + Math.cos(ph) * 9, py = -r + 1 + Math.sin(ph) * 9; g.beginPath(); g.moveTo(2 - Math.cos(ph) * 9, -r + 1 - Math.sin(ph) * 9); g.lineTo(px, py); g.stroke(); g.fillStyle = INK; g.fillRect(px - 5, py - 2, 10, 4); g.fillRect(2 - Math.cos(ph) * 9 - 5, -r + 1 - Math.sin(ph) * 9 - 2, 10, 4); break }
    case 'handcart': {
      sh(70); g.translate(0, jig * .6); const r = 26, c = col || '#B07A4A'; g.fillStyle = c; g.beginPath(); g.moveTo(-60, -50); g.lineTo(52, -50); g.lineTo(44, -22); g.lineTo(-52, -22); g.closePath(); g.fill(); g.fillStyle = shade(c, -.2); g.fillRect(-60, -56, 112, 8); g.strokeStyle = shade(c, -.35); g.lineWidth = 3; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(-40 + i * 28, -48); g.lineTo(-38 + i * 28, -24); g.stroke() }
      g.fillStyle = TOMATO; [[-30, -64], [-10, -68], [12, -64], [32, -66]].forEach(([a, b], i) => { g.fillStyle = [TOMATO, MUSTARD, '#8DBB4C', '#F08A24'][i]; g.beginPath(); g.arc(a, b, 12, 0, 7); g.fill() }); g.strokeStyle = '#6E4A3C'; g.lineWidth = 5; g.lineCap = 'round'; g.beginPath(); g.moveTo(52, -42); g.lineTo(116, -48); g.moveTo(52, -34); g.lineTo(116, -48); g.stroke(); wheel(g, 0, -r + 2, r, D / r, INK, '#B8B0A0'); break }
    case 'truck': {
      const c = col || '#5E8C8A'; sh(150); g.translate(0, jig); g.fillStyle = '#E9DFC8'; rrect(g, -160, -150, 210, 124, 8); g.fill(); g.fillStyle = shade('#E9DFC8', -.14); g.fillRect(-160, -40, 210, 14); g.fillStyle = c; g.fillRect(-160, -92, 210, 14); g.save(); g.scale(o.dir, 1); txt(g, o.text || 'FRESH FARM', -55 * o.dir, -112, { s: Math.max(16, 14 / o.s), al: 'center', c: INK }); g.restore();
      g.fillStyle = c; g.beginPath(); g.moveTo(56, -26); g.lineTo(56, -108); g.lineTo(100, -108); g.lineTo(130, -70); g.lineTo(150, -64); g.lineTo(150, -26); g.closePath(); g.fill(); winG(g, 70, -98, 40, 34); g.fillStyle = shade(c, -.18); g.fillRect(56, -48, 94, 10); g.fillStyle = '#FFE7A6'; g.beginPath(); g.ellipse(146, -48, 5, 7, 0, 0, 7); g.fill();
      const r = 24; [-112, -62, 90].forEach(wx => wheel(g, wx, -r + 2, r, D / r)); break }
    case 'train': {
      const c = col || '#5E8C8A'; sh(270); g.translate(0, jig * .6);
      const car = (x0, w) => { g.fillStyle = c; rrect(g, x0, -112, w, 86, 10); g.fill(); g.fillStyle = shade(c, -.16); g.fillRect(x0, -46, w, 20); g.fillStyle = CREAM; g.fillRect(x0, -62, w, 6); for (let i = 0; i < 4; i++) winG(g, x0 + 12 + i * (w - 24) / 4, -102, (w - 24) / 4 - 8, 32); g.fillStyle = INK; g.fillRect(x0 + w - 3, -44, 8, 6) };
      car(-272, 150); car(-114, 150);
      g.fillStyle = TOMATO; g.beginPath(); g.moveTo(44, -26); g.lineTo(44, -112); g.lineTo(196, -112); g.quadraticCurveTo(250, -108, 274, -60); g.lineTo(274, -26); g.closePath(); g.fill();
      g.fillStyle = shade(TOMATO, -.18); g.fillRect(44, -46, 230, 20); g.fillStyle = CREAM; g.fillRect(44, -62, 230, 6);
      winG(g, 58, -102, 40, 32); winG(g, 106, -102, 40, 32); g.fillStyle = '#CFE6DC'; g.beginPath(); g.moveTo(164, -102); g.lineTo(196, -102); g.quadraticCurveTo(230, -96, 248, -68); g.lineTo(164, -68); g.closePath(); g.fill();
      g.fillStyle = '#FFE7A6'; g.beginPath(); g.ellipse(268, -40, 4, 6, 0, 0, 7); g.fill();
      const r = 16; [-240, -170, -82, -12, 72, 140, 204, 252].forEach(wx => wheel(g, wx, -r + 2, r, D / r)); break }
    case 'plane': {
      const c = col || CREAM; g.translate(0, -60 + Math.sin(t * 1.4) * 3); g.rotate(Math.sin(t * .9) * .012);
      g.fillStyle = TOMATO; g.beginPath(); g.moveTo(-150, -40); g.lineTo(-192, -112); g.lineTo(-156, -112); g.lineTo(-94, -40); g.closePath(); g.fill();
      g.fillStyle = shade(c, -.22); g.beginPath(); g.moveTo(-160, -26); g.lineTo(-198, -44); g.lineTo(-176, -44); g.lineTo(-110, -26); g.closePath(); g.fill();
      g.save(); g.beginPath(); g.moveTo(-172, -30); g.quadraticCurveTo(-120, -60, -40, -60); g.lineTo(100, -60); g.quadraticCurveTo(190, -58, 206, -28); g.quadraticCurveTo(190, -2, 100, 0); g.lineTo(-100, 0); g.quadraticCurveTo(-150, -6, -172, -30); g.closePath();
      g.fillStyle = c; g.fill(); g.clip(); g.fillStyle = TOMATO; g.fillRect(-200, -18, 420, 7); g.fillStyle = shade(c, -.14); g.fillRect(-200, -8, 420, 10); g.restore();
      for (let i = 0; i < 11; i++) { g.fillStyle = '#9CC3CB'; g.beginPath(); g.ellipse(-110 + i * 18, -40, 4.2, 5.2, 0, 0, 7); g.fill() }
      g.fillStyle = '#7FA9B4'; g.beginPath(); g.moveTo(150, -52); g.lineTo(184, -50); g.quadraticCurveTo(196, -44, 198, -38); g.lineTo(150, -38); g.closePath(); g.fill();
      g.fillStyle = shade(c, -.2); g.beginPath(); g.moveTo(24, -12); g.lineTo(-52, 30); g.lineTo(-20, 30); g.lineTo(78, -12); g.closePath(); g.fill();
      g.fillStyle = shade(c, -.32); g.beginPath(); g.ellipse(16, 18, 30, 10, 0, 0, 7); g.fill(); g.fillStyle = TOMATO; g.beginPath(); g.ellipse(44, 18, 5, 8, 0, 0, 7); g.fill(); break }
    case 'boat': {
      const c = col || TOMATO, bob = Math.sin(t * 1.6) * 3, rk = Math.sin(t * 1.3) * .03; g.translate(0, bob); g.rotate(rk); g.fillStyle = 'rgba(70,35,25,.0)';
      g.fillStyle = c; g.beginPath(); g.moveTo(-110, -30); g.lineTo(110, -30); g.quadraticCurveTo(96, 6, 60, 8); g.lineTo(-70, 8); g.quadraticCurveTo(-100, 4, -110, -30); g.closePath(); g.fill(); g.fillStyle = CREAM; g.fillRect(-106, -38, 214, 9); g.fillStyle = shade(c, -.2); g.beginPath(); g.moveTo(-70, 8); g.lineTo(60, 8); g.quadraticCurveTo(70, 8, 78, 2); g.lineTo(-86, 2); g.closePath(); g.fill();
      g.strokeStyle = '#6E4A3C'; g.lineWidth = 5; g.beginPath(); g.moveTo(4, -38); g.lineTo(4, -168); g.stroke(); const sw = Math.sin(t * 1.6 + 1) * 3; g.fillStyle = CREAM; g.beginPath(); g.moveTo(8, -164); g.quadraticCurveTo(66 + sw, -110, 80 + sw, -50); g.lineTo(8, -46); g.closePath(); g.fill(); g.fillStyle = MUSTARD; g.beginPath(); g.moveTo(8, -164); g.lineTo(4, -168); g.lineTo(-44, -60); g.lineTo(0, -48); g.lineTo(2, -48); g.closePath(); g.fill(); break }
  }
  g.restore();
}
export function vehicleMarkers(o0, kind) {
  const o = withDefaults(o0, DEFV), m = [];
  if (!o.speed) return m; if (o.at.start != null) m.push({ id: 'start', t: o.at.start, kind: 'whoosh' });
  if (o.at.stop != null) { m.push({ id: 'stop', t: o.at.stop, kind: 'thud' }); if (kind === 'bus') m.push({ id: 'doors', t: o.at.stop + .5, kind: 'slide' }) }
  return m;
}
const NICE = { bus: 'Bus', car: 'Car', taxi: 'Taxi', motorbike: 'Motorbike', bicycle: 'Bicycle', handcart: 'Handcart with fruit', truck: 'Delivery truck', boat: 'Sailing boat', train: 'Train', plane: 'Airliner' };
export const assets = Object.fromEntries(VEHICLE_KINDS.map(k => ['env/vehicle-' + k, mk('env/vehicle-' + k, {
  title: NICE[k], description: `${NICE[k]} in side view${k === 'boat' ? ' bobbing on the water (draw over water)' : k === 'plane' ? ' flying with a gentle bob (no shadow; y is the belly line, draw it high in the sky)' : ' with wheels that turn exactly with the ground distance'}; set speed and at.start / at.stop for drive-in, drive-through or stop. Use in street, city, transport and delivery scenes.`, tags: ['vehicle', k, 'transport', 'wheels'],
  params: { ...XY, dir: P('number', 1, 'facing +1 right / -1 left'), speed: P('number', 0, 'px/s'), col: P('color', null, 'body colour'), text: P('string', null, 'destination / sign text'), doors: P('number', 0, 'bus doors open 0..1'), travel: P('bool', true, 'vehicle moves across the scene') },
  anchors: { start: { default: null, desc: 'seconds when it starts moving (null = already moving)' }, stop: { default: null, desc: 'seconds when it comes to rest' } }, markerKinds: ['whoosh', 'thud', 'slide'], bounds: [-170, -200, 340, 220], origin: [0, 0], example: `assets['env/vehicle-${k}'].draw(g,t,{x:-250,y:600,speed:260,at:{start:0,stop:4}})`
}, (g, t, p) => drawVehicle(g, k, t, p || {}), p => vehicleMarkers(p || {}, k))]));
