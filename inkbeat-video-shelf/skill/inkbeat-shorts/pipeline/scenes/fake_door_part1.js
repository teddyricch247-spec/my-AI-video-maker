// fake_door_part1: Piece 1 (0.05s - 27.91s) of "The Fake Door Test"
// Everything is a pure function of t (no Math.random/Date/performance.now).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { toon } from '../lib/toon.js';
import { makeRig, applyPose, calm } from '../lib/rig.js';
import { makeSam, makeAda, inkMesh } from '../../objects/character.js';

const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const sstep = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const backOut = (x) => { x = clamp(x, 0, 1); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const rb = (w, h, l, r) => new RoundedBoxGeometry(w, h, l, 4, r);
const ball = (r = 1, a = 18, b = 12) => new THREE.SphereGeometry(r, a, b);

export const words = [];

// ------------------------------------------------------------------ canvas texture helpers (pre-built once in build)
function makeTex(w, h, drawFn) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  drawFn(ctx, w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeUnlit(w, h, tex, { transparent = false } = {}) {
  return new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent })
  );
}

function makeSignTex(bg, fg, title, sub = '', border = '#2a1442') {
  return makeTex(512, 256, (c, w, h) => {
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    c.strokeStyle = border; c.lineWidth = 18; c.strokeRect(9, 9, w - 18, h - 18);
    c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '900 84px Poppins, sans-serif';
    c.fillText(title, w / 2, sub ? h * 0.36 : h * 0.52);
    if (sub) {
      c.font = '800 50px Poppins, sans-serif';
      c.fillText(sub, w / 2, h * 0.72);
    }
  });
}

// ------------------------------------------------------------------ Studio Desk & Monitor
function makeDesk() {
  const g = new THREE.Group();
  // Desk top: 1.9m x 0.80m, top surface at y = 0.75
  const top = inkMesh(rb(1.90, 0.06, 0.80, 0.02), 0xd8a872, 0.9);
  top.position.set(0, 0.72, 0);
  g.add(top);

  // Metal A-frame / leg posts
  for (const sx of [-0.84, 0.84]) {
    for (const sz of [-0.32, 0.32]) {
      const leg = inkMesh(rb(0.055, 0.69, 0.055, 0.015), 0x35324a, 0.7);
      leg.position.set(sx, 0.345, sz);
      g.add(leg);
    }
    const bar = inkMesh(rb(0.045, 0.045, 0.66, 0.01), 0x35324a, 0.5);
    bar.position.set(sx, 0.16, 0);
    g.add(bar);
  }
  const backModesty = inkMesh(rb(1.62, 0.22, 0.03, 0.01), 0xc5915a, 0.6);
  backModesty.position.set(0, 0.56, -0.32);
  g.add(backModesty);
  return g;
}

function makeSwivelChair() {
  const g = new THREE.Group();
  const seatCol = 0x3b4978;
  const seat = inkMesh(rb(0.48, 0.08, 0.46, 0.03), seatCol, 0.85);
  seat.position.set(0, 0.43, 0);
  g.add(seat);
  const back = inkMesh(rb(0.44, 0.42, 0.07, 0.03), seatCol, 0.85);
  back.position.set(0, 0.68, -0.21);
  back.rotation.x = -0.12;
  g.add(back);
  const stem = inkMesh(new THREE.CylinderGeometry(0.035, 0.04, 0.32, 10), 0x2b2838, 0.6);
  stem.position.set(0, 0.24, 0);
  g.add(stem);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    const arm = inkMesh(rb(0.04, 0.035, 0.26, 0.01), 0x2b2838, 0.5);
    arm.position.set(Math.sin(a) * 0.13, 0.06, Math.cos(a) * 0.13);
    arm.rotation.y = a;
    g.add(arm);
    const wheel = inkMesh(ball(0.035, 10, 8), 0x1e1b29, 0.5);
    wheel.position.set(Math.sin(a) * 0.24, 0.035, Math.cos(a) * 0.24);
    g.add(wheel);
  }
  return g;
}

function makeHeroMonitor() {
  const g = new THREE.Group();
  // Stand base & neck
  const base = inkMesh(rb(0.38, 0.025, 0.24, 0.01), 0x35324a, 0.7);
  base.position.set(0, 0.0125, 0);
  g.add(base);
  const neck = inkMesh(rb(0.07, 0.20, 0.05, 0.015), 0x35324a, 0.7);
  neck.position.set(0, 0.11, -0.05);
  g.add(neck);

  // Monitor frame: 0.96m wide x 0.60m tall, center at y = 0.44
  const frame = inkMesh(rb(0.98, 0.62, 0.05, 0.02), 0x2a2438, 0.95);
  frame.position.set(0, 0.44, 0);
  g.add(frame);

  // Screen surface (unlit) at z = +0.027
  const screenStoreTex = makeTex(768, 480, (c, w, h) => {
    // Crisp browser window
    c.fillStyle = '#f8f5ef'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#2a1442'; c.fillRect(0, 0, w, 68);
    // Browser dots
    ['#ff5f56', '#ffbd2e', '#27c93f'].forEach((col, i) => {
      c.fillStyle = col; c.beginPath(); c.arc(32 + i * 28, 34, 9, 0, TAU); c.fill();
    });
    c.fillStyle = '#ffd23f'; c.font = '900 32px Poppins, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('MYAPPS.CO  •  3 NEW APPS', w / 2 + 25, 36);

    // 3 wireframe "unbuilt" app cards
    const cardW = 216, gap = 24, x0 = (w - (cardW * 3 + gap * 2)) / 2;
    const cols = ['#e6eef8', '#f5ecff', '#fff0e6'];
    const titles = ['APP #1', 'APP #2', 'APP #3'];
    for (let i = 0; i < 3; i++) {
      const cx = x0 + i * (cardW + gap), cy = 96;
      c.fillStyle = cols[i]; c.fillRect(cx, cy, cardW, 348);
      c.strokeStyle = '#2a1442'; c.lineWidth = 6; c.strokeRect(cx, cy, cardW, 348);
      // Dashed wireframe box inside (unbuilt!)
      c.save(); c.setLineDash([12, 10]); c.strokeStyle = '#8b83a8'; c.lineWidth = 4;
      c.strokeRect(cx + 20, cy + 72, cardW - 40, 140); c.restore();
      c.fillStyle = '#8b83a8'; c.font = '900 62px Poppins, sans-serif';
      c.fillText('?', cx + cardW / 2, cy + 144);
      c.fillStyle = '#2a1442'; c.font = '900 28px Poppins, sans-serif';
      c.fillText(titles[i], cx + cardW / 2, cy + 40);
    }
  });

  const screenNotReadyTex = makeTex(768, 480, (c, w, h) => {
    c.fillStyle = '#fff3d6'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#e63946'; c.fillRect(0, 0, w, 72);
    c.fillStyle = '#ffffff'; c.font = '900 34px Poppins, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('MYAPPS.CO  •  404', w / 2, 37);

    // Warning badge box
    c.fillStyle = '#ffd23f'; c.fillRect(74, 118, w - 148, 290);
    c.strokeStyle = '#2a1442'; c.lineWidth = 10; c.strokeRect(74, 118, w - 148, 290);

    // Bold "NOT READY YET."
    c.fillStyle = '#2a1442'; c.font = '900 68px Poppins, sans-serif';
    c.fillText('NOT READY', w / 2, 224);
    c.fillStyle = '#e63946'; c.font = '900 68px Poppins, sans-serif';
    c.fillText('YET.', w / 2, 304);
    c.fillStyle = '#4a3d66'; c.font = '800 26px Poppins, sans-serif';
    c.fillText('CLICK RECORDED  ✓', w / 2, 368);
  });

  const screenStore = makeUnlit(0.90, 0.55, screenStoreTex);
  screenStore.position.set(0, 0.44, 0.027);
  g.add(screenStore);

  const screenNotReady = makeUnlit(0.90, 0.55, screenNotReadyTex);
  screenNotReady.position.set(0, 0.44, 0.028);
  screenNotReady.visible = false;
  g.add(screenNotReady);

  // 3 protruding 3D BUY buttons (sit at z = +0.036 so they pop physically off the screen!)
  const buyBtns = [];
  const btnColors = ['#2bb673', '#3a86ff', '#ff6b35'];
  for (let i = 0; i < 3; i++) {
    const bg = new THREE.Group();
    const bx = (i - 1) * 0.282, by = 0.265;
    bg.position.set(bx, by, 0.034);
    const slab = inkMesh(rb(0.22, 0.092, 0.018, 0.01), parseInt(btnColors[i].slice(1), 16), 0.55, { shadow: false });
    bg.add(slab);
    const bTex = makeTex(256, 112, (c, w, h) => {
      c.fillStyle = btnColors[i]; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#2a1442'; c.lineWidth = 12; c.strokeRect(6, 6, w - 12, h - 12);
      c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = '900 48px Poppins, sans-serif';
      c.fillText('BUY', w / 2, h / 2 + 2);
    });
    const plate = makeUnlit(0.205, 0.082, bTex);
    plate.position.z = 0.011;
    bg.add(plate);
    g.add(bg);
    buyBtns.push(bg);
  }

  // Animated 3D pointer cursor arrow
  const cursor = new THREE.Group();
  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(0, 0);
  arrowShape.lineTo(0.06, -0.045);
  arrowShape.lineTo(0.03, -0.052);
  arrowShape.lineTo(0.048, -0.095);
  arrowShape.lineTo(0.03, -0.103);
  arrowShape.lineTo(0.012, -0.058);
  arrowShape.lineTo(-0.01, -0.08);
  arrowShape.closePath();
  const cBack = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape), new THREE.MeshBasicMaterial({ color: 0x2a1442 }));
  cBack.scale.setScalar(1.22);
  cBack.position.set(-0.005, 0.006, -0.002);
  cursor.add(cBack);
  const cFront = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  cursor.add(cFront);
  cursor.position.set(0, 0.32, 0.052);
  cursor.visible = false;
  g.add(cursor);

  function update(t) {
    // 3 buy buttons pop sequentially on "3" (0.54s), "buy" (0.79s), "buttons" (1.10s)
    const popTimes = [0.48, 0.78, 1.08];
    const showNotReady = (t >= 11.75 && t < 15.65);
    screenStore.visible = !showNotReady;
    screenNotReady.visible = showNotReady;

    for (let i = 0; i < 3; i++) {
      if (showNotReady) {
        buyBtns[i].visible = false;
        continue;
      }
      const k = backOut((t - popTimes[i]) / 0.34);
      buyBtns[i].visible = t >= popTimes[i] && k > 0.02;
      // Press animation right before "leads to a page" (11.2..11.75)
      const press = i === 1 && t >= 11.2 && t < 11.75 ? 1 - 0.18 * Math.sin(Math.PI * clamp((t - 11.35) / 0.32, 0, 1)) : 1;
      buyBtns[i].scale.setScalar(Math.max(0.001, k * press));
      buyBtns[i].position.z = i === 1 && press < 0.99 ? 0.026 : 0.034;
    }

    // Cursor visible 9.6..13.8
    if (t >= 9.6 && t < 13.8 && !showNotReady) {
      cursor.visible = true;
      const moveK = sstep((t - 9.8) / 1.3);
      cursor.position.set(lerp(-0.26, 0.02, moveK), lerp(0.45, 0.27, moveK), 0.054);
    } else {
      cursor.visible = false;
    }
  }

  return { group: g, update };
}

// ------------------------------------------------------------------ Co-founder's Coding Laptop (on right side of desk)
function makeLaptop() {
  const g = new THREE.Group();
  const base = inkMesh(rb(0.36, 0.018, 0.25, 0.008), 0xcfd4e0, 0.7);
  base.position.set(0, 0.009, 0);
  g.add(base);
  const kb = new THREE.Mesh(new THREE.PlaneGeometry(0.30, 0.14), new THREE.MeshBasicMaterial({ color: 0x35324a }));
  kb.rotation.x = -Math.PI / 2;
  kb.position.set(0, 0.02, -0.02);
  g.add(kb);

  const lid = new THREE.Group();
  lid.position.set(0, 0.018, -0.12);
  lid.rotation.x = -0.35;
  g.add(lid);
  const lidBody = inkMesh(rb(0.36, 0.24, 0.014, 0.006), 0xcfd4e0, 0.7);
  lidBody.position.set(0, 0.12, 0);
  lid.add(lidBody);

  const codeTex = makeTex(384, 256, (c, w, h) => {
    c.fillStyle = '#1d1b2e'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#2d2846'; c.fillRect(0, 0, w, 38);
    c.fillStyle = '#ffd23f'; c.font = '900 22px Poppins, sans-serif';
    c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText('<CODE />', 18, 20);
    const cols = ['#56d8ff', '#ff7b72', '#a5f28d', '#ffd23f', '#d2a8ff'];
    for (let r = 0; r < 6; r++) {
      c.fillStyle = cols[r % cols.length];
      const indent = (r % 3) * 24 + 24;
      const bw = 90 + ((r * 57) % 160);
      c.fillRect(indent, 62 + r * 28, bw, 14);
    }
  });
  const scr = makeUnlit(0.33, 0.21, codeTex);
  scr.position.set(0, 0.12, 0.009);
  lid.add(scr);
  return g;
}

// ------------------------------------------------------------------ 40 Days Flip Calendar + Coin Savings Jar
function makeCountdownCalendar() {
  const g = new THREE.Group();
  const stand = inkMesh(rb(0.34, 0.28, 0.12, 0.02), 0x2a2438, 0.8);
  stand.position.set(0, 0.14, 0);
  g.add(stand);

  const calTex = makeTex(384, 320, (c, w, h) => {
    c.fillStyle = '#fff9ee'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#e63946'; c.fillRect(0, 0, w, 86);
    c.fillStyle = '#ffffff'; c.font = '900 38px Poppins, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('SAVINGS', w / 2, 44);
    c.fillStyle = '#2a1442'; c.font = '900 124px Poppins, sans-serif';
    c.fillText('40', w / 2, 184);
    c.fillStyle = '#e63946'; c.font = '900 36px Poppins, sans-serif';
    c.fillText('DAYS LEFT', w / 2, 274);
  });
  const plate = makeUnlit(0.30, 0.24, calTex);
  plate.position.set(0, 0.145, 0.062);
  g.add(plate);

  // Spiral rings at top
  for (let i = -1; i <= 1; i++) {
    const ring = inkMesh(new THREE.TorusGeometry(0.022, 0.006, 8, 14), 0xd9d6e6, 0.4, { shadow: false });
    ring.rotation.y = Math.PI / 2;
    ring.position.set(i * 0.09, 0.285, 0.03);
    g.add(ring);
  }
  return g;
}

function makeSavingsJar() {
  const g = new THREE.Group();
  const jar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.085, 0.085, 0.20, 18),
    new THREE.MeshToonMaterial({ color: 0xdff5ff, transparent: true, opacity: 0.48 })
  );
  jar.position.y = 0.10;
  g.add(jar);
  const rim = inkMesh(new THREE.CylinderGeometry(0.075, 0.075, 0.035, 16), 0xc89b62, 0.6);
  rim.position.y = 0.21;
  g.add(rim);
  // Just 3 coins left at the bottom!
  for (let i = 0; i < 3; i++) {
    const coin = inkMesh(new THREE.CylinderGeometry(0.028, 0.028, 0.01, 12), 0xffd23f, 0.4, { shadow: false });
    coin.position.set((i - 1) * 0.022, 0.014 + i * 0.008, (i % 2) * 0.015);
    coin.rotation.z = (i - 1) * 0.14;
    g.add(coin);
  }
  const tagTex = makeSignTex('#fff3d6', '#e63946', '$$$', 'LOW!', '#2a1442');
  const tag = makeUnlit(0.13, 0.065, tagTex);
  tag.position.set(0, 0.10, 0.088);
  g.add(tag);
  return g;
}

// ------------------------------------------------------------------ 3 Idea Cards Corkboard
function makeIdeaBoard() {
  const g = new THREE.Group();
  const frame = inkMesh(rb(1.16, 0.72, 0.05, 0.015), 0x9b6b43, 0.85);
  g.add(frame);
  const cork = new THREE.Mesh(new THREE.PlaneGeometry(1.06, 0.62), toon(0xd4a36a));
  cork.position.z = 0.027;
  g.add(cork);

  const cards = [];
  const cardCols = ['#ffe66d', '#9ef0ff', '#ffb5a7'];
  const labels = ['IDEA 1', 'IDEA 2', 'IDEA 3'];
  for (let i = 0; i < 3; i++) {
    const cg = new THREE.Group();
    cg.position.set((i - 1) * 0.33, 0, 0.036);
    const cardTex = makeTex(220, 280, (c, w, h) => {
      c.fillStyle = cardCols[i]; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#2a1442'; c.lineWidth = 10; c.strokeRect(5, 5, w - 10, h - 10);
      // Lightbulb icon
      c.fillStyle = '#ffffff'; c.beginPath(); c.arc(w / 2, 100, 44, 0, TAU); c.fill();
      c.strokeStyle = '#2a1442'; c.lineWidth = 7; c.stroke();
      c.fillStyle = '#ff9f1c'; c.beginPath(); c.arc(w / 2, 100, 26, 0, TAU); c.fill();
      c.fillStyle = '#35324a'; c.fillRect(w / 2 - 18, 140, 36, 20);
      c.fillStyle = '#2a1442'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = '900 38px Poppins, sans-serif';
      c.fillText(labels[i], w / 2, 224);
    });
    const card = makeUnlit(0.28, 0.36, cardTex);
    cg.add(card);
    // Red pushpin
    const pin = inkMesh(ball(0.022, 10, 8), 0xe63946, 0.4, { shadow: false });
    pin.position.set(0, 0.15, 0.015);
    cg.add(pin);
    cg.rotation.z = (i - 1) * -0.05;
    g.add(cg);
    cards.push(cg);
  }

  function update(t) {
    const popAt = [4.05, 4.45, 4.82];
    for (let i = 0; i < 3; i++) {
      const k = t < 3.6 ? 1 : backOut((t - popAt[i]) / 0.35);
      const pulse = t >= 4.2 && t <= 5.6 ? 1 + 0.08 * Math.sin(TAU * 1.5 * (t - popAt[i])) * Math.max(0, 1 - (t - popAt[i]) / 1.2) : 1;
      cards[i].scale.setScalar(Math.max(0.001, (t >= 3.6 && t < popAt[i] ? 0.001 : k) * pulse));
    }
  }
  return { group: g, update };
}

// ------------------------------------------------------------------ Empty Store Shelving Unit ("a store with empty shelves?")
function makeEmptyStore() {
  const g = new THREE.Group();
  const wood = 0xc98f54;
  // Side uprights (width 1.30m, depth 0.44m, height 1.95m)
  for (const sx of [-0.62, 0.62]) {
    const post = inkMesh(rb(0.06, 1.95, 0.44, 0.015), wood, 0.9);
    post.position.set(sx, 0.975, 0);
    g.add(post);
  }
  // Back panel
  const back = inkMesh(rb(1.26, 1.88, 0.03, 0.01), 0xeadbc8, 0.7);
  back.position.set(0, 0.96, -0.20);
  g.add(back);

  // 3 bare empty shelves + small price-tag stickers ("$0 / EMPTY")
  const shelfYs = [0.42, 0.95, 1.48];
  const emptyTagTex = makeSignTex('#fff3d6', '#e63946', 'EMPTY', '$0', '#2a1442');
  shelfYs.forEach((sy, idx) => {
    const plank = inkMesh(rb(1.22, 0.045, 0.42, 0.01), wood, 0.8);
    plank.position.set(0, sy, 0);
    g.add(plank);
    const tag = makeUnlit(0.22, 0.11, emptyTagTex);
    tag.position.set((idx - 1) * 0.34, sy - 0.002, 0.215);
    g.add(tag);
  });

  // Top marquee sign: "STORE"
  const topBoard = inkMesh(rb(1.36, 0.32, 0.08, 0.02), 0xe63946, 0.95);
  topBoard.position.set(0, 2.08, 0.04);
  g.add(topBoard);
  const storeTex = makeSignTex('#ffd23f', '#2a1442', 'STORE', 'OPEN  •  $0', '#2a1442');
  const signPlate = makeUnlit(1.26, 0.26, storeTex);
  signPlate.position.set(0, 2.08, 0.085);
  g.add(signPlate);

  // Tiny dust puff sitting alone on the middle shelf
  const dust = inkMesh(ball(0.055, 10, 8), 0xc7c2d4, 0.4, { shadow: false });
  dust.scale.set(1.3, 0.8, 1.0);
  dust.position.set(0.28, 1.01, 0.04);
  g.add(dust);
  return g;
}

// ------------------------------------------------------------------ Taped Tally Paper Sheet ("one column per button... no code until 100 clicks")
function makeTallySheet() {
  const g = new THREE.Group();

  // Backing paper (0.86m x 1.08m)
  const baseTex = makeTex(640, 800, (c, w, h) => {
    c.fillStyle = '#fffdf7'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#2a1442'; c.lineWidth = 10; c.strokeRect(5, 5, w - 10, h - 10);
    // Faint notebook horizontal lines
    c.strokeStyle = '#e4e9f5'; c.lineWidth = 3;
    for (let y = 180; y < 640; y += 44) {
      c.beginPath(); c.moveTo(30, y); c.lineTo(w - 30, y); c.stroke();
    }
    c.fillStyle = '#2a1442'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '900 44px Poppins, sans-serif';
    c.fillText('BUTTON CLICKS', w / 2, 56);
  });
  const paper = makeUnlit(0.86, 1.08, baseTex);
  g.add(paper);

  // 4 Masking tape strips on corners
  const tapeCol = 0xf2d179;
  for (const [tx, ty, rz] of [[-0.39, 0.50, 0.55], [0.39, 0.50, -0.55], [-0.39, -0.50, -0.55], [0.39, -0.50, 0.55]]) {
    const tape = inkMesh(rb(0.18, 0.055, 0.012, 0.004), tapeCol, 0.35, { shadow: false });
    tape.position.set(tx, ty, 0.008);
    tape.rotation.z = rz;
    g.add(tape);
  }

  // 3 Columns layer (revealed sequentially around 21.83..23.1s)
  const cols = [];
  const colColors = ['#2bb673', '#3a86ff', '#ff6b35'];
  for (let i = 0; i < 3; i++) {
    const cTex = makeTex(200, 440, (c, w, h) => {
      c.fillStyle = 'rgba(255,253,247,0.92)'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#2a1442'; c.lineWidth = 6; c.strokeRect(4, 4, w - 8, h - 8);
      c.fillStyle = colColors[i]; c.fillRect(8, 8, w - 16, 76);
      c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = '900 38px Poppins, sans-serif';
      c.fillText(`BTN ${i + 1}`, w / 2, 46);
      c.fillStyle = '#9aa0b8'; c.font = '800 30px Poppins, sans-serif';
      c.fillText('0 / 100', w / 2, 396);
    });
    const cm = makeUnlit(0.25, 0.56, cTex);
    cm.position.set((i - 1) * 0.265, 0.06, 0.006);
    cm.visible = false;
    g.add(cm);
    cols.push(cm);
  }

  // Bold Rule Banner at bottom of sheet ("NO CODE UNTIL 100 CLICKS")
  const ruleTex = makeTex(600, 176, (c, w, h) => {
    c.fillStyle = '#ffd23f'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#2a1442'; c.lineWidth = 12; c.strokeRect(6, 6, w - 12, h - 12);
    c.fillStyle = '#e63946'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '900 44px Poppins, sans-serif';
    c.fillText('RULE: NO CODE', w / 2, 54);
    c.fillStyle = '#2a1442'; c.font = '900 48px Poppins, sans-serif';
    c.fillText('UNTIL 100 CLICKS!', w / 2, 118);
  });
  const rulePlate = makeUnlit(0.80, 0.23, ruleTex);
  rulePlate.position.set(0, -0.36, 0.010);
  rulePlate.visible = false;
  g.add(rulePlate);

  function update(t) {
    if (t < 19.95) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const pop = backOut((t - 19.95) / 0.42);
    g.scale.setScalar(Math.max(0.001, pop));

    const colAt = [21.82, 22.22, 22.62];
    for (let i = 0; i < 3; i++) {
      cols[i].visible = t >= colAt[i];
      if (cols[i].visible) {
        cols[i].scale.setScalar(Math.max(0.001, backOut((t - colAt[i]) / 0.30)));
      }
    }

    rulePlate.visible = t >= 24.65;
    if (rulePlate.visible) {
      const rp = backOut((t - 24.65) / 0.36);
      const pulse = t >= 26.8 ? 1 + 0.04 * Math.sin(TAU * 1.4 * (t - 26.8)) : 1;
      rulePlate.scale.setScalar(Math.max(0.001, rp * pulse));
    }
  }

  return { group: g, update };
}

// ------------------------------------------------------------------ Decorative Studio Props (>= 12 props in view)
function makePottedPlant() {
  const g = new THREE.Group();
  const pot = inkMesh(new THREE.CylinderGeometry(0.18, 0.13, 0.28, 14), 0xd96b43, 0.8);
  pot.position.y = 0.14;
  g.add(pot);
  const soil = new THREE.Mesh(new THREE.CircleGeometry(0.16, 14), toon(0x4a3328));
  soil.rotation.x = -Math.PI / 2; soil.position.y = 0.282;
  g.add(soil);
  const leafCols = [0x3d9a4a, 0x52b85b, 0x2f803c];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.2;
    const leaf = inkMesh(ball(1, 12, 8), leafCols[i % 3], 0.7);
    leaf.scale.set(0.09, 0.22, 0.03);
    leaf.position.set(Math.cos(a) * 0.11, 0.44 + (i % 2) * 0.08, Math.sin(a) * 0.11);
    leaf.rotation.set(0.35, -a, 0.4);
    g.add(leaf);
  }
  return g;
}

function makeDeskLamp() {
  const g = new THREE.Group();
  const base = inkMesh(new THREE.CylinderGeometry(0.08, 0.09, 0.025, 14), 0x35324a, 0.6);
  base.position.y = 0.0125;
  g.add(base);
  const arm1 = inkMesh(rb(0.025, 0.24, 0.025, 0.008), 0xffd23f, 0.6);
  arm1.position.set(0, 0.13, -0.02); arm1.rotation.x = -0.25;
  g.add(arm1);
  const arm2 = inkMesh(rb(0.025, 0.22, 0.025, 0.008), 0xffd23f, 0.6);
  arm2.position.set(0, 0.30, 0.03); arm2.rotation.x = 0.55;
  g.add(arm2);
  const shade = inkMesh(new THREE.ConeGeometry(0.09, 0.13, 14), 0x3a86ff, 0.7);
  shade.position.set(0, 0.34, 0.12); shade.rotation.x = 0.45;
  g.add(shade);
  const bulb = new THREE.Mesh(ball(0.038, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff5b8 }));
  bulb.position.set(0, 0.30, 0.14);
  g.add(bulb);
  return g;
}

function makeBookcase() {
  const g = new THREE.Group();
  const frame = inkMesh(rb(1.05, 1.75, 0.36, 0.02), 0x9b6b43, 0.85);
  frame.position.y = 0.875;
  g.add(frame);
  const inner = new THREE.Mesh(rb(0.95, 1.62, 0.33, 0.01), toon(0x6e4a2d));
  inner.position.set(0, 0.875, 0.03);
  g.add(inner);
  const cols = [0xe63946, 0x3a86ff, 0xffd23f, 0x2bb673, 0x9b5de5];
  for (const sy of [0.35, 0.85, 1.35]) {
    const shelf = inkMesh(rb(0.98, 0.035, 0.34, 0.01), 0x9b6b43, 0.6);
    shelf.position.set(0, sy, 0.02);
    g.add(shelf);
    for (let b = 0; b < 6; b++) {
      const h = 0.22 + (b % 3) * 0.04;
      const bk = inkMesh(rb(0.065, h, 0.22, 0.008), cols[(b + Math.round(sy * 3)) % cols.length], 0.5);
      bk.position.set(-0.36 + b * 0.085, sy + 0.02 + h / 2, 0.04);
      g.add(bk);
    }
  }
  return g;
}

// ------------------------------------------------------------------ Build Scene
export function build(ctx) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x90d4f7);

  // Studio interior lighting: bright, crisp, warm-cool balance (mean L* ~54)
  scene.add(new THREE.HemisphereLight(0xfff6ea, 0x7b6352, 1.05));

  const key = new THREE.DirectionalLight(0xfff0d4, 2.15);
  key.position.set(3.8, 6.2, 4.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 22 });
  key.shadow.bias = -0.0012;
  key.shadow.normalBias = 0.04;
  scene.add(key);

  const rim = new THREE.DirectionalLight(0xbbe0ff, 0.75);
  rim.position.set(-4.0, 4.5, -2.0);
  scene.add(rim);

  // Warm practical desk lamp light
  const lampPt = new THREE.PointLight(0xffd27a, 1.1, 4.5, 2);
  lampPt.position.set(-0.35, 1.22, -2.95);
  scene.add(lampPt);

  // ------------------------------------------------------------------ Room Shell (never shows sky inside!)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(11, 10), toon(0xc99c6d));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  scene.add(floor);
  // Subtle wood plank seams (0.003m proud, zero z-fighting)
  for (let i = -5; i <= 5; i++) {
    const seam = new THREE.Mesh(new THREE.PlaneGeometry(11, 0.018), toon(0xb08354));
    seam.rotation.x = -Math.PI / 2; seam.position.set(0, 0.003, i * 0.75);
    seam.receiveShadow = true;
    scene.add(seam);
  }
  // Cozy woven rug
  const rug = inkMesh(rb(3.5, 0.015, 2.5, 0.005), 0x456990, 0.6, { shadow: false });
  rug.position.set(0.25, 0.008, -2.1);
  scene.add(rug);
  const rugInner = new THREE.Mesh(new THREE.PlaneGeometry(3.15, 2.15), toon(0x5c80a8));
  rugInner.rotation.x = -Math.PI / 2; rugInner.position.set(0.25, 0.017, -2.1);
  rugInner.receiveShadow = true;
  scene.add(rugInner);

  // 4 walls + ceiling (room: x in [-4.5, 4.5], z in [-3.65, 5.2], y in [0, 3.6])
  const wallMat = toon(0xf6efe4);
  const wainscotMat = toon(0x7c9e87);
  const addWall = (w, h, x, y, z, ry) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat);
    m.position.set(x, y, z); m.rotation.y = ry; m.receiveShadow = true;
    scene.add(m);
    const base = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.92), wainscotMat);
    base.position.set(x + Math.sin(ry) * 0.006, 0.46, z + Math.cos(ry) * 0.006);
    base.rotation.y = ry; base.receiveShadow = true;
    scene.add(base);
    const trim = new THREE.Mesh(rb(w, 0.06, 0.03, 0.01), toon(0xffffff));
    trim.position.set(x + Math.sin(ry) * 0.015, 0.93, z + Math.cos(ry) * 0.015);
    trim.rotation.y = ry;
    scene.add(trim);
  };
  addWall(9.2, 3.7, 0, 1.85, -3.65, 0);          // back wall
  addWall(9.0, 3.7, -4.5, 1.85, 0.75, Math.PI / 2); // left wall
  addWall(9.0, 3.7, 4.5, 1.85, 0.75, -Math.PI / 2); // right wall
  addWall(9.2, 3.7, 0, 1.85, 5.2, Math.PI);       // front wall

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(9.2, 9.0), toon(0xefe6d8));
  ceiling.rotation.x = Math.PI / 2; ceiling.position.set(0, 3.65, 0.75);
  scene.add(ceiling);
  for (const bx of [-2.4, 0, 2.4]) {
    const beam = inkMesh(rb(0.18, 0.16, 8.9, 0.02), 0x8f6239, 0.6, { shadow: false });
    beam.position.set(bx, 3.57, 0.75);
    scene.add(beam);
  }

  // Sunny window on back-right wall (x = 2.85, y = 1.95, z = -3.63)
  const winG = new THREE.Group();
  winG.position.set(2.85, 1.95, -3.63);
  const skyPane = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 1.18), new THREE.MeshBasicMaterial({ color: 0x8ad4ff }));
  winG.add(skyPane);
  const hillPane = new THREE.Mesh(new THREE.CircleGeometry(0.65, 18, 0, Math.PI), new THREE.MeshBasicMaterial({ color: 0x64bf62 }));
  hillPane.position.set(0.1, -0.58, 0.002);
  winG.add(hillPane);
  for (const [fx, fy, fw, fh] of [[0, 0.61, 1.30, 0.07], [0, -0.61, 1.30, 0.07], [-0.61, 0, 0.07, 1.28], [0.61, 0, 0.07, 1.28], [0, 0, 0.04, 1.18], [0, 0, 1.18, 0.04]]) {
    const bar = inkMesh(rb(fw, fh, 0.05, 0.01), 0xffffff, 0.6);
    bar.position.set(fx, fy, 0.02);
    winG.add(bar);
  }
  scene.add(winG);

  // Wall clock above empty store / left wall
  const clockG = new THREE.Group();
  clockG.position.set(-1.35, 2.35, -3.62);
  const clockRim = inkMesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 20), 0x2a2438, 0.8);
  clockRim.rotation.x = Math.PI / 2;
  clockG.add(clockRim);
  const clockFace = new THREE.Mesh(new THREE.CircleGeometry(0.19, 20), new THREE.MeshBasicMaterial({ color: 0xfffdf7 }));
  clockFace.position.z = 0.022;
  clockG.add(clockFace);
  const hand1 = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.12, 0.01), new THREE.MeshBasicMaterial({ color: 0x2a1442 }));
  hand1.position.set(0, 0.05, 0.026);
  clockG.add(hand1);
  const hand2 = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.018, 0.01), new THREE.MeshBasicMaterial({ color: 0xe63946 }));
  hand2.position.set(0.04, 0, 0.028);
  clockG.add(hand2);
  scene.add(clockG);

  // ------------------------------------------------------------------ Furniture & Hero Props
  // Hero Desk at (0.50, 0, -3.12)
  const desk = makeDesk();
  desk.position.set(0.50, 0, -3.12);
  scene.add(desk);

  // Swivel chair at (-0.42, 0, -2.42), angled toward monitor & room
  const chair = makeSwivelChair();
  chair.position.set(-0.42, 0, -2.42);
  chair.rotation.y = 1.45;
  scene.add(chair);

  // Hero Monitor on desk (shifted right to x = 0.56 so Tally Sheet on left has zero overlap)
  const monitor = makeHeroMonitor();
  monitor.group.position.set(0.56, 0.75, -3.18);
  monitor.group.rotation.y = -0.18;
  scene.add(monitor.group);

  // Keyboard + Mouse on desk
  const kb = inkMesh(rb(0.38, 0.02, 0.14, 0.006), 0xefeef5, 0.6);
  kb.position.set(0.50, 0.76, -2.88); kb.rotation.y = -0.18;
  scene.add(kb);
  const mouse = inkMesh(rb(0.065, 0.028, 0.10, 0.012), 0x35324a, 0.5);
  mouse.position.set(0.78, 0.764, -2.84); mouse.rotation.y = -0.18;
  scene.add(mouse);

  // Coffee mug on desk
  const mug = inkMesh(new THREE.CylinderGeometry(0.045, 0.04, 0.10, 14), 0xff6b35, 0.7);
  mug.position.set(-0.18, 0.80, -2.88);
  scene.add(mug);

  // Desk lamp on left corner of desk
  const lamp = makeDeskLamp();
  lamp.position.set(-0.34, 0.75, -3.30);
  lamp.rotation.y = 0.55;
  scene.add(lamp);

  // 40 Days Flip Calendar + Savings Jar on desk (clear of monitor and laptop!)
  const calendar = makeCountdownCalendar();
  calendar.position.set(1.04, 0.75, -3.12);
  calendar.rotation.y = -0.15;
  scene.add(calendar);

  const jar = makeSavingsJar();
  jar.position.set(1.28, 0.75, -3.00);
  jar.rotation.y = -0.18;
  scene.add(jar);

  // Co-founder's Coding Laptop on a dedicated side desk stand (x = 1.65, z = -2.55) so it never blocks the calendar
  const sideTable = inkMesh(rb(0.62, 0.72, 0.52, 0.02), 0xd8a872, 0.8);
  sideTable.position.set(1.66, 0.36, -2.58);
  scene.add(sideTable);
  const laptop = makeLaptop();
  laptop.position.set(1.64, 0.72, -2.58);
  laptop.rotation.y = -0.82;
  scene.add(laptop);

  // 3 Idea Cards Corkboard on back wall right of desk
  const ideaBoard = makeIdeaBoard();
  ideaBoard.group.position.set(1.68, 1.68, -3.60);
  scene.add(ideaBoard.group);

  // Empty Store Shelves on back-left
  const emptyStore = makeEmptyStore();
  emptyStore.position.set(-2.35, 0, -2.75);
  emptyStore.rotation.y = 0.50;
  scene.add(emptyStore);

  // Taped Tally Paper Sheet on back wall above-left of desk (zero overlap with monitor!)
  const tallySheet = makeTallySheet();
  tallySheet.group.position.set(-0.46, 1.84, -3.60);
  scene.add(tallySheet.group);

  // Potted plant, bookcase, cardboard box, trash bin for rich set dressing
  const plant = makePottedPlant();
  plant.position.set(-1.18, 0, -3.22);
  scene.add(plant);

  const bookcase = makeBookcase();
  bookcase.position.set(2.85, 0, -2.85);
  bookcase.rotation.y = -0.45;
  scene.add(bookcase);

  const box1 = inkMesh(rb(0.45, 0.36, 0.40, 0.02), 0xc79563, 0.75);
  box1.position.set(-3.15, 0.18, -1.75); box1.rotation.y = 0.28;
  scene.add(box1);
  const bin = inkMesh(new THREE.CylinderGeometry(0.15, 0.12, 0.34, 14), 0x455073, 0.7);
  bin.position.set(1.62, 0.17, -2.95);
  scene.add(bin);

  // ------------------------------------------------------------------ Characters: Sam (Founder) & Ada (Co-founder)
  const sam = makeSam();
  scene.add(sam.group);
  const ada = makeAda();
  scene.add(ada.group);

  // Mouth talk timings from transcript
  // Co-founder: "We have 40 days and you built a store with empty shelves?" (15.843 - 19.356)
  ada.talk(ada.talkFromWords([[15.84, 16.0], [16.07, 17.02], [17.06, 18.39], [18.41, 19.36]]));
  // Founder gestures/talks when explaining website/rule
  sam.talk(sam.talkFromWords([[9.67, 10.94], [25.30, 27.91]]));

  // ------------------------------------------------------------------ Camera Beats (9:16 moving rig ~55 bpm; 16:9 calm)
  const cam = new THREE.PerspectiveCamera(58, ctx.w / ctx.h, 0.15, 60);
  const beats = [
    // 0.05: "He put 3 buy buttons on a website..." (full monitor + all 3 BUY buttons cleanly framed!)
    { pos: [0.54, 1.24, -1.55], look: [0.56, 1.12, -3.18], fov: 54 },
    { at: 0.75, dur: 0.65, pos: [0.56, 1.22, -1.72], look: [0.56, 1.12, -3.18], fov: 50, roll: 0.02 },
    // 1.70: "...for apps he hadn't built." (reveal Sam's full face/profile + monitor!)
    { at: 1.75, dur: 0.80, pos: [0.34, 1.38, -0.58], look: [-0.08, 1.10, -2.75], fov: 58, roll: -0.02 },
    { at: 2.85, dur: 0.75, pos: [0.45, 1.34, -0.72], look: [-0.14, 1.12, -2.65], fov: 56, roll: 0.02 },
    // 3.60: "You see, he's got 3 ideas..." (swing to 3 Idea Cards corkboard, framed wide enough for all 3)
    { at: 3.70, dur: 0.80, pos: [1.55, 1.68, -1.45], look: [1.68, 1.64, -3.60], fov: 54, roll: -0.02 },
    { at: 4.75, dur: 0.75, pos: [1.65, 1.66, -1.62], look: [1.68, 1.62, -3.60], fov: 50, roll: 0.02 },
    // 5.57: "...and 40 days of savings left," (unobstructed 40 DAYS flip calendar & low coin jar)
    { at: 5.60, dur: 0.75, pos: [1.05, 1.16, -2.05], look: [1.14, 0.88, -3.06], fov: 44, roll: -0.02 },
    { at: 6.55, dur: 0.70, pos: [1.08, 1.12, -2.18], look: [1.14, 0.88, -3.06], fov: 40, roll: 0.02 },
    // 7.50: "and his co-founder wants to start coding." (Ada enters, points at laptop on side table)
    { at: 7.50, dur: 0.80, pos: [1.85, 1.48, -0.45], look: [1.15, 1.16, -2.25], fov: 56, roll: -0.02 },
    { at: 8.45, dur: 0.70, pos: [1.55, 1.42, -0.58], look: [1.22, 1.18, -2.15], fov: 54, roll: 0.02 },
    // 9.43: "So he shows her the website,"
    { at: 9.45, dur: 0.75, pos: [-0.05, 1.48, -0.55], look: [0.45, 1.18, -2.65], fov: 58, roll: -0.02 },
    { at: 10.35, dur: 0.70, pos: [0.68, 1.32, -1.55], look: [0.54, 1.14, -3.15], fov: 50, roll: 0.02 },
    // 11.31: "and every button leads to a page that says, 'Not ready yet.'" (clean margins around monitor!)
    { at: 11.35, dur: 0.65, pos: [0.54, 1.22, -1.68], look: [0.56, 1.14, -3.18], fov: 50, roll: -0.02 },
    { at: 12.60, dur: 0.70, pos: [0.56, 1.22, -1.78], look: [0.56, 1.14, -3.18], fov: 48, roll: 0.02 },
    { at: 13.75, dur: 0.65, pos: [0.52, 1.24, -1.74], look: [0.56, 1.14, -3.18], fov: 50, roll: -0.02 },
    // 14.72: "His co-founder asks- We have 40 days..."
    { at: 14.72, dur: 0.75, pos: [0.22, 1.46, -0.45], look: [0.98, 1.28, -1.95], fov: 54, roll: 0.02 },
    { at: 15.85, dur: 0.70, pos: [0.38, 1.46, -0.62], look: [0.95, 1.28, -1.95], fov: 50, roll: -0.02 },
    // 17.25: "...and you built a store with empty shelves?"
    { at: 17.20, dur: 0.85, pos: [-0.15, 1.52, -0.35], look: [-1.45, 1.18, -2.45], fov: 60, roll: 0.02 },
    { at: 18.30, dur: 0.75, pos: [-0.95, 1.45, -0.82], look: [-2.25, 1.18, -2.75], fov: 54, roll: -0.03 },
    // 19.45: "But he just tapes a sheet of paper above his desk,"
    { at: 19.45, dur: 0.80, pos: [-1.15, 1.58, -0.95], look: [-0.62, 1.48, -3.20], fov: 56, roll: 0.02 },
    { at: 20.55, dur: 0.75, pos: [-0.55, 1.72, -1.55], look: [-0.52, 1.66, -3.52], fov: 52, roll: -0.02 },
    // 21.83: "one column per button," (clean full view of taped sheet!)
    { at: 21.80, dur: 0.70, pos: [-0.46, 1.78, -1.78], look: [-0.46, 1.76, -3.60], fov: 48, roll: 0.02 },
    { at: 22.85, dur: 0.70, pos: [-0.46, 1.78, -1.85], look: [-0.46, 1.76, -3.60], fov: 48, roll: -0.02 },
    // 23.75: "and sets one strange rule:"
    { at: 23.75, dur: 0.75, pos: [-1.05, 1.62, -1.25], look: [-0.56, 1.54, -3.25], fov: 54, roll: 0.02 },
    // 25.00: "no code until a button hits 100 clicks." (rule banner raised above 70% caption zone!)
    { at: 25.05, dur: 0.75, pos: [-0.46, 1.50, -1.62], look: [-0.46, 1.38, -3.60], fov: 50, roll: -0.02 },
    { at: 26.50, dur: 0.75, pos: [-0.46, 1.46, -1.72], look: [-0.46, 1.34, -3.60], fov: 46, roll: 0.02 },
  ];

  const rig = ctx.landscape
    ? makeRig(calm(beats.filter((_, i) => i % 2 === 0)), { drift: 0, arc: 0, fps: ctx.fps })
    : makeRig(beats, { drift: 0.032, arc: 0.018, fps: ctx.fps });

  const vWalk = sam.speed('walk');

  return {
    scene,
    camera: cam,
    update(t) {
      monitor.update(t);
      ideaBoard.update(t);
      tallySheet.update(t);

      // --- Sam (Founder):
      // 0..19.35: seated on swivel chair at (-0.42, 0, -2.42), yaw = 1.45 (3/4 profile toward monitor & camera!)
      // 19.35..20.15: stands up and steps left-back to (-1.04, 0, -2.86) beside the tally sheet!
      const standK = sstep((t - 19.30) / 0.55);
      const samX = lerp(-0.42, -1.04, standK);
      const samZ = lerp(-2.42, -2.86, standK);
      const sitYaw = lerp(1.45, 0.95, sstep((t - 9.2) / 0.5));
      const wallYaw = lerp(sitYaw, 2.25, standK);
      sam.group.position.set(samX, 0, samZ);
      sam.group.rotation.y = wallYaw;

      // Sam's expression
      sam.expression((tt) => {
        if (tt >= 5.7 && tt < 7.5) return 'worried';
        if (tt >= 14.8 && tt < 19.3) return 'neutral';
        return 'happy';
      });

      // Sam's gaze
      if (t < 7.5) sam.lookAt([0.56, 1.18, -3.18]);
      else if (t < 11.3) sam.lookAt([1.12, 1.35, -1.85]);
      else if (t < 19.3) sam.lookAt([0.56, 1.18, -3.18]);
      else sam.lookAt([-0.46, 1.84, -3.55]);

      // Sam's reach to tape the sheet on the wall (19.95..21.6)
      if (t >= 19.90 && t < 21.70) {
        const rw = sstep((t - 19.90) / 0.28) * (1 - sstep((t - 21.35) / 0.35));
        sam.reach('R', [-0.72, 1.72, -3.50], rw);
      } else {
        sam.reach('R', null);
      }

      const sitW = 1 - standK;
      const walkStepW = Math.sin(Math.PI * clamp((t - 19.35) / 0.65, 0, 1));
      const samPointMonitor = sstep((t - 9.6) / 0.3) * (1 - sstep((t - 11.2) / 0.3));
      const samPointRule = sstep((t - 24.5) / 0.3) * (1 - sstep((t - 27.9) / 0.4));
      const samTalkW = (t >= 9.6 && t < 11.0 ? 0.6 : 0) + (t >= 25.2 && t < 28.0 ? 0.75 : 0);

      if (samPointMonitor > 0.05) {
        sam.act({
          sit: { w: sitW, seat: 0.43 },
          point: { w: samPointMonitor, target: [0.35, 1.12, -0.45] },
          talk: samTalkW,
        }, t);
      } else if (samPointRule > 0.05) {
        sam.act({
          point: { w: samPointRule, target: [-0.20, 1.48, 0.50] },
          talk: samTalkW,
        }, t);
      } else {
        sam.act({
          sit: { w: sitW, seat: 0.43 },
          walk: walkStepW * 0.8,
          talk: samTalkW,
        }, t);
      }

      // --- Ada (Co-founder):
      // 0..7.45: stands off to the right side studying/typing near x = 2.45, z = -1.75
      // 7.45..8.75: walks in to x = 1.12, z = -1.82 facing Sam & desk
      const adaWalkStart = 7.45, adaWalkEnd = 8.65;
      const adaWalkK = clamp((t - adaWalkStart) / (adaWalkEnd - adaWalkStart), 0, 1);
      const adaX0 = 1.12 + vWalk * (adaWalkEnd - adaWalkStart);
      const adaX = t < adaWalkStart ? adaX0 : lerp(adaX0, 1.12, adaWalkK);
      const adaWalking = t >= adaWalkStart && t < adaWalkEnd ? 1 : (t >= adaWalkEnd ? 1 - sstep((t - adaWalkEnd) / 0.2) : 0);
      ada.group.position.set(adaX, 0, -1.82);
      // Turn from -PI/2 (walking -x) toward desk/Sam (-0.65), then toward Empty Store (-1.35) at 17.2s, then back to Sam (-0.95)
      let adaYaw = lerp(-Math.PI / 2, -0.68, sstep((t - 8.4) / 0.45));
      if (t >= 17.1 && t < 19.6) {
        adaYaw = lerp(-0.68, -1.35, sstep((t - 17.1) / 0.4));
      } else if (t >= 19.6) {
        adaYaw = lerp(-1.35, -0.92, sstep((t - 19.6) / 0.45));
      }
      ada.group.rotation.y = adaYaw;

      ada.expression((tt) => {
        if (tt >= 13.7 && tt < 15.6) return 'shocked';
        if (tt >= 15.6 && tt < 19.5) return 'angry';
        if (tt >= 19.5) return 'worried';
        return 'happy';
      });

      if (t < 11.0) ada.lookAt([0.56, 1.18, -3.18]);
      else if (t < 14.7) ada.lookAt([0.56, 1.18, -3.18]);
      else if (t < 17.2) ada.lookAt([-0.42, 1.25, -2.42]);
      else if (t < 19.5) ada.lookAt([-2.35, 1.35, -2.75]);
      else ada.lookAt([-0.46, 1.84, -3.55]);

      const adaPointCode = sstep((t - 8.45) / 0.25) * (1 - sstep((t - 9.45) / 0.25));
      const adaReact = t >= 13.75 && t < 15.5 ? sstep((t - 13.75) / 0.2) * (1 - sstep((t - 15.2) / 0.3)) : 0;
      const adaTalk = t >= 15.6 && t < 19.35 ? 0.85 : 0;
      const adaPointStore = sstep((t - 17.25) / 0.25) * (1 - sstep((t - 19.35) / 0.3));

      ada.act({
        walk: adaWalking,
        point: adaPointCode > 0.05 ? { w: adaPointCode, target: [-0.15, 0.98, -0.45] } : (adaPointStore > 0.05 ? { w: adaPointStore, target: [-0.25, 1.25, 0.55] } : 0),
        react: adaReact > 0.05 ? { w: adaReact, t0: 13.75 } : 0,
        talk: adaTalk,
      }, t);

      applyPose(cam, rig(t));
    },
  };
}
