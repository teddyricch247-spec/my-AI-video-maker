// fake_door_part2: Piece 2 (28.34s - 55.46s shifted to 0.10s - 27.22s) of "The Fake Door Test"
// Act A (0..13.38s): Rival's Dark Dev Cave (Claude + Settings + "Real founders ship!" + Loading Spinner)
// Act B (13.38..27.92s): HARD CUT to Founder's Bright Studio (Week 1: 9 tallies & Ada shrugs -> Week 3: 212 clicks, 190 on BTN 2!)
// Everything is a pure function of t.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { toon } from '../lib/toon.js';
import { makeRig, applyPose, calm } from '../lib/rig.js';
import { makeCharacter, makeSam, makeAda, inkMesh } from '../../objects/character.js';

const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const sstep = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const backOut = (x) => { x = clamp(x, 0, 1); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const rb = (w, h, l, r) => new RoundedBoxGeometry(w, h, l, 4, r);
const ball = (r = 1, a = 18, b = 12) => new THREE.SphereGeometry(r, a, b);

export const words = [];

// ------------------------------------------------------------------ texture helpers
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

// ------------------------------------------------------------------ Shared Furniture Builders
function makeDesk(topCol = 0xd8a872, legCol = 0x35324a, neonCol = null) {
  const g = new THREE.Group();
  const top = inkMesh(rb(1.94, 0.06, 0.80, 0.02), topCol, 0.9);
  top.position.set(0, 0.72, 0);
  g.add(top);
  if (neonCol !== null) {
    const strip = new THREE.Mesh(rb(1.92, 0.018, 0.018, 0.005), new THREE.MeshBasicMaterial({ color: neonCol }));
    strip.position.set(0, 0.70, 0.402);
    g.add(strip);
  }
  for (const sx of [-0.85, 0.85]) {
    for (const sz of [-0.32, 0.32]) {
      const leg = inkMesh(rb(0.055, 0.69, 0.055, 0.015), legCol, 0.7);
      leg.position.set(sx, 0.345, sz);
      g.add(leg);
    }
  }
  return g;
}

function makeSwivelChair(seatCol = 0x3b4978) {
  const g = new THREE.Group();
  const seat = inkMesh(rb(0.48, 0.08, 0.46, 0.03), seatCol, 0.85);
  seat.position.set(0, 0.43, 0);
  g.add(seat);
  const back = inkMesh(rb(0.44, 0.46, 0.07, 0.03), seatCol, 0.85);
  back.position.set(0, 0.70, -0.21); back.rotation.x = -0.12;
  g.add(back);
  const stem = inkMesh(new THREE.CylinderGeometry(0.035, 0.04, 0.32, 10), 0x2b2838, 0.6);
  stem.position.set(0, 0.24, 0);
  g.add(stem);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    const arm = inkMesh(rb(0.04, 0.035, 0.26, 0.01), 0x2b2838, 0.5);
    arm.position.set(Math.sin(a) * 0.13, 0.06, Math.cos(a) * 0.13); arm.rotation.y = a;
    g.add(arm);
  }
  return g;
}

function makeRoomShell({ wallCol, wainscotCol, floorCol, seamCol, ceilCol, beamCol, rugCol, rugInCol, windowSky = null }) {
  const g = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(11, 10), toon(floorCol));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  g.add(floor);
  for (let i = -5; i <= 5; i++) {
    const seam = new THREE.Mesh(new THREE.PlaneGeometry(11, 0.018), toon(seamCol));
    seam.rotation.x = -Math.PI / 2; seam.position.set(0, 0.003, i * 0.75);
    seam.receiveShadow = true;
    g.add(seam);
  }
  const rug = inkMesh(rb(3.5, 0.015, 2.5, 0.005), rugCol, 0.6, { shadow: false });
  rug.position.set(0.25, 0.008, -2.1);
  g.add(rug);
  const rugIn = new THREE.Mesh(new THREE.PlaneGeometry(3.15, 2.15), toon(rugInCol));
  rugIn.rotation.x = -Math.PI / 2; rugIn.position.set(0.25, 0.017, -2.1); rugIn.receiveShadow = true;
  g.add(rugIn);

  const wallMat = toon(wallCol), wainMat = toon(wainscotCol);
  const addWall = (w, h, x, y, z, ry) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat);
    m.position.set(x, y, z); m.rotation.y = ry; m.receiveShadow = true; g.add(m);
    const base = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.92), wainMat);
    base.position.set(x + Math.sin(ry) * 0.006, 0.46, z + Math.cos(ry) * 0.006);
    base.rotation.y = ry; base.receiveShadow = true; g.add(base);
  };
  addWall(9.2, 3.7, 0, 1.85, -3.65, 0);
  addWall(9.0, 3.7, -4.5, 1.85, 0.75, Math.PI / 2);
  addWall(9.0, 3.7, 4.5, 1.85, 0.75, -Math.PI / 2);
  addWall(9.2, 3.7, 0, 1.85, 5.2, Math.PI);

  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(9.2, 9.0), toon(ceilCol));
  ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 3.65, 0.75); g.add(ceil);
  for (const bx of [-2.4, 0, 2.4]) {
    const beam = inkMesh(rb(0.18, 0.16, 8.9, 0.02), beamCol, 0.6, { shadow: false });
    beam.position.set(bx, 3.57, 0.75); g.add(beam);
  }
  if (windowSky !== null) {
    const winG = new THREE.Group();
    winG.position.set(2.85, 1.95, -3.63);
    winG.add(new THREE.Mesh(new THREE.PlaneGeometry(1.18, 1.18), new THREE.MeshBasicMaterial({ color: windowSky })));
    const hill = new THREE.Mesh(new THREE.CircleGeometry(0.65, 18, 0, Math.PI), new THREE.MeshBasicMaterial({ color: 0x64bf62 }));
    hill.position.set(0.1, -0.58, 0.002); winG.add(hill);
    for (const [fx, fy, fw, fh] of [[0, 0.61, 1.30, 0.07], [0, -0.61, 1.30, 0.07], [-0.61, 0, 0.07, 1.28], [0.61, 0, 0.07, 1.28], [0, 0, 0.04, 1.18], [0, 0, 1.18, 0.04]]) {
      const bar = inkMesh(rb(fw, fh, 0.05, 0.01), 0xffffff, 0.6);
      bar.position.set(fx, fy, 0.02); winG.add(bar);
    }
    g.add(winG);
  }
  return g;
}

// ------------------------------------------------------------------ ACT A: Rival's Dev Cave Props (0..13.38s)
function makeRivalMonitor() {
  const g = new THREE.Group();
  const base = inkMesh(rb(0.40, 0.025, 0.24, 0.01), 0x1e1b2e, 0.7);
  base.position.set(0, 0.0125, 0); g.add(base);
  const neck = inkMesh(rb(0.08, 0.20, 0.05, 0.015), 0x1e1b2e, 0.7);
  neck.position.set(0, 0.11, -0.05); g.add(neck);
  const frame = inkMesh(rb(1.06, 0.64, 0.055, 0.02), 0x1a1728, 0.95);
  frame.position.set(0, 0.45, 0); g.add(frame);

  // Screen 1: CLAUDE AI building code (0..6.85s)
  const claudeTex = makeTex(768, 480, (c, w, h) => {
    c.fillStyle = '#141221'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#d97757'; c.fillRect(0, 0, w, 78);
    c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '900 42px Poppins, sans-serif';
    c.fillText('CLAUDE  •  CODE', w / 2, 40);
    // Code blocks
    const cols = ['#7ee787', '#79c0ff', '#ffa657', '#d2a8ff', '#ff7b72', '#a5d6ff'];
    for (let r = 0; r < 7; r++) {
      c.fillStyle = cols[r % cols.length];
      const ind = 48 + (r % 3) * 34;
      const bw = 200 + ((r * 137) % 360);
      c.fillRect(ind, 112 + r * 40, bw, 20);
    }
    c.fillStyle = '#ffd23f'; c.fillRect(48, 404, 672, 48);
    c.fillStyle = '#2a1442'; c.font = '900 28px Poppins, sans-serif';
    c.fillText('BUILDING MY APP... 1000+ LINES', w / 2, 429);
  });
  const scrClaude = makeUnlit(0.98, 0.56, claudeTex);
  scrClaude.position.set(0, 0.45, 0.030);
  g.add(scrClaude);

  // Screen 2: SETTINGS PAGE FOR THE SETTINGS (6.85..11.30s)
  const settingsTex = makeTex(768, 480, (c, w, h) => {
    c.fillStyle = '#1a1b2e'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#7c5cff'; c.fillRect(0, 0, w, 78);
    c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '900 36px Poppins, sans-serif';
    c.fillText('SETTINGS  >  SETTINGS', w / 2, 40);

    const rows = ['SETTINGS THEME', 'SETTINGS FOR SETTINGS', 'EXTRA SETTINGS', 'SPIN SETTINGS'];
    for (let i = 0; i < 4; i++) {
      const y = 108 + i * 86;
      c.fillStyle = '#262844'; c.fillRect(44, y, w - 88, 68);
      c.strokeStyle = '#4e548a'; c.lineWidth = 4; c.strokeRect(44, y, w - 88, 68);
      c.fillStyle = '#f4f1ff'; c.textAlign = 'left'; c.font = '800 28px Poppins, sans-serif';
      c.fillText(rows[i], 70, y + 36);
      // Toggle pill
      c.fillStyle = i % 2 === 0 ? '#2bb673' : '#ffd23f';
      c.fillRect(w - 156, y + 16, 84, 36);
      c.fillStyle = '#1a1b2e';
      c.beginPath(); c.arc(i % 2 === 0 ? w - 92 : w - 136, y + 34, 13, 0, TAU); c.fill();
    }
  });
  const scrSettings = makeUnlit(0.98, 0.56, settingsTex);
  scrSettings.position.set(0, 0.45, 0.031);
  scrSettings.visible = false;
  g.add(scrSettings);

  // Screen 3: LOADING SPINNER (11.30..13.33s)
  const spinnerBgTex = makeTex(768, 480, (c, w, h) => {
    c.fillStyle = '#141221'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#26243d'; c.fillRect(0, 0, w, 72);
    c.fillStyle = '#ffd23f'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '900 32px Poppins, sans-serif';
    c.fillText('POLISHING SPINNER...', w / 2, 37);
    c.fillStyle = '#a3a8d6'; c.font = '800 30px Poppins, sans-serif';
    c.fillText('LOADING... 99%', w / 2, 420);
  });
  const scrSpinBg = makeUnlit(0.98, 0.56, spinnerBgTex);
  scrSpinBg.position.set(0, 0.45, 0.032);
  scrSpinBg.visible = false;
  g.add(scrSpinBg);

  // Actual rotating 3D spinner wheel proud of Screen 3
  const spinnerWheel = new THREE.Group();
  spinnerWheel.position.set(0, 0.46, 0.042);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const col = i === 0 ? 0xffd23f : (i < 3 ? 0x56d8ff : 0x4b4875);
    const dot = new THREE.Mesh(ball(0.022, 10, 8), new THREE.MeshBasicMaterial({ color: col }));
    dot.position.set(Math.cos(a) * 0.11, Math.sin(a) * 0.11, 0);
    dot.scale.setScalar(i === 0 ? 1.25 : 0.9);
    spinnerWheel.add(dot);
  }
  spinnerWheel.visible = false;
  g.add(spinnerWheel);

  function update(t) {
    scrClaude.visible = t < 6.85;
    scrSettings.visible = t >= 6.85 && t < 11.30;
    const showSpin = t >= 11.30;
    scrSpinBg.visible = showSpin;
    spinnerWheel.visible = showSpin;
    if (showSpin) {
      // Smooth 1.5 Hz rotation (safe below 2 Hz)
      spinnerWheel.rotation.z = -t * TAU * 1.5;
    }
  }
  return { group: g, update };
}

function makeRivalIdeaBoard() {
  const g = new THREE.Group();
  const frame = inkMesh(rb(1.16, 0.72, 0.05, 0.015), 0x35324a, 0.85);
  g.add(frame);
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(1.06, 0.62), toon(0x26243d));
  bg.position.z = 0.027; g.add(bg);

  const cards = [];
  const labels = ['IDEA 1', 'IDEA 2', 'IDEA 3'];
  for (let i = 0; i < 3; i++) {
    const cg = new THREE.Group();
    cg.position.set((i - 1) * 0.33, 0, 0.036);
    const isPicked = i === 1;
    const cardTex = makeTex(220, 280, (c, w, h) => {
      c.fillStyle = isPicked ? '#ffd23f' : '#3a385c'; c.fillRect(0, 0, w, h);
      c.strokeStyle = isPicked ? '#ffffff' : '#2a1442'; c.lineWidth = 10; c.strokeRect(5, 5, w - 10, h - 10);
      c.fillStyle = isPicked ? '#2a1442' : '#9aa0c8';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = '900 38px Poppins, sans-serif';
      c.fillText(labels[i], w / 2, 110);
      c.font = '900 30px Poppins, sans-serif';
      c.fillStyle = isPicked ? '#e63946' : '#6c729c';
      c.fillText(isPicked ? 'PICKED! ★' : 'SKIP', w / 2, 196);
    });
    cg.add(makeUnlit(0.28, 0.36, cardTex));
    g.add(cg);
    cards.push(cg);
  }
  function update(t) {
    const popK = t >= 1.25 ? backOut((t - 1.25) / 0.35) : 1;
    cards[1].scale.setScalar(t >= 1.25 ? 1.12 * popK : 1);
    cards[0].scale.setScalar(t >= 1.25 ? 0.88 : 1);
    cards[2].scale.setScalar(t >= 1.25 ? 0.88 : 1);
  }
  return { group: g, update };
}

function makeWeeksCalendar() {
  const g = new THREE.Group();
  const stand = inkMesh(rb(0.36, 0.30, 0.12, 0.02), 0x1e1b2e, 0.85);
  stand.position.set(0, 0.15, 0); g.add(stand);

  const pages = [1, 2, 3].map((wk) => {
    const tex = makeTex(384, 320, (c, w, h) => {
      c.fillStyle = '#fff9ee'; c.fillRect(0, 0, w, h);
      c.fillStyle = wk === 3 ? '#e63946' : '#7c5cff'; c.fillRect(0, 0, w, 86);
      c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = '900 38px Poppins, sans-serif';
      c.fillText('BUILDING', w / 2, 44);
      c.fillStyle = '#2a1442'; c.font = '900 120px Poppins, sans-serif';
      c.fillText(String(wk), w / 2, 184);
      c.fillStyle = '#2a1442'; c.font = '900 34px Poppins, sans-serif';
      c.fillText(wk === 1 ? 'WEEK' : 'WEEKS', w / 2, 274);
    });
    const m = makeUnlit(0.32, 0.26, tex);
    m.position.set(0, 0.155, 0.062 + wk * 0.001);
    g.add(m);
    return m;
  });

  function update(t) {
    const idx = t < 4.5 ? 0 : (t < 5.4 ? 1 : 2);
    pages.forEach((p, i) => { p.visible = i === idx; });
  }
  return { group: g, update };
}

// ------------------------------------------------------------------ ACT B: Founder's Bright Studio Props (13.38..27.92s)
function makeStudioCalendar() {
  const g = new THREE.Group();
  const stand = inkMesh(rb(0.36, 0.30, 0.12, 0.02), 0x2a2438, 0.85);
  stand.position.set(0, 0.15, 0); g.add(stand);

  const makeWkPage = (num, sub, headerCol) => {
    const tex = makeTex(384, 320, (c, w, h) => {
      c.fillStyle = '#fff9ee'; c.fillRect(0, 0, w, h);
      c.fillStyle = headerCol; c.fillRect(0, 0, w, 86);
      c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = '900 38px Poppins, sans-serif';
      c.fillText('PROGRESS', w / 2, 44);
      c.fillStyle = '#2a1442'; c.font = '900 110px Poppins, sans-serif';
      c.fillText(num, w / 2, 182);
      c.fillStyle = headerCol; c.font = '900 38px Poppins, sans-serif';
      c.fillText(sub, w / 2, 274);
    });
    const m = makeUnlit(0.32, 0.26, tex);
    m.position.set(0, 0.155, 0.063);
    g.add(m);
    return m;
  };
  const wk1 = makeWkPage('WK 1', 'DAY 7', '#3a86ff');
  const wk3 = makeWkPage('WK 3', 'DAY 21', '#2bb673');
  wk3.visible = false;

  function update(t) {
    const isWk3 = t >= 19.60;
    wk1.visible = !isWk3;
    wk3.visible = isWk3;
  }
  return { group: g, update };
}

function makeTallySheetPart2() {
  const g = new THREE.Group();

  // Base paper with 3 columns
  const baseTex = makeTex(640, 800, (c, w, h) => {
    c.fillStyle = '#fffdf7'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#2a1442'; c.lineWidth = 10; c.strokeRect(5, 5, w - 10, h - 10);
    c.fillStyle = '#2a1442'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '900 42px Poppins, sans-serif';
    c.fillText('BUTTON CLICKS', w / 2, 54);
  });
  g.add(makeUnlit(0.86, 1.08, baseTex));

  for (const [tx, ty, rz] of [[-0.39, 0.50, 0.55], [0.39, 0.50, -0.55], [-0.39, -0.50, -0.55], [0.39, -0.50, 0.55]]) {
    const tape = inkMesh(rb(0.18, 0.055, 0.012, 0.004), 0xf2d179, 0.35, { shadow: false });
    tape.position.set(tx, ty, 0.008); tape.rotation.z = rz; g.add(tape);
  }

  // Helper to draw tallies inside a column card
  function drawTallyGroup(c, x, y, count, col = '#2a1442') {
    c.strokeStyle = col; c.lineWidth = 6; c.lineCap = 'round';
    const n = Math.min(5, count);
    for (let i = 0; i < Math.min(4, n); i++) {
      c.beginPath(); c.moveTo(x + i * 11, y); c.lineTo(x + i * 11, y + 26); c.stroke();
    }
    if (n === 5) {
      c.beginPath(); c.moveTo(x - 4, y + 22); c.lineTo(x + 36, y + 4); c.stroke();
    }
  }

  // State 1 (Week 1): BTN 2 has 9 tally marks (1 group of 5 + 4 marks), count = 9/100
  const wk1Tex = makeTex(600, 620, (c, w, h) => {
    const cols = ['#2bb673', '#3a86ff', '#ff6b35'];
    const counts = ['0 / 100', '9 / 100', '0 / 100'];
    for (let i = 0; i < 3; i++) {
      const cx = 14 + i * 196;
      c.fillStyle = '#fffdf7'; c.fillRect(cx, 10, 180, 560);
      c.strokeStyle = '#2a1442'; c.lineWidth = 6; c.strokeRect(cx, 10, 180, 560);
      c.fillStyle = cols[i]; c.fillRect(cx + 4, 14, 172, 76);
      c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = '900 36px Poppins, sans-serif';
      c.fillText(`BTN ${i + 1}`, cx + 90, 52);
      if (i === 1) {
        drawTallyGroup(c, cx + 32, 136, 5, '#e63946');
        drawTallyGroup(c, cx + 102, 136, 4, '#e63946');
      }
      c.fillStyle = i === 1 ? '#e63946' : '#9aa0b8';
      c.font = '900 32px Poppins, sans-serif';
      c.fillText(counts[i], cx + 90, 520);
    }
  });
  const wk1Layer = makeUnlit(0.80, 0.82, wk1Tex);
  wk1Layer.position.set(0, -0.05, 0.008);
  g.add(wk1Layer);

  // State 2 (Week 3): 212 CLICKS! BTN 1=14, BTN 2=190 (packed tallies + GOAL HIT!), BTN 3=8
  const wk3Tex = makeTex(600, 620, (c, w, h) => {
    const cols = ['#2bb673', '#3a86ff', '#ff6b35'];
    const counts = ['14 / 100', '190 / 100', '8 / 100'];
    for (let i = 0; i < 3; i++) {
      const cx = 14 + i * 196;
      c.fillStyle = i === 1 ? '#fff7d6' : '#fffdf7';
      c.fillRect(cx, 10, 180, 560);
      c.strokeStyle = i === 1 ? '#e63946' : '#2a1442';
      c.lineWidth = i === 1 ? 10 : 6;
      c.strokeRect(cx, 10, 180, 560);
      c.fillStyle = cols[i]; c.fillRect(cx + 4, 14, 172, 76);
      c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = '900 36px Poppins, sans-serif';
      c.fillText(`BTN ${i + 1}`, cx + 90, 52);

      if (i === 0) {
        drawTallyGroup(c, cx + 28, 126, 5); drawTallyGroup(c, cx + 100, 126, 5);
        drawTallyGroup(c, cx + 28, 176, 4);
      } else if (i === 2) {
        drawTallyGroup(c, cx + 28, 126, 5); drawTallyGroup(c, cx + 100, 126, 3);
      } else {
        // Packed 190 tallies across 7 rows!
        for (let r = 0; r < 6; r++) {
          drawTallyGroup(c, cx + 24, 114 + r * 44, 5, '#e63946');
          drawTallyGroup(c, cx + 98, 114 + r * 44, 5, '#e63946');
        }
        // Green WINNER banner inside BTN 2
        c.fillStyle = '#2bb673'; c.fillRect(cx + 12, 396, 156, 72);
        c.strokeStyle = '#2a1442'; c.lineWidth = 5; c.strokeRect(cx + 12, 396, 156, 72);
        c.fillStyle = '#ffffff'; c.font = '900 28px Poppins, sans-serif';
        c.fillText('WINNER! ✓', cx + 90, 434);
      }
      c.fillStyle = i === 1 ? '#e63946' : '#4a4e69';
      c.font = '900 30px Poppins, sans-serif';
      c.fillText(counts[i], cx + 90, 520);
    }
  });
  const wk3Layer = makeUnlit(0.80, 0.82, wk3Tex);
  wk3Layer.position.set(0, -0.05, 0.010);
  wk3Layer.visible = false;
  g.add(wk3Layer);

  // Total badge at top for Week 3 ("212 CLICKS!")
  const totalTex = makeTex(512, 220, (c, w, h) => {
    c.fillStyle = '#ffd23f'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#2a1442'; c.lineWidth = 16; c.strokeRect(8, 8, w - 16, h - 16);
    c.fillStyle = '#e63946'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '900 72px Poppins, sans-serif';
    c.fillText('212 CLICKS!', w / 2, h * 0.37);
    c.fillStyle = '#2a1442'; c.font = '900 42px Poppins, sans-serif';
    c.fillText('190 ON BTN 2', w / 2, h * 0.74);
  });
  const totalBadge = makeUnlit(0.76, 0.26, totalTex);
  totalBadge.position.set(0, 0.44, 0.016);
  totalBadge.visible = false;
  g.add(totalBadge);

  function update(t) {
    const isWk3 = t >= 20.60;
    wk1Layer.visible = !isWk3;
    wk3Layer.visible = isWk3;
    totalBadge.visible = t >= 21.55;
    if (totalBadge.visible) {
      totalBadge.scale.setScalar(Math.max(0.001, backOut((t - 21.55) / 0.35)));
    }
  }
  return { group: g, update };
}

function makeStudioMonitor() {
  const g = new THREE.Group();
  const base = inkMesh(rb(0.38, 0.025, 0.24, 0.01), 0x35324a, 0.7);
  base.position.set(0, 0.0125, 0); g.add(base);
  const neck = inkMesh(rb(0.07, 0.20, 0.05, 0.015), 0x35324a, 0.7);
  neck.position.set(0, 0.11, -0.05); g.add(neck);
  const frame = inkMesh(rb(0.98, 0.62, 0.05, 0.02), 0x2a2438, 0.95);
  frame.position.set(0, 0.44, 0); g.add(frame);

  const wk1Tex = makeTex(768, 480, (c, w, h) => {
    c.fillStyle = '#f8f5ef'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#2a1442'; c.fillRect(0, 0, w, 68);
    c.fillStyle = '#ffd23f'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '900 32px Poppins, sans-serif';
    c.fillText('MYAPPS.CO  •  ANALYTICS', w / 2, 35);
    c.fillStyle = '#3a86ff'; c.fillRect(184, 120, 400, 220);
    c.strokeStyle = '#2a1442'; c.lineWidth = 8; c.strokeRect(184, 120, 400, 220);
    c.fillStyle = '#ffffff'; c.font = '900 72px Poppins, sans-serif';
    c.fillText('9 CLICKS', w / 2, 200);
    c.font = '800 36px Poppins, sans-serif';
    c.fillText('ON APP #2', w / 2, 280);
  });
  const scr1 = makeUnlit(0.90, 0.55, wk1Tex);
  scr1.position.set(0, 0.44, 0.028); g.add(scr1);

  const wk3Tex = makeTex(768, 480, (c, w, h) => {
    c.fillStyle = '#fff9e6'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#2bb673'; c.fillRect(0, 0, w, 72);
    c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '900 34px Poppins, sans-serif';
    c.fillText('WINNER FOUND!  •  BUILD APP #2', w / 2, 37);
    c.fillStyle = '#ffd23f'; c.fillRect(110, 118, 548, 280);
    c.strokeStyle = '#2a1442'; c.lineWidth = 10; c.strokeRect(110, 118, 548, 280);
    c.fillStyle = '#e63946'; c.font = '900 92px Poppins, sans-serif';
    c.fillText('190 CLICKS!', w / 2, 220);
    c.fillStyle = '#2a1442'; c.font = '900 40px Poppins, sans-serif';
    c.fillText('212 TOTAL  •  BUILD THIS', w / 2, 326);
  });
  const scr3 = makeUnlit(0.90, 0.55, wk3Tex);
  scr3.position.set(0, 0.44, 0.029); scr3.visible = false; g.add(scr3);

  function update(t) {
    const isWk3 = t >= 20.60;
    scr1.visible = !isWk3;
    scr3.visible = isWk3;
  }
  return { group: g, update };
}

// ------------------------------------------------------------------ Build Scene
export function build(ctx) {
  const scene = new THREE.Scene();
  const skyColor = new THREE.Color(0x1f2242);
  scene.background = skyColor;

  const hemi = new THREE.HemisphereLight(0xa3baff, 0x30294d, 0.95);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xcfe0ff, 2.0);
  key.position.set(3.8, 6.2, 4.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 22 });
  key.shadow.bias = -0.0012; key.shadow.normalBias = 0.04;
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x9b5de5, 0.9);
  rim.position.set(-4.0, 4.5, -2.0);
  scene.add(rim);

  // ================================================================== SET A: RIVAL'S DEV CAVE (0 .. 13.38s)
  const rivalSet = new THREE.Group();
  scene.add(rivalSet);

  rivalSet.add(makeRoomShell({
    wallCol: 0x2b2d47, wainscotCol: 0x1e1f36, floorCol: 0x3b3854, seamCol: 0x2b2842,
    ceilCol: 0x24253d, beamCol: 0x171829, rugCol: 0x5b3a9e, rugInCol: 0x7c5cff,
  }));

  const rivalDesk = makeDesk(0x28273d, 0x171626, 0x7c5cff);
  rivalDesk.position.set(0.45, 0, -3.12);
  rivalSet.add(rivalDesk);

  const rivalChair = makeSwivelChair(0x6d35a3);
  rivalChair.position.set(-0.42, 0, -2.42);
  rivalChair.rotation.y = 1.45;
  rivalSet.add(rivalChair);

  const rivalMon = makeRivalMonitor();
  rivalMon.group.position.set(0.48, 0.75, -3.18);
  rivalMon.group.rotation.y = -0.18;
  rivalSet.add(rivalMon.group);

  // Rival keyboard, mouse, energy drink cans, poster, server tower, cactus, pizza box (>= 12 props!)
  const rKb = inkMesh(rb(0.38, 0.02, 0.14, 0.006), 0x1e1b2e, 0.6);
  rKb.position.set(0.45, 0.76, -2.86); rKb.rotation.y = -0.18; rivalSet.add(rKb);
  const rMouse = inkMesh(rb(0.065, 0.028, 0.10, 0.012), 0x7c5cff, 0.5);
  rMouse.position.set(0.74, 0.764, -2.82); rMouse.rotation.y = -0.18; rivalSet.add(rMouse);

  for (let i = 0; i < 2; i++) {
    const can = inkMesh(new THREE.CylinderGeometry(0.032, 0.032, 0.11, 12), i ? 0x2bb673 : 0x3a86ff, 0.5);
    can.position.set(-0.18 + i * 0.09, 0.805, -2.92);
    rivalSet.add(can);
  }
  const rivalCal = makeWeeksCalendar();
  rivalCal.group.position.set(1.16, 0.75, -3.05);
  rivalCal.group.rotation.y = -0.22;
  rivalSet.add(rivalCal.group);

  const rivalBoard = makeRivalIdeaBoard();
  rivalBoard.group.position.set(1.68, 1.68, -3.60);
  rivalSet.add(rivalBoard.group);

  // "SHIP FAST!" motivational wall poster on back-left
  const poster = inkMesh(rb(0.86, 1.04, 0.03, 0.01), 0x1a1728, 0.8);
  poster.position.set(-0.62, 1.84, -3.60); rivalSet.add(poster);
  const posterPlate = makeUnlit(0.76, 0.94, makeSignTex('#5b3a9e', '#ffd23f', 'SHIP', 'FAST!', '#ffffff'));
  posterPlate.position.set(-0.62, 1.84, -3.58); rivalSet.add(posterPlate);

  // Server tower + glowing LEDs + potted cactus + pizza box
  const tower = inkMesh(rb(0.32, 0.62, 0.48, 0.02), 0x1d1b2e, 0.85);
  tower.position.set(1.56, 0.31, -3.08); rivalSet.add(tower);
  const towerStrip = new THREE.Mesh(rb(0.03, 0.44, 0.02, 0.005), new THREE.MeshBasicMaterial({ color: 0x56d8ff }));
  towerStrip.position.set(1.56, 0.31, -2.835); rivalSet.add(towerStrip);

  const cactusPot = inkMesh(new THREE.CylinderGeometry(0.16, 0.12, 0.24, 12), 0xd96b43, 0.7);
  cactusPot.position.set(-1.35, 0.12, -3.15); rivalSet.add(cactusPot);
  const cactus = inkMesh(new THREE.CylinderGeometry(0.08, 0.09, 0.44, 12), 0x43a858, 0.7);
  cactus.position.set(-1.35, 0.42, -3.15); rivalSet.add(cactus);

  const pizza = inkMesh(rb(0.42, 0.06, 0.42, 0.01), 0xe6d6bc, 0.7);
  pizza.position.set(-1.45, 0.03, -2.35); pizza.rotation.y = 0.35; rivalSet.add(pizza);

  // Rival character (distinct sleek violet hoodie + auburn swoop hair)
  const rival = makeCharacter({
    name: 'rival',
    look: {
      skin: '#ecc09e',
      hair: { style: 'swoop', color: '#8a3a22' },
      face: { eyeColor: '#355c7d', eyeRX: 0.145, eyeRY: 0.175, irisR: 0.10, browThick: 1.5, browLen: 1.05, mouthW: 0.26, seed: 19 },
      outfit: { style: 'jacket', top: '#5b3a9e', inner: '#f4f1ff', bottom: '#232038', shoes: '#1a1728', sole: '#7c5cff', trim: '#ffd23f' },
    },
  });
  rival.talk(rival.talkFromWords([[9.06, 10.16]]));
  rivalSet.add(rival.group);

  // ================================================================== SET B: FOUNDER'S BRIGHT STUDIO (13.38 .. 27.92s)
  const studioSet = new THREE.Group();
  studioSet.visible = false;
  scene.add(studioSet);

  studioSet.add(makeRoomShell({
    wallCol: 0xf6efe4, wainscotCol: 0x7c9e87, floorCol: 0xc99c6d, seamCol: 0xb08354,
    ceilCol: 0xefe6d8, beamCol: 0x8f6239, rugCol: 0x456990, rugInCol: 0x5c80a8, windowSky: 0x8ad4ff,
  }));

  const desk = makeDesk(0xd8a872, 0x35324a);
  desk.position.set(0.72, 0, -3.12);
  studioSet.add(desk);

  const chair = makeSwivelChair(0x3b4978);
  chair.position.set(-0.42, 0, -2.42); chair.rotation.y = 1.45;
  studioSet.add(chair);

  const studioMon = makeStudioMonitor();
  studioMon.group.position.set(0.86, 0.75, -3.18);
  studioMon.group.rotation.y = -0.16;
  studioSet.add(studioMon.group);

  const kb = inkMesh(rb(0.38, 0.02, 0.14, 0.006), 0xefeef5, 0.6);
  kb.position.set(0.76, 0.76, -2.88); kb.rotation.y = -0.16; studioSet.add(kb);
  const mug = inkMesh(new THREE.CylinderGeometry(0.045, 0.04, 0.10, 14), 0xff6b35, 0.7);
  mug.position.set(-0.08, 0.80, -2.88); studioSet.add(mug);

  const studioCal = makeStudioCalendar();
  studioCal.group.position.set(1.46, 0.75, -3.02);
  studioCal.group.rotation.y = -0.22;
  studioSet.add(studioCal.group);

  const tallySheet = makeTallySheetPart2();
  tallySheet.group.position.set(-0.46, 1.84, -3.60);
  studioSet.add(tallySheet.group);

  // Potted plant + wall clock + bookcase + marker pen in Sam's hand
  const plantPot = inkMesh(new THREE.CylinderGeometry(0.18, 0.13, 0.28, 14), 0xd96b43, 0.8);
  plantPot.position.set(-1.35, 0.14, -3.22); studioSet.add(plantPot);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    const leaf = inkMesh(ball(1, 10, 8), i % 2 ? 0x3d9a4a : 0x52b85b, 0.7);
    leaf.scale.set(0.09, 0.22, 0.03);
    leaf.position.set(-1.35 + Math.cos(a) * 0.11, 0.44, -3.22 + Math.sin(a) * 0.11);
    leaf.rotation.set(0.35, -a, 0.4);
    studioSet.add(leaf);
  }

  const sam = makeSam();
  studioSet.add(sam.group);
  const marker = inkMesh(new THREE.CylinderGeometry(0.015, 0.015, 0.14, 10), 0xe63946, 0.6, { shadow: false });
  marker.rotation.x = Math.PI / 2;
  sam.attach(marker, 'HandR');

  const ada = makeAda();
  studioSet.add(ada.group);

  // ================================================================== Camera Beats (with crisp hard cuts!)
  const cam = new THREE.PerspectiveCamera(58, ctx.w / ctx.h, 0.15, 60);
  const beats = [
    // --- ACT A: Rival's Dev Cave (0..13.33s) — smooth camera glides around the room!
    // 0.10: "Meanwhile, a rival picks the one idea he's sure everyone wants."
    { pos: [-0.32, 1.42, -0.22], look: [0.06, 1.24, -2.85], fov: 58 },
    { at: 1.35, dur: 0.75, pos: [1.52, 1.66, -1.25], look: [1.68, 1.66, -3.60], fov: 55, roll: -0.02 },
    { at: 2.45, dur: 0.65, pos: [1.46, 1.62, -1.38], look: [1.68, 1.66, -3.60], fov: 52, roll: 0.02 },
    // 3.76: "Will love and spends 3 weeks building it with Claude," (smooth glide from board to monitor)
    { at: 3.76, dur: 0.75, pos: [0.56, 1.30, -0.95], look: [0.58, 1.12, -3.18], fov: 54 },
    { at: 4.95, dur: 0.65, pos: [1.05, 1.14, -1.96], look: [1.16, 0.88, -3.05], fov: 44, roll: -0.02 },
    { at: 5.95, dur: 0.65, pos: [0.48, 1.24, -1.00], look: [0.48, 1.16, -3.18], fov: 53, roll: 0.02 },
    // 6.88: "plus a settings page for the settings."
    { at: 6.88, dur: 0.60, pos: [0.48, 1.22, -1.08], look: [0.48, 1.16, -3.18], fov: 52, roll: -0.02 },
    { at: 7.95, dur: 0.65, pos: [0.48, 1.22, -1.16], look: [0.48, 1.16, -3.18], fov: 51, roll: 0.02 },
    // 9.06: "Real founders ship! The rival says" (smooth swing left onto Rival!)
    { at: 9.06, dur: 0.65, pos: [0.55, 1.22, -1.05], look: [-0.36, 1.30, -2.42], fov: 48 },
    { at: 9.95, dur: 0.55, pos: [0.45, 1.26, -1.18], look: [-0.36, 1.32, -2.42], fov: 46, roll: 0.03 },
    // 11.33: "and goes back to polishing a loading spinner." (smooth pan back right to spinner!)
    { at: 11.33, dur: 0.65, pos: [0.48, 1.22, -1.00], look: [0.48, 1.10, -3.18], fov: 52 },
    { at: 12.40, dur: 0.60, pos: [0.48, 1.20, -1.25], look: [0.48, 1.08, -3.18], fov: 50, roll: -0.02 },

    // --- ACT B: HARD CUT ONLY FOR LOCATION CHANGE -> Founder's Bright Studio (13.33..27.92s)
    // 13.33: "In week 1," (HARD CUT to completely different studio room, Calendar WK 1)
    { at: 13.33, cut: true, pos: [1.18, 1.16, -2.12], look: [1.46, 0.90, -3.02], fov: 48 },
    // 14.48: "9 people click on a certain button" (smooth glide onto 9 CLICKS monitor)
    { at: 14.35, dur: 0.55, pos: [0.76, 1.24, -1.35], look: [0.84, 1.14, -3.18], fov: 52 },
    // 16.43: "and he draws 9 tally marks" (smooth sweep left-up to Sam + Tally Sheet)
    { at: 16.20, dur: 0.60, pos: [-0.72, 1.62, -1.22], look: [-0.52, 1.58, -3.32], fov: 54 },
    { at: 17.10, dur: 0.50, pos: [-0.46, 1.72, -1.68], look: [-0.46, 1.68, -3.60], fov: 50, roll: 0.02 },
    // 18.13: "while his co-founder shrugs." (smooth whip-pan right across studio -> lands cleanly on Ada!)
    { at: 17.85, dur: 0.50, pos: [1.28, 1.34, -0.10], look: [1.82, 1.18, -1.78], fov: 56 },
    // 19.61: "By week 3," (smooth push-left onto WK 3 Calendar, clear of Ada!)
    { at: 19.38, dur: 0.50, pos: [1.16, 1.16, -2.14], look: [1.46, 0.90, -3.02], fov: 46 },
    // 20.65: "there are 212 clicks" (smooth sweep left-up to Tally Sheet exploding with 212 CLICKS!)
    { at: 20.45, dur: 0.60, pos: [-0.46, 1.76, -1.62], look: [-0.46, 1.72, -3.60], fov: 52 },
    { at: 21.55, dur: 0.50, pos: [-0.46, 1.82, -1.80], look: [-0.46, 1.78, -3.60], fov: 48, roll: -0.02 },
    // 23.13: "and 190 of them hit the same button." (hold/tilt onto BTN 2 WINNER! 190/100)
    { at: 22.95, dur: 0.55, pos: [-0.46, 1.72, -1.80], look: [-0.46, 1.68, -3.60], fov: 50, roll: 0.02 },
    { at: 24.00, dur: 0.50, pos: [-0.46, 1.70, -1.90], look: [-0.46, 1.66, -3.60], fov: 48, roll: -0.02 },
    // 25.20: "They now know exactly what to build." (smooth pull-back FIRST, then Sam + Ada step in!)
    { at: 24.75, dur: 0.65, pos: [0.16, 1.40, 0.45], look: [0.18, 1.22, -2.30], fov: 56 },
    { at: 26.15, dur: 0.75, pos: [0.18, 1.38, 0.25], look: [0.18, 1.22, -2.30], fov: 54, roll: 0.02 },
  ];

  const rig = ctx.landscape
    ? makeRig(calm(beats.filter((_, i) => i % 2 === 0)), { drift: 0, arc: 0, fps: ctx.fps })
    : makeRig(beats, { drift: 0.032, arc: 0.018, fps: ctx.fps });

  return {
    scene,
    camera: cam,
    update(t) {
      const inRival = t < 13.33;
      rivalSet.visible = inRival;
      studioSet.visible = !inRival;

      // Mood switch on the exact hard cut!
      if (inRival) {
        skyColor.setHex(0x1f2242);
        hemi.color.setHex(0xa3baff);
        hemi.groundColor.setHex(0x30294d);
        key.color.setHex(0xcfe0ff);
        rim.color.setHex(0x9b5de5);
      } else {
        skyColor.setHex(0x90d4f7);
        hemi.color.setHex(0xfff6ea);
        hemi.groundColor.setHex(0x7b6352);
        key.color.setHex(0xfff0d4);
        rim.color.setHex(0xbbe0ff);
      }

      if (inRival) {
        rivalMon.update(t);
        rivalBoard.update(t);
        rivalCal.update(t);

        rival.group.position.set(-0.42, 0, -2.42);
        const faceCamYaw = lerp(1.45, 0.45, sstep((t - 8.9) / 0.3));
        const backDeskYaw = lerp(faceCamYaw, 1.45, sstep((t - 11.2) / 0.25));
        rival.group.rotation.y = backDeskYaw;

        rival.expression((tt) => (tt >= 9.0 && tt < 11.3 ? 'happy' : 'neutral'));
        if (t < 3.6) rival.lookAt([1.68, 1.68, -3.60]);
        else if (t >= 9.0 && t < 11.3) rival.lookAt([0.45, 1.26, -1.25]);
        else rival.lookAt([0.48, 1.18, -3.18]);

        const pickPoint = sstep((t - 1.1) / 0.25) * (1 - sstep((t - 3.4) / 0.25));
        const shipReact = t >= 9.05 && t < 11.2 ? sstep((t - 9.05) / 0.2) * (1 - sstep((t - 10.9) / 0.3)) : 0;
        rival.act({
          sit: { w: 1, seat: 0.43 },
          point: pickPoint > 0.05 ? { w: pickPoint, target: [0.35, 1.22, -0.35] } : 0,
          react: shipReact > 0.05 ? { w: shipReact, t0: 9.05 } : 0,
          talk: t >= 9.05 && t < 11.2 ? 0.85 : 0,
        }, t);
      } else {
        studioCal.update(t);
        studioMon.update(t);
        tallySheet.update(t);

        // Sam stands by tally sheet (13.33..25.0), then smoothly glides left of Ada (25.0..25.65) AFTER camera pulls back!
        const endMove = sstep((t - 25.00) / 0.65);
        const inEnd = t >= 25.25;
        sam.group.position.set(lerp(-0.96, -0.44, endMove), 0, lerp(-2.90, -2.12, endMove));
        sam.group.rotation.y = lerp(2.25, 0.28, endMove);
        sam.expression('happy');
        sam.lookAt([
          lerp(-0.46, 0.16, endMove),
          lerp(1.76, 1.38, endMove),
          lerp(-3.55, 0.35, endMove),
        ]);

        marker.visible = t >= 16.40 && t < 18.00;
        if (t >= 16.45 && t < 18.00) {
          const rw = sstep((t - 16.45) / 0.22) * (1 - sstep((t - 17.75) / 0.25));
          const drawY = 1.72 + 0.04 * Math.sin(TAU * 2.2 * (t - 16.45));
          sam.reach('R', [-0.46, drawY, -3.52], rw);
        } else {
          sam.reach('R', null);
        }

        const endWave = inEnd ? sstep((t - 25.35) / 0.3) : 0;
        sam.act({
          wave: endWave > 0.05 ? { w: endWave, t0: 25.35 } : 0,
          talk: inEnd ? 0.5 : 0,
        }, t);

        // Ada stands right (1.82, 0, -1.78) completely clear of WK 1/3 calendar glide, then steps to (0.16, 0, -2.12)
        ada.group.position.set(lerp(1.82, 0.16, endMove), 0, lerp(-1.78, -2.12, endMove));
        ada.group.rotation.y = lerp(-0.36, -0.14, endMove);
        ada.expression((tt) => (tt < 20.6 ? 'worried' : 'happy'));
        ada.lookAt([
          lerp(1.28, 0.16, endMove),
          lerp(1.34, 1.38, endMove),
          lerp(-0.10, 0.35, endMove),
        ]);

        if (t >= 17.95 && t < 19.50) {
          const sw = sstep((t - 17.95) / 0.20) * (1 - sstep((t - 19.25) / 0.22));
          ada.reach('R', [1.44, 1.24, -1.56], sw);
          ada.reach('L', [2.18, 1.24, -1.56], sw);
        } else {
          ada.reach('R', null);
          ada.reach('L', null);
        }

        const adaPointWin = inEnd ? sstep((t - 25.35) / 0.3) : 0;
        ada.act({
          point: adaPointWin > 0.05 ? { w: adaPointWin, target: [0.88, 1.22, -3.15] } : 0,
          talk: inEnd ? 0.45 : 0,
        }, t);
      }

      applyPose(cam, rig(t));
    },
  };
}
