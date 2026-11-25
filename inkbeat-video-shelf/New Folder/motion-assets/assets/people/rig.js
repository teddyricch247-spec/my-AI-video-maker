/**
 * people/rig.js — the character rig: skeleton solver with two-bone IK, locomotion + gesture layering, draw order for side and front views, markers.
 *
 * legacyPerson(g,o) is the v2.html person() ported verbatim (used only by the seed scenes so they stay pixel-exact).
 * solvePerson(spec,t) -> joints in scene coordinates; drawPerson(g,t,spec) draws; personMarkers(spec,tMax) -> footfall + gesture markers.
 * Person spec: character fields (preset from people/characters.js) + x,y,s,dir,view('side'|'front'),half,walk{speed,from,to,mode},turns,gestures[{name,at,dur,hand,target,n}],props,face,faces,talk,look,blink,seed,lod,sil.
 * Registered: 'people/person' (any preset / full spec), 'people/gesture' (one preset doing one named gesture), 'people/walk' (a preset walking or running in from a start anchor to a stop anchor).
 *
 *   assets['people/person'].draw(g,t,{spec:'doctor',view:'front',gestures:[{name:'wave',at:1,dur:2.4}]});
 */
import { cl, lerp, shade, rrect, eio, eo } from '../core/core.js';
import { INK, TOMATO, MUSTARD, GREEN, PINK, CREAM, SHADOW } from '../core/palette.js';
import { drawHand, mixPose } from './hands.js';
import { resolveFace, drawFace } from './faces.js';
import { drawProp, PROPS } from './props-held.js';
import { gait, footPose, dirAt, turnHop, breath, weightShift, footstepTimes, travelDist } from './locomotion.js';
import { GESTURES, TWO_HAND, HEAD_ONLY, envelope, gestureMarkers } from './gestures.js';
import { drawHairBack, drawHairFront, drawHeadAcc, drawBodyBack, drawTorso, drawBodyFront, character, characterNames } from './characters.js';
import { defMeta, P, ANC, withDefaults } from '../environment/_meta.js';

export function legacyPerson(g, o) {
  const s = o.s || 1, dir = o.dir || 1, ph = o.ph || 0, wk = o.walk ?? 1, sil = o.sil, t = o.t || 0;
  const K = c => sil || c;
  const skin = K(o.skin), hairC = K(o.hair), coat = K(o.coat), pants = K(o.pants), shoe = K(o.shoe), acc = K(o.acc || o.coat);
  const leg = p => {
    const h = Math.sin(p) * .55 * wk, k = Math.max(0, Math.sin(p + 1.1)) * .95 * wk;
    const hy = -76, kx = Math.sin(h) * 38, ky = hy + Math.cos(h) * 38, fx = kx + Math.sin(h - k) * 38, fy = ky + Math.cos(h - k) * 38; return { kx, ky, fx, fy, hy }
  };
  const LA = leg(ph), LB = leg(ph + Math.PI);
  g.save(); g.translate(o.x, o.y); g.scale(s * dir, s);
  if (!sil && !o.noShadow) { g.fillStyle = 'rgba(70,35,25,.22)'; g.beginPath(); g.ellipse(0, 1, 40, 7, 0, 0, 7); g.fill() }
  g.translate(0, -Math.max(LA.fy, LB.fy));
  const drawLeg = (L, col) => {
    g.strokeStyle = col; g.lineWidth = 15; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(0, L.hy); g.lineTo(L.kx, L.ky); g.lineTo(L.fx, L.fy); g.stroke();
    g.fillStyle = shoe; g.beginPath(); g.roundRect(L.fx - 6, L.fy - 3, 26, 11, 5); g.fill()
  };
  drawLeg(LB, sil || shade(o.pants, -.22)); drawLeg(LA, pants);
  g.save(); g.translate(0, -78); g.rotate(Math.sin(ph) * .03 * wk); g.translate(0, 78);
  const arm = (a1, a2, col) => {
    const sy = -128, ex = Math.sin(a1) * 28, ey = sy + Math.cos(a1) * 28, hx = ex + Math.sin(a2) * 26, hy = ey + Math.cos(a2) * 26;
    g.strokeStyle = col; g.lineWidth = 12; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(0, sy); g.lineTo(ex, ey); g.lineTo(hx, hy); g.stroke();
    g.fillStyle = skin; g.beginPath(); g.arc(hx, hy, 6.5, 0, 7); g.fill(); return [hx, hy]
  };
  const sw = Math.sin(ph) * .5 * wk;
  arm(sw + .05, sw + .4, sil || shade(o.coat, -.22));
  g.fillStyle = skin; g.fillRect(-4, -150, 12, 14);
  const cLen = o.coatLen ?? .6, hemY = lerp(-80, -36, cLen), hemW = 22 + cLen * 8;
  g.fillStyle = coat; g.beginPath(); g.moveTo(-18, -133); g.quadraticCurveTo(0, -143, 18, -133); g.lineTo(hemW, hemY); g.quadraticCurveTo(0, hemY + 6, -hemW, hemY); g.closePath(); g.fill();
  if (!sil) {
    g.fillStyle = shade(o.coat, -.14); g.beginPath(); g.moveTo(-18, -133); g.lineTo(-7, -136); g.lineTo(-hemW * .35, hemY + 3); g.lineTo(-hemW, hemY); g.closePath(); g.fill();
    g.fillStyle = acc; rrect(g, -15, -143, 30, 11, 5.5); g.fill();
    g.fillStyle = 'rgba(34,30,26,.4)'; g.beginPath(); g.arc(8, -116, 2.3, 0, 7); g.fill(); g.beginPath(); g.arc(8, -100, 2.3, 0, 7); g.fill()
  }
  let hand;
  if (o.pose === 'wave') { hand = [0, 0] }
  else if (o.prop === 'basket') hand = arm(.55, 1.5, coat);
  else if (o.prop === 'balloons') hand = arm(.85, 1.85, coat);
  else hand = arm(-sw + .05, -sw + .4, coat);
  if (o.prop === 'basket' && !sil) {
    const hx = hand[0], hy = hand[1];
    g.fillStyle = '#C58B4A'; g.beginPath(); g.moveTo(hx - 19, hy + 14); g.lineTo(hx + 19, hy + 14); g.lineTo(hx + 13, hy + 40); g.lineTo(hx - 13, hy + 40); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(60,30,10,.3)'; g.lineWidth = 2; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(hx - 17 + i * 1.5, hy + 20 + i * 7); g.lineTo(hx + 17 - i * 1.5, hy + 20 + i * 7); g.stroke() }
    [['#F08A24', -10, 10], ['#F5D142', 2, 6], ['#8DBB4C', 12, 11], [TOMATO, -2, 12]].forEach(([c, dx, dy]) => { g.fillStyle = c; g.beginPath(); g.arc(hx + dx, hy + dy, 8.5, 0, 7); g.fill() });
    g.strokeStyle = '#8A5A32'; g.lineWidth = 3.5; g.beginPath(); g.moveTo(hx - 17, hy + 15); g.quadraticCurveTo(hx, hy - 16, hx + 17, hy + 15); g.stroke()
  }
  if (o.prop === 'balloons' && !sil) {
    const hx = hand[0], hy = hand[1];
    [[-14, -118, TOMATO], [6, -142, MUSTARD], [26, -112, PINK], [40, -136, GREEN]].forEach(([dx, dy, c], i) => {
      const sx = Math.sin(t * 1.9 + i * 1.3) * 5, bx = hx + dx + sx, by = hy + dy;
      g.strokeStyle = 'rgba(34,30,26,.55)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(hx, hy); g.quadraticCurveTo(hx + dx * .3, hy + dy * .5, bx, by + 19); g.stroke();
      g.fillStyle = c; g.beginPath(); g.ellipse(bx, by, 15, 19, sx * .02, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.ellipse(bx - 5, by - 7, 3.5, 6, .5, 0, 7); g.fill();
      g.fillStyle = c; g.beginPath(); g.moveTo(bx - 3, by + 20); g.lineTo(bx + 3, by + 20); g.lineTo(bx, by + 24); g.closePath(); g.fill()
    })
  }
  // head
  g.fillStyle = hairC;
  if (o.style === 'bun') { g.beginPath(); g.arc(-16, -192, 11, 0, 7); g.fill(); g.beginPath(); g.arc(-2, -170, 25, 0, 7); g.fill() }
  else { g.beginPath(); g.arc(0, -169, 24, 0, 7); g.fill() }
  g.fillStyle = skin; g.beginPath(); g.arc(3, -165, 21.5, 0, 7); g.fill();
  if (o.cap) { g.fillStyle = K(o.cap); g.beginPath(); g.ellipse(2, -173, 25.5, 17, 0, Math.PI, 2 * Math.PI); g.fill(); g.beginPath(); g.ellipse(19, -172, 15, 4.5, 0, 0, 7); g.fill() }
  if (!sil) {
    g.fillStyle = shade(o.skin, -.14); g.beginPath(); g.arc(-9, -164, 5, 0, 7); g.fill();
    g.fillStyle = INK; g.beginPath(); g.arc(11, -166, 2.7, 0, 7); g.fill(); g.beginPath(); g.arc(20, -166, 2.7, 0, 7); g.fill();
    g.fillStyle = 'rgba(242,100,120,.5)'; g.beginPath(); g.arc(17, -158, 4.5, 0, 7); g.fill();
    g.strokeStyle = INK; g.lineWidth = 2.2; g.lineCap = 'round'; g.beginPath(); g.arc(15, -157, 4.2, .15, Math.PI - .15); g.stroke()
  }
  if (o.pose === 'wave') { const a = 1.95 + Math.sin(t * 3) * .05, w = Math.sin(t * 9) * .4; arm(a, a + .85 + w, coat) }
  g.restore(); g.restore();
}
/** legacy presets (v2.html AMA / KOFI) */
export const AMA = e => ({ skin: '#8B5A3C', hair: '#241713', style: 'bun', coat: TOMATO, pants: '#4A3A33', shoe: '#2A1B17', acc: MUSTARD, coatLen: .8, s: 1.22, ...e });
export const KOFI = e => ({ skin: '#C58C5F', hair: '#241713', style: 'cap', cap: GREEN, coat: MUSTARD, pants: '#3F5E52', shoe: '#3A2A22', acc: '#FBF3E2', coatLen: .3, s: 1.34, ...e });

// =====================================================================================================================
//  NEW RIG: skeleton solver + drawing
// =====================================================================================================================
/**
 * solvePerson(o,t) -> joints in SCENE coordinates; drawPerson(g,t,o) draws from the very same solve.
 *
 * Person spec o (all optional): x,y (ground contact, scene px), s (scale; ~190*s px tall), dir (+1 faces right / -1 left), view ('side'|'front'),
 *   half (front view: hide legs, for a presenter cropped at the hips), plus a character spec from characters.js (skin, hair, top, pants, shoe, acc, wrap, headS)
 *   walk: {speed px/s, from, to, mode 'walk'|'run', stride, phase, travel (true = the figure itself moves across the scene), ramp}
 *   turns: [{at,dur,to}]   gestures: [...]   (see gestures.js)   props: [{kind, hand:'R'|'L', at, to, col, text}]
 *   face (name), faces [{at,name,dur}], talk {from,to}, look [x,y] (scene point the eyes follow), blink (false disables), seed, lod (0 full, 1 simple, 2 silhouette), sil (colour for lod 2)
 * Joints: head {x,y,r,rot}, neck, shoulders{L,R}, elbows{L,R}, hands{L,R} (wrists), palms{L,R} (grip points), hips{L,R}, knees{L,R}, feet{L,R} (ankles), pelvis, ground, dir, S (px per unit).
 *   Side view: 'R' is the NEAR arm/leg, 'L' the far one. Front view: 'R' is on the screen's right.
 *
 *   const J = solvePerson({...character('ama'),x:400,y:650,gestures:[{name:'wave',at:1,dur:2}]}, t);   // J.hands.R = [x,y]
 *   drawPerson(g,t,{...character('kofi'),x:640,y:650,view:'front',gestures:[{name:'point_at',at:1,dur:2,target:[900,300]}]});
 *   assets['people/person'].draw(g,t,{spec:'doctor',x:300,y:650,walk:{speed:150,travel:true}});
 */
export const RIG = { K: .955, ANKLE: 8, L: 41, REACH: 80, SH: 52, HEADY: 89, U1: 29, U2: 28, HS: 1.0 };
const sm01 = x => { x = cl(x); return x * x * (3 - 2 * x) };
const angLerp = (a, b, k) => { let d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return a + d * k };

function ik2(sx, sy, tx, ty, l1, l2, px, py) {
  let dx = tx - sx, dy = ty - sy, d = Math.hypot(dx, dy); const mx = l1 + l2 - .02, mn = Math.abs(l1 - l2) + .5;
  if (d > mx) { dx *= mx / d; dy *= mx / d; d = mx }
  if (d < mn) { if (d < 1e-6) { dx = 0; dy = mn; d = mn } else { dx *= mn / d; dy *= mn / d; d = mn } }
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a)), ux = dx / d, uy = dy / d;
  let nx = -uy, ny = ux; if (nx * px + ny * py < 0) { nx = -nx; ny = -ny }
  return [sx + ux * a + nx * h, sy + uy * a + ny * h, sx + dx, sy + dy];
}
const rot = (x, y, a) => { const c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c] };
const sgn = H => H === 'R' ? 1 : -1;

/** core solve in ground-local units (origin = ground contact, +y down, local +x = facing direction (side) / screen right (front)) */
function solveLocal(o, t) {
  const view = o.view === 'front' ? 'front' : 'side', side = view === 'side';
  const S = (o.s || 1) * RIG.K, seed = o.seed || 0, lod = o.lod || 0;
  let dirNow = side ? dirAt(o, t) : 1; const dirSafe = Math.abs(dirNow) < .04 ? (dirNow < 0 ? -.04 : .04) : dirNow;
  const g = gait(o, t), f = g.f, cfg = g.cfg, walking = !!o.walk;
  // ---- placement
  let X = o.x || 0, Y = o.y || 0;
  if (o.walk && o.walk.travel) {
    if (o.turns && o.turns.length) { let acc = 0, prev = 0, N = Math.ceil(t * 30); for (let i = 1; i <= N; i++) { const tt = i / 30, dd = g.win ? travelDist(tt, g.win) : 0; acc += dirAt(o, tt - 1 / 60) * (dd - prev); prev = dd } X += acc }
    else X += (o.dir ?? 1) * g.D;
  }
  const ts = t + seed * .37, br = breath(ts), ws = weightShift(ts) * (1 - f);
  // ---- feet
  const stand = { R: side ? 8 : 11, L: side ? -6 : -11 }, feet = {}, hipX0 = (side ? 1.6 : 3.2) * ws;
  const mode = g.mode;
  ['R', 'L'].forEach(H => {
    const isB = H === 'L', fp = walking ? footPose(cfg, g.stride, S, g.u, isB) : { dx: 0, lift: 0, ang: 0 };
    const ax = side ? lerp(stand[H], fp.dx, f) : stand[H] + (isB ? -1 : 1) * 0, lift = fp.lift * f;
    feet[H] = { x: ax, lift, ang: fp.ang * f, idleY: 0 };
  });
  // run: whole body hops (flight phase)
  let hop = 0; if (mode === 'run') hop = cfg.bob * f * Math.max(0, Math.sin(4 * Math.PI * g.u - .6));
  hop += turnHop(o, t);
  // ---- hip height (compass-gait bob, damped so the planted foot never visibly slides)
  const dxm = Math.max(Math.abs(feet.R.x - hipX0), Math.abs(feet.L.x - hipX0));
  const comp = Math.min(RIG.REACH + .5, Math.sqrt(Math.max(1, (RIG.REACH + 1.5) ** 2 - dxm * dxm)));
  const bobK = mode === 'run' ? .35 : .55;
  let hipH = RIG.ANKLE + lerp(RIG.REACH, comp, bobK * f);
  // sit (P1): lowers the hips onto a chair of height o.sit.h
  const sitK = o.sit ? sm01((t - o.sit.at) / .45) * (o.sit.to != null ? 1 - sm01((t - o.sit.to) / .45) : 1) : 0;
  // ---- lean, head dynamics from gestures
  const gl = [];
  (o.gestures || []).forEach((G, gi) => { if (t >= G.at && t <= G.at + G.dur) gl.push({ G, w: envelope(t, G.at, G.dur), tt: t - G.at, gi }) });
  let lean = cfg.lean * f + (side ? ws * .012 : ws * .02), shrug = 0, headRot = 0, headDy = 0, headNod = 0, shakeX = 0, faceG = null, faceGw = 0, lookG = null, lookw = 0, lookvG = null;
  const hipP = [hipX0, -hipH];
  const rotLean = () => lean;
  // body modifiers first (need lean before shoulders)
  const results = [];
  const bodyMods = [];
  // shoulders (provisional, needed to build gesture contexts)
  const cs = (L) => { const [rx, ry] = rot(0, -RIG.SH, L); return [hipP[0] + rx, hipP[1] + ry] };
  gl.forEach(e => { const r0 = GESTURES[e.G.name]; if (!r0) return; });
  // two passes: pass 1 determine lean from gesture 'body' (no shoulder dependence for lean/shrug)
  gl.forEach(e => {
    const fn = GESTURES[e.G.name]; if (!fn) return; const stub = { H: e.G.hand === 'L' ? 'L' : 'R', tt: e.tt, dur: e.G.dur, u: e.tt / e.G.dur, G: e.G, n: e.G.n, gap: e.G.gap, target: e.G.target, path: e.G.path, side, S: { R: { x: 0, y: 0 }, L: { x: 0, y: 0 } }, pt: () => [0, 0], A: () => 0, A0: () => 0, pv: () => [0, 1], toBody: p => p };
    const r = fn(stub); if (r && r.body) { if (r.body.lean != null) lean += r.body.lean * e.w; if (r.body.shrug) shrug += r.body.shrug * e.w }
  });
  const hip = [hipX0, -hipH + (sitK ? sitK * (o.sit.drop ?? 26) : 0)];
  const shC = rot(0, -RIG.SH - shrug * 4.5 - br * .6, lean), shoulderC = [hip[0] + shC[0], hip[1] + shC[1]];
  const shoulders = {}, SW = 21;
  if (side) { shoulders.R = [shoulderC[0] + 1.5, shoulderC[1]]; shoulders.L = [shoulderC[0] - 2.5, shoulderC[1] - .5] }
  else { const a = rot(SW, -RIG.SH - shrug * 4.5 - br * .6, lean), b = rot(-SW, -RIG.SH - shrug * 4.5 - br * .6, lean); shoulders.R = [hip[0] + a[0], hip[1] + a[1]]; shoulders.L = [hip[0] + b[0], hip[1] + b[1]] }
  const cxB = (shoulders.R[0] + shoulders.L[0]) / 2;
  // ---- scene <-> local mapping helpers
  const toBody = p => [(p[0] - X) / (dirSafe * S), (p[1] - Y) / S + hop];
  const toScene = p => [X + dirSafe * S * p[0], Y + S * (p[1] - hop)];
  // ---- arms: base (walk swing / idle / prop hold) then gestures
  const hs = RIG.HS * (o.handS || 1), aL = RIG.U1, bL = RIG.U2;
  const arms = {};
  const baseArm = H => {
    const sh = shoulders[H], s_ = sgn(H);
    // swing: near arm opposite to near leg (foot dx ~ cos(2pi(u-.05)))
    const th = (H === 'R' ? -1 : 1) * cfg.armAmp * Math.cos(2 * Math.PI * (g.u - .05)) * f;
    const Lh = lerp(53, cfg.armLen, f), idleOff = side ? [3 + ws * .5, 53] : [s_ * 6, 51];
    let tx, ty, pole, pose = f > .5 && mode === 'run' ? 'fist' : 'relaxed';
    if (side) { const rx = lerp(idleOff[0], Math.sin(th) * Lh, f), ry = lerp(idleOff[1], Math.cos(th) * Lh, f); tx = sh[0] + rx; ty = sh[1] + ry; pole = [-.5 - .6 * f, 1 + (mode === 'run' ? -1.3 * f : 0)] }
    else { const sw = Math.sin(th) * 8 * f; tx = sh[0] + idleOff[0] + s_ * 1; ty = sh[1] + idleOff[1] - Math.abs(sw) * .3 + (1 - f) * 0; pole = [s_ * .35, 1] }
    return { tx, ty, pole, pose, ang: null, prop: null, w: 0 };
  };
  const ptFn = H => (fw, lat, up, HH) => { const h = HH || H, sh = shoulders[h]; return side ? [sh[0] + fw, sh[1] - up] : [cxB + sgn(h) * lat, sh[1] - up] };
  const pvFn = H => (a, b, HH) => { const h = HH || H; return side ? [-a * .6, b] : [sgn(h) * a, b] };
  ['R', 'L'].forEach(H => { arms[H] = baseArm(H); arms[H].prop = null });
  // props spec (held items)
  const holdProps = [];
  (o.props || []).forEach(p => {
    const d = PROPS[p.kind]; if (!d) return; const H = p.hand || 'R', at = p.at ?? 0, to = p.to ?? Infinity;
    const w = sm01((t - at) / .3) * (1 - (isFinite(to) ? sm01((t - to) / .3) : 0)); if (w <= 0) return;
    holdProps.push({ p, H, w, d });
    const A = arms[H], tg = ptFn(H)(d.hold.tgt[0], d.hold.tgt[1], d.hold.tgt[2], H), sway = d.hold.hang ? Math.sin(t * 2.2 + seed) * 1.2 * f : Math.sin(t * 1.3) * .5;
    A.tx = lerp(A.tx, tg[0] + sway * (side ? 1 : 0), w); A.ty = lerp(A.ty, tg[1], w); A.pole = [lerp(A.pole[0], side ? -.3 : sgn(H) * .6, w), lerp(A.pole[1], 1, w)]; A.pose = w > .5 ? d.hold.pose : A.pose; A.holdW = w;
    A.propHeld = { kind: p.kind, col: p.col, text: p.text, w, tilt: p.tilt || 0 };
  });
  // gestures
  const mids = [];
  gl.forEach(e => {
    const fn = GESTURES[e.G.name]; if (!fn) return; const G = e.G, w = e.w;
    const hands = HEAD_ONLY.has(G.name) ? ['R'] : TWO_HAND.has(G.name) ? ['R'] : (G.hand === 'both' ? ['R', 'L'] : [G.hand === 'L' ? 'L' : 'R']);
    hands.forEach(Hc => {
      const c = {
        H: Hc, tt: e.tt, dur: G.dur, u: e.tt / G.dur, G, n: G.n, gap: G.gap, target: G.target, path: G.path, side,
        S: { R: { x: shoulders.R[0], y: shoulders.R[1] }, L: { x: shoulders.L[0], y: shoulders.L[1] } }, cx: cxB,
        pt: (fw, lat, up, HH) => ptFn(Hc)(fw, lat, up, HH || Hc), pv: (a, b, HH) => pvFn(Hc)(a, b, HH || Hc),
        A: a => (!side && Hc === 'L') ? Math.PI - a : a, A0: (a, HH) => (!side && (HH || Hc) === 'L') ? Math.PI - a : a,
        toBody
      };
      const r = fn(c); if (!r) return;
      ['R', 'L'].forEach(HH => {
        const rh = r[HH]; if (!rh) return; const A = arms[HH];
        A.tx = lerp(A.tx, rh.abs[0], w); A.ty = lerp(A.ty, rh.abs[1], w);
        if (rh.pv) A.pole = [lerp(A.pole[0], rh.pv[0], w), lerp(A.pole[1], rh.pv[1], w)];
        A.pose = { a: A.pose, b: rh.pose, k: w }; A.ang = rh.wrAbs != null ? { v: rh.wrAbs, w } : A.ang; A.gw = Math.max(A.gw || 0, w);
        if (rh.prop && w > .3) A.propG = { ...rh.prop, w };
      });
      if (r.head) { headRot += (r.head.rot || 0) * w; headDy += (r.head.dy || 0) * w; headNod += (r.head.nod || 0) * w; shakeX += (r.head.shakeX || 0) * w }
      if (r.face && w > .02) { faceG = r.face; faceGw = w }
      if (r.look) { lookG = r.look; lookw = w } if (r.lookv) { lookvG = r.lookv; lookw = Math.max(lookw, w * .9) }
      if (r.mid && w > .2) mids.push({ ...r.mid, w, G });
      if (r.trail) arms.trail = { ...r.trail, w };
    });
  });
  // ---- solve arms
  const J = { R: {}, L: {} };
  ['R', 'L'].forEach(H => {
    const A = arms[H], sh = shoulders[H]; const r = ik2(sh[0], sh[1], A.tx, A.ty, aL, bL, A.pole[0], A.pole[1]);
    const el = [r[0], r[1]], hd = [r[2], r[3]]; let ang = Math.atan2(hd[1] - el[1], hd[0] - el[0]);
    if (A.ang) ang = angLerp(ang, A.ang.v, A.ang.w);
    J[H] = { sh, el, hd, ang, pose: A.pose, prop: A.propG || A.propHeld || null };
  });
  // ---- legs
  const legs = {};
  const hipY = hip[1], hipsx = side ? { R: hip[0], L: hip[0] - .5 } : { R: hip[0] + 9, L: hip[0] - 9 };
  ['R', 'L'].forEach(H => {
    const fe = feet[H], axl = side ? hip[0] + fe.x : hip[0] + stand[H] + (side ? 0 : 0), ay = -RIG.ANKLE - fe.lift - 0;
    let ax = side ? hip[0] + fe.x - (hipX0 - hip[0]) : axl;
    if (sitK) { // seated: thigh forward, shin down
      const sx = lerp(ax, hip[0] + (side ? 40 : sgn(H) * 11) + (H === 'L' ? 3 : 0), sitK), sy = lerp(ay, -RIG.ANKLE, sitK); ax = sx;
      const r = ik2(hipsx[H], hipY, ax, sy, RIG.L, RIG.L, side ? 1 : sgn(H) * .3, side ? -.6 : -1);
      legs[H] = { hip: [hipsx[H], hipY], knee: [r[0], r[1]], ank: [r[2], r[3]], ang: 0 }; return;
    }
    const r = ik2(hipsx[H], hipY, ax, ay, RIG.L, RIG.L, side ? 1 : sgn(H) * .4, side ? -.15 : 0);
    let kn = [r[0], r[1]]; if (!side) { const mx = (hipsx[H] + r[2]) / 2, my = (hipY + r[3]) / 2; kn = [mx + (kn[0] - mx) * .3, my + (kn[1] - my) * .3] }
    legs[H] = { hip: [hipsx[H], hipY], knee: kn, ank: [r[2], r[3]], ang: fe.ang };
  });
  // ---- head
  const headBase = rot(side ? 3 : 0, -RIG.HEADY - br * .5 - shrug * 2.6, lean), headBob = (side ? 1 : 0) * Math.abs(Math.sin(Math.PI * g.u)) * -cfg.bob * .4 * f;
  const head = { x: hip[0] + headBase[0] + shakeX + (headNod ? Math.sin(headNod) * 0 : 0), y: hip[1] + headBase[1] + headDy + headBob + headNod * 8, rot: headRot - lean * .6 + headNod * (side ? 1 : 0) };
  // ---- look direction
  const lookPt = lookG || (o.look && o.look.length ? o.look : null); let lookv = [0, 0];
  if (lookvG) lookv = lookvG.slice(); 
  if (lookPt) { const lb = toBody(lookPt), dx = lb[0] - head.x, dy = lb[1] - head.y, kk = 1 / 70; lookv = [cl(dx * kk, -1, 1) * (side ? 1 : 1), cl(dy * kk, -1, 1)]; if (!side) lookv[0] = cl(dx * kk * 1.2, -1, 1) }
  // ---- face timeline: gestures nudge the expression, then it settles back to the base face
  const baseFace = o.face || 'smile', faces = (o.faces || []).slice();
  if (o.gestureFace !== false) (o.gestures || []).forEach(G => { const fn = GESTURES[G.name]; if (!G.face && !FACE_OF[G.name]) return; const nm = G.face || FACE_OF[G.name]; faces.push({ at: G.at, name: nm, dur: .25 }, { at: G.at + G.dur, name: baseFace, dur: .35 }) });
  const fp = resolveFace({ face: baseFace, faces, talk: o.talk, seed, blink: o.blink, lookv }, t);
  return { view, side, S, X, Y, dirNow: dirSafe, dirRaw: dirNow, hop, f, g, cfg, hip, shoulders, J, legs, head, lean, br, ws, shrug, mids, fp, lod, o, t, toScene, toBody, trail: arms.trail || null, lagK: lagOf(g, f, t, seed, side), sitK, hs };
}
// which expression each gesture pushes toward (read from gestures.js results too, kept here for the timeline)
const FACE_OF = { wave: 'smile', wave_goodbye: 'smile', point_at: 'focused', point_up: 'surprise', present: 'smile', shrug: 'worried', thumbs_up: 'big_smile', ok: 'smile', stop: 'focused', clap: 'big_smile', think_chin: 'focused', scratch_head: 'worried', facepalm: 'tired', hold_phone: 'focused', type_on_laptop: 'focused', write_with_pen: 'focused', hold_paper: 'focused', hand_over: 'smile', cross_arms: 'focused', hands_on_hips: 'proud', fist_pump: 'big_smile', beckon: 'smile', rub_hands: 'smile', spread_hands: 'big_smile', measure: 'focused', draw_in_air: 'focused', pinch_zoom: 'focused', high_five: 'big_smile', push: 'focused', pull: 'focused', lift: 'focused', shake_head: 'worried', tilt_head: 'smile' };
function lagOf(g, f, t, seed, side) { return -(.05 * f + .035 * f * Math.sin(2 * Math.PI * g.u * 2 + 1)) + .012 * Math.sin(t * 1.3 + seed) + (side ? 0 : 0) }

/** joints in scene coordinates (see header) */
export function solvePerson(o, t) {
  const Q = solveLocal(o, t), P2 = p => Q.toScene(p), r = {};
  const out = { x: Q.X, y: Q.Y, ground: [Q.X, Q.Y], dir: Q.dirNow, S: Q.S, view: Q.view, f: Q.f, D: Q.g.D };
  out.head = { ...(() => { const p = P2([Q.head.x, Q.head.y]); return { x: p[0], y: p[1] } })(), r: 21.5 * Q.S * (o.headS || 1), rot: Q.head.rot };
  out.pelvis = P2(Q.hip); out.neck = P2([(Q.shoulders.R[0] + Q.shoulders.L[0]) / 2, (Q.shoulders.R[1] + Q.shoulders.L[1]) / 2 - 8]);
  out.shoulders = {}; out.elbows = {}; out.hands = {}; out.palms = {}; out.hips = {}; out.knees = {}; out.feet = {};
  ['R', 'L'].forEach(H => {
    const A = Q.J[H], L = Q.legs[H]; out.shoulders[H] = P2(A.sh); out.elbows[H] = P2(A.el); out.hands[H] = P2(A.hd);
    out.palms[H] = P2([A.hd[0] + Math.cos(A.ang) * 6.5 * Q.hs, A.hd[1] + Math.sin(A.ang) * 6.5 * Q.hs]);
    out.hips[H] = P2(L.hip); out.knees[H] = P2(L.knee); out.feet[H] = P2(L.ank);
  });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- drawing
function silSpec(o) {
  const c = o.sil || '#7C3A33';
  return { skin: c, hair: { style: (o.hair && o.hair.style) || 'short', col: c, cap: c, tie: c }, top: { kind: 'plain', col: c, accent: c, len: o.top ? o.top.len : .5, sleeve: 'long' }, pants: c, shoe: c, acc: {}, wrap: { col: c, accent: c }, headS: o.headS, s: o.s };
}
function drawArm(g, A, spec, far, lod) {
  const top = spec.top || {}, skin = far ? shade(spec.skin, -.1) : spec.skin, slv = top.col || TOMATO, col = far ? shade(slv, -.22) : slv, short = top.sleeve === 'short';
  g.lineCap = 'round'; g.lineJoin = 'round';
  const [sx, sy] = A.sh, [ex, ey] = A.el, [hx, hy] = A.hd;
  if (short) {
    const k = .62, mx = lerp(sx, ex, k), my = lerp(sy, ey, k);
    g.strokeStyle = skin; g.lineWidth = 10.5; g.beginPath(); g.moveTo(mx, my); g.lineTo(ex, ey); g.lineTo(hx, hy); g.stroke();
    g.strokeStyle = col; g.lineWidth = 12.5; g.beginPath(); g.moveTo(sx, sy); g.lineTo(mx, my); g.stroke();
  } else {
    g.strokeStyle = col; g.lineWidth = 12; g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex, ey); g.lineTo(hx, hy); g.stroke();
    if (lod < 2) { g.strokeStyle = shade(col, -.12); g.lineWidth = 12.6; g.beginPath(); const px = hx - (hx - ex) * .22, py = hy - (hy - ey) * .22; g.moveTo(px, py); g.lineTo(hx, hy); g.stroke() }   // cuff
  }
}
function drawHandAt(g, A, spec, Q, far, H) {
  const skin = far ? shade(spec.skin, -.1) : spec.skin;
  if (Q.lod >= 1) { g.fillStyle = skin; g.beginPath(); g.arc(A.hd[0], A.hd[1], 6.2, 0, 7); g.fill(); return }
  drawHand(g, A.pose, { x: A.hd[0], y: A.hd[1], ang: A.ang, s: Q.hs, skin, flip: !Q.side && H === 'L' });
}
function propAt(g, A, Q, t, H, spec, sdir) {
  const pr = A.prop; if (!pr || Q.lod >= 1) return; const d = PROPS[pr.kind]; if (!d) return;
  const k = eo(cl((pr.w - .15) / .6)); if (k <= 0) return;
  const px = A.hd[0] + Math.cos(A.ang) * 6.5 * Q.hs, py = A.hd[1] + Math.sin(A.ang) * 6.5 * Q.hs;
  drawProp(g, pr.kind, { x: px, y: py, ang: A.ang, dir: 1 }, { ...pr, s: k, sdir, ph: Q.o.seed || 0, tilt: pr.tilt || 0 }, t);
}
function drawMid(g, m, Q, t, spec) {
  const R = Q.J.R.hd, L = Q.J.L.hd, cx = (R[0] + L[0]) / 2, cy = (R[1] + L[1]) / 2, k = eo(cl(m.w * 1.6)), side = Q.side; if (k <= 0) return;
  g.save(); g.translate(cx, cy + (m.dy || 0) * 0); g.scale(k, k);
  if (m.kind === 'laptop') {
    const open = m.open ?? 1, col = '#8E8A84';
    if (side) {
      g.fillStyle = shade(col, -.2); g.beginPath(); g.moveTo(-26, 3); g.lineTo(30, 3); g.lineTo(30, -1); g.lineTo(-26, -1); g.closePath(); g.fill();
      g.fillStyle = col; g.save(); g.translate(28, -1); g.rotate(-1.75 + (1 - open) * 1.6); rrect(g, -2, -33, 4.4, 33, 1.6); g.fill(); g.fillStyle = TOMATO; g.beginPath(); g.arc(-.2, -16, 2.4, 0, 7); g.fill(); g.restore();
    } else {
      g.fillStyle = shade(col, -.2); rrect(g, -34, 2, 68, 6, 2.5); g.fill(); g.fillStyle = col; rrect(g, -29, 2 - 31 * open, 58, 31 * open, 4); g.fill();
      g.fillStyle = shade(col, .15); rrect(g, -26, 5 - 31 * open, 52, 3, 1.5); g.fill(); g.fillStyle = TOMATO; g.beginPath(); g.arc(0, 2 - 15 * open, 4.2, 0, 7); g.fill(); g.fillStyle = CREAM; g.beginPath(); g.arc(0, 2 - 15 * open, 1.6, 0, 7); g.fill();
    }
  } else if (m.kind === 'paper') {
    g.rotate(.02 * Math.sin(t * 1.2)); g.fillStyle = SHADOW; rrect(g, -15 + 2, -34 + 2, 30, 38, 2); g.fill(); g.fillStyle = CREAM; rrect(g, -15, -34, 30, 38, 2); g.fill();
    if (side) { g.strokeStyle = 'rgba(34,30,26,.4)'; g.lineWidth = 1.6; g.lineCap = 'round'; for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(-10, -28 + i * 5.4); g.lineTo(i % 3 === 2 ? 0 : 9, -28 + i * 5.4); g.stroke() } g.fillStyle = TOMATO; g.fillRect(-10, -30.6, 7, 2.2) }
    else { g.strokeStyle = 'rgba(34,30,26,.13)'; g.lineWidth = 1.6; for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(-9, -26 + i * 6); g.lineTo(8, -26 + i * 6); g.stroke() } }
  } else if (m.kind === 'box') {
    const c = m.col || '#C99A62'; g.fillStyle = c; rrect(g, -25, -36, 50, 40, 3); g.fill(); g.fillStyle = shade(c, -.14); g.fillRect(-25, -36, 50, 9); g.fillStyle = shade(c, .22); g.fillRect(-4.5, -36, 9, 40);
    if (!side) { g.fillStyle = INK; g.globalAlpha = .55; g.fillRect(8, -16, 11, 6); g.globalAlpha = 1 }
  }
  g.restore();
}
function drawLegs(g, Q, spec) {
  const shoe = spec.shoe, pants = spec.pants, side = Q.side;
  const leg = (H, far) => {
    const L = Q.legs[H], col = far ? shade(pants, -.22) : pants;
    g.strokeStyle = col; g.lineWidth = 15; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(L.hip[0], L.hip[1]); g.lineTo(L.knee[0], L.knee[1]); g.lineTo(L.ank[0], L.ank[1]); g.stroke();
    g.fillStyle = far ? shade(shoe, -.1) : shoe; g.save(); g.translate(L.ank[0], L.ank[1]); g.rotate(L.ang);
    if (side) { g.beginPath(); g.roundRect(-6, -3, 26, 11, 5); g.fill() } else { g.beginPath(); g.roundRect(-8, -3, 16, 11, 5); g.fill() } g.restore();
  };
  if (side) { leg('L', true); leg('R', false) } else { leg('L', false); leg('R', false) }
}
/** draw a person at time t (see solvePerson for the spec) */
export function drawPerson(g, t, o0) {
  const o = o0.lod === 2 ? { ...o0, ...silSpec(o0), face: null } : o0, Q = solveLocal(o, t), spec = o;
  const side = Q.side, lod = Q.lod;
  const specN = { skin: o.skin || '#C58C5F', hair: o.hair || {}, top: o.top || {}, pants: o.pants || '#4A3A33', shoe: o.shoe || INK, acc: o.acc || {}, wrap: o.wrap || {}, headS: o.headS, skinC: o.skin };
  const cSpec = { ...specN, skin: specN.skin };
  g.save(); g.translate(Q.X, Q.Y); g.scale(Q.S * Q.dirNow, Q.S);
  if (lod < 2 && !o.noShadow && !(o.half && !side)) { g.fillStyle = 'rgba(70,35,25,.22)'; g.beginPath(); g.ellipse(0, 1, side ? 40 : 34, 7, 0, 0, 7); g.fill() }
  g.translate(0, -Q.hop);
  const half = o.half && !side;
  if (!half) { /* legs drawn first */ }
  // far arm before the torso in side view
  if (side) { if (!half) drawLegs(g, Q, specN); drawArm(g, Q.J.L, specN, true, lod); drawHandAt(g, Q.J.L, specN, Q, true, 'L') }
  else if (!half) drawLegs(g, Q, specN);
  // torso (+ back accessories, cloth lag)
  g.save(); g.translate(Q.hip[0], Q.hip[1]); g.rotate(Q.lean);
  if (lod < 1) drawBodyBack(g, Q.view, specN);
  g.save(); g.transform(1, 0, Q.lagK, 1, -Q.lagK * 30, 0); drawTorso(g, Q.view, { ...specN, top: lod >= 2 ? specN.top : specN.top }, Q.t, Q.br); g.restore();
  if (lod < 1) drawBodyFront(g, Q.view, specN, Q.t);
  g.restore();
  if (side) { const A = Q.J.L; if (A.prop) propAt(g, A, Q, t, 'L', specN, Q.dirNow < 0 ? -1 : 1) }
  // head
  g.save(); g.translate(Q.head.x, Q.head.y); g.rotate(Q.head.rot); const hsc = (o.headS || 1); g.scale(hsc, hsc);
  if (lod < 2 || true) drawHairBack(g, Q.view, specN, Q.t, o.seed || 0);
  g.fillStyle = specN.skin; g.beginPath(); g.arc(side ? 0 : 0, 0, 21.5, 0, 7); g.fill();
  if (lod < 1) { drawFace(g, Q.view, Q.fp, { skin: specN.skin }) }
  else if (lod === 1) { g.fillStyle = INK; if (side) { g.beginPath(); g.arc(8, -1, 2.4, 0, 7); g.fill(); g.beginPath(); g.arc(17, -1, 2.4, 0, 7); g.fill() } else { g.beginPath(); g.arc(-8, -1, 2.4, 0, 7); g.fill(); g.beginPath(); g.arc(8, -1, 2.4, 0, 7); g.fill() } }
  drawHairFront(g, Q.view, specN, Q.t); if (lod < 1) drawHeadAcc(g, Q.view, specN);
  g.restore();
  // mid objects (laptop / paper / box) sit between the hands and under them
  if (lod < 2) Q.mids.forEach(m => drawMid(g, m, Q, t, specN));
  // near / both arms
  const sdir = Q.dirNow < 0 ? -1 : 1;
  if (side) { drawArm(g, Q.J.R, specN, false, lod); propAt(g, Q.J.R, Q, t, 'R', specN, sdir); drawHandAt(g, Q.J.R, specN, Q, false, 'R'); }
  else {
    ['L', 'R'].forEach(H => { drawArm(g, Q.J[H], specN, false, lod); }); ['L', 'R'].forEach(H => { drawHandAt(g, Q.J[H], specN, Q, false, H); propAt(g, Q.J[H], Q, t, H, specN, 1) });
  }
  // gesture trail (draw_in_air) lives in scene space, so draw it after leaving local transform
  g.restore();
  if (Q.trail && Q.trail.pts && lod < 2) {
    const tr = Q.trail; g.save(); g.globalAlpha = cl(tr.fade ?? 1) * .95; g.strokeStyle = o.trailCol || TOMATO; g.lineWidth = 5; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); tr.pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke(); g.restore();
  }
}
/** sound-effect hit moments for a person spec: footsteps ('thud') and gesture events */
export function personMarkers(o, tMax = 15) { return [...footstepTimes(o, tMax), ...gestureMarkers(o)].sort((a, b) => a.t - b.t) }

// ---------------------------------------------------------------------------------------------------------------- asset
function resolveSpec(p) { const base = typeof p.spec === 'string' ? character(p.spec) : (p.spec || character('ama')); const { spec, ...rest } = p; return { ...base, ...rest } }
const PDEF = { x: 640, y: 650, view: 'side', dir: 1 };
function drawPersonAsset(g, t, params) { drawPerson(g, t, resolveSpec({ ...PDEF, ...(params || {}) })) }
const metaPerson = defMeta({
  id: 'people/person', kind: 'character', mode: 'story', title: 'Person (full rig)', duration: 8,
  description: 'Any character preset (ama, kofi, child, elder_woman, elder_man, office_woman, office_man, developer, shopkeeper, doctor, student, rider) in side or front view, with walking/running, a gesture timeline (wave, point_at, present, count_fingers, clap, type_on_laptop...), held props and facial expressions. The main way to put a person on screen.',
  params: { spec: P('string', 'ama', 'preset name or a full character spec object'), x: P('number', 640, 'ground x'), y: P('number', 650, 'ground y'), s: P('number', null, 'scale (default = preset)'), view: P('string', 'side', "'side' | 'front'"), dir: P('number', 1, 'facing'), half: P('bool', false, 'front view: crop legs (presenter)'), walk: P('object', null, '{speed,from,to,mode:walk|run,travel}'), gestures: P('array', [], '[{name,at,dur,hand,target,n,gap,path}] see people/gestures.js'), props: P('array', [], '[{kind,hand,at,to,col}] held props'), face: P('string', 'smile', 'base expression'), faces: P('array', [], '[{at,name,dur}]'), talk: P('object', null, '{from,to} talking mouth'), look: P('array', null, '[x,y] scene point the eyes follow'), turns: P('array', [], '[{at,dur,to}] turn-around') },
  anchors: { walk_from: ANC(null, 'params.walk.from'), walk_to: ANC(null, 'params.walk.to'), gestures: ANC(null, 'each gesture.at') }, markers: ['thud', 'pop', 'tick', 'whoosh', 'slide', 'rustle'],
  tags: ['person', 'character', 'walk', 'gesture', 'presenter', 'people'], bounds: [440, 380, 400, 290], origin: [640, 650],
  example: "assets['people/person'].draw(g,t,{spec:'doctor',view:'front',s:2.4,y:900,half:true,gestures:[{name:'wave',at:1,dur:2.4}]})"
});
const GKINDS = ['pop', 'tick', 'whoosh', 'thud', 'slide', 'rustle'];
const GDEF = { gesture: 'wave', who: 'ama', x: 640, y: 650, s: null, view: 'front', half: false, hand: 'R', target: null, n: 3, gap: null, at: { start: .6 }, dur: 2.6 };
function gestureSpec(params) {
  const p = withDefaults(params, GDEF), base = character(p.who);
  return { ...base, x: p.x, y: p.y, view: p.view, half: p.half, ...(p.s ? { s: p.s } : {}), gestures: [{ name: p.gesture, at: p.at.start, dur: p.dur, hand: p.hand, n: p.n, ...(p.target ? { target: p.target } : {}), ...(p.gap ? { gap: p.gap } : {}) }] };
}
const metaGesture = defMeta({
  id: 'people/gesture', kind: 'character', mode: 'story', title: 'Character doing one gesture', duration: 5,
  description: 'One character preset performing one named gesture, then holding a relaxed idle. gesture = wave wave_goodbye point_at point_up present shrug count_fingers thumbs_up ok stop clap think_chin scratch_head facepalm hold_phone type_on_laptop write_with_pen hold_paper hand_over carry_box cross_arms hands_on_hips fist_pump beckon rub_hands spread_hands measure draw_in_air pinch_zoom high_five push pull lift nod shake_head look_at tilt_head. Use for reaction shots, explainers and anything where one person makes one clear gesture; combine several gestures with people/person instead.',
  params: { gesture: P('string', 'wave', 'gesture name'), who: P('string', 'ama', 'character preset'), x: P('number', 640, 'ground x'), y: P('number', 650, 'ground y (for half:true use about 900 with s about 2.4)'), s: P('number', null, 'scale (default = preset)'), view: P('string', 'front', "'front' | 'side'"), half: P('bool', false, 'crop at the hips (presenter look; draw a desk in front to seat them)'), hand: P('string', 'R', "'R' | 'L' (screen right / left in front view)"), target: P('array', null, '[x,y] scene point for point_at / present / hand_over / look_at'), n: P('number', 3, 'finger count 1-5 (count_fingers)'), gap: P('number', null, 'px between hands (measure, pinch_zoom)'), dur: P('number', 2.6, 'gesture length in seconds') },
  anchors: { start: ANC(.6, 'seconds when the gesture begins') }, markers: GKINDS, tags: ['gesture', 'person', 'character', 'reaction', 'presenter', 'hands'],
  bounds: [440, 380, 400, 290], origin: [640, 650], example: "assets['people/gesture'].draw(g,t,{gesture:'point_at',who:'doctor',target:[1000,300],at:{start:1}})"
});
const WDEF = { who: 'kofi', x: 200, y: 650, s: null, dir: 1, speed: 150, mode: 'walk', view: 'side', at: { start: .3, stop: null } };
function walkSpec(params) {
  const p = withDefaults(params, WDEF), base = character(p.who);
  return { ...base, x: p.x, y: p.y, dir: p.dir, view: p.view, ...(p.s ? { s: p.s } : {}), walk: { speed: p.speed, mode: p.mode, from: p.at.start, to: p.at.stop } };
}
const metaWalk = defMeta({
  id: 'people/walk', kind: 'character', mode: 'story', title: 'Character walking or running', duration: 8,
  description: 'A character preset walking (or running with mode:"run") along the ground in direction dir, starting at anchor at.start and, if at.stop is set, easing to a standstill exactly there. Feet are planted: the gait is driven by ground distance, so they never slide. Use for entrances, exits, crossing a street, a walk-and-talk.',
  params: { who: P('string', 'kofi', 'character preset'), x: P('number', 200, 'start ground x'), y: P('number', 650, 'ground y'), s: P('number', null, 'scale (default = preset)'), dir: P('number', 1, '+1 walks right, -1 left'), speed: P('number', 150, 'px/s (run about 330)'), mode: P('string', 'walk', "'walk' | 'run'"), view: P('string', 'side', "'side' | 'front'") },
  anchors: { start: ANC(.3, 'seconds when walking begins (null = already walking at t=0)'), stop: ANC(null, 'seconds when it comes to rest (null = never stops)') }, markers: ['thud'], tags: ['walk', 'run', 'person', 'character', 'locomotion', 'entrance', 'exit'],
  bounds: [440, 380, 400, 290], origin: [200, 650], example: "assets['people/walk'].draw(g,t,{who:'ama',x:-100,dir:1,speed:160,at:{start:0,stop:4}})"
});
export const assets = {
  'people/person': { meta: metaPerson, draw: drawPersonAsset, markers: p => personMarkers(resolveSpec({ ...PDEF, ...(p || {}) })) },
  'people/gesture': { meta: metaGesture, draw: (g, t, p) => drawPerson(g, t, gestureSpec(p)), markers: p => gestureMarkers(gestureSpec(p)) },
  'people/walk': { meta: metaWalk, draw: (g, t, p) => drawPerson(g, t, walkSpec(p)), markers: p => footstepTimes(walkSpec(p), 15) },
};
