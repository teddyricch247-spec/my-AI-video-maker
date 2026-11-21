// fake_door_part3: Piece 3 (55.54s - 85.38s shifted to 0.10s - 29.94s, +0.7s tail = 30.64s) of "The Fake Door Test"
// Act A (0.00..5.20s): Rival's Dark Dev Cave — launches & refreshes dashboard -> "0" -> slumps
// Act B (5.20..22.15s): HARD CUT to Sunlit Courtyard — 3 painted doors -> Stranger tries brass handle -> Sam counts 190 -> Door 2 swings open revealing built shop room -> Stranger walks in & pays $49!
// Act C (22.15..24.38s): HARD CUT to Rival's Cave — dashboard still says "0"
// Act D (24.38..30.64s): HARD CUT to Bright Studio Finale — Sam & Ada + NO CLAUDE CODE + COMMENT "GUIDE"
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

function makeSignTex(bg, fg, title, sub = '', border = '#2a1442', titlePx = 78, subPx = 44) {
  return makeTex(512, 256, (c, w, h) => {
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    c.strokeStyle = border; c.lineWidth = 18; c.strokeRect(9, 9, w - 18, h - 18);
    c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `900 ${titlePx}px Poppins, sans-serif`;
    c.fillText(title, w / 2, sub ? h * 0.36 : h * 0.52);
    if (sub) {
      c.font = `800 ${subPx}px Poppins, sans-serif`;
      c.fillText(sub, w / 2, h * 0.72);
    }
  });
}

// ------------------------------------------------------------------ Shared Furniture & Room Shell
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
  seat.position.set(0, 0.43, 0); g.add(seat);
  const back = inkMesh(rb(0.44, 0.46, 0.07, 0.03), seatCol, 0.85);
  back.position.set(0, 0.70, -0.21); back.rotation.x = -0.12; g.add(back);
  const stem = inkMesh(new THREE.CylinderGeometry(0.035, 0.04, 0.32, 10), 0x2b2838, 0.6);
  stem.position.set(0, 0.24, 0); g.add(stem);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    const arm = inkMesh(rb(0.04, 0.035, 0.26, 0.01), 0x2b2838, 0.5);
    arm.position.set(Math.sin(a) * 0.13, 0.06, Math.cos(a) * 0.13); arm.rotation.y = a; g.add(arm);
  }
  return g;
}

function makeRoomShell({ wallCol, wainscotCol, floorCol, seamCol, ceilCol, beamCol, rugCol, rugInCol, windowSky = null }) {
  const g = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(11, 10), toon(floorCol));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor);
  for (let i = -5; i <= 5; i++) {
    const seam = new THREE.Mesh(new THREE.PlaneGeometry(11, 0.018), toon(seamCol));
    seam.rotation.x = -Math.PI / 2; seam.position.set(0, 0.003, i * 0.75);
    seam.receiveShadow = true; g.add(seam);
  }
  const rug = inkMesh(rb(3.5, 0.015, 2.5, 0.005), rugCol, 0.6, { shadow: false });
  rug.position.set(0.15, 0.008, -2.1); g.add(rug);
  const rugIn = new THREE.Mesh(new THREE.PlaneGeometry(3.15, 2.15), toon(rugInCol));
  rugIn.rotation.x = -Math.PI / 2; rugIn.position.set(0.15, 0.017, -2.1); rugIn.receiveShadow = true; g.add(rugIn);

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
    winG.position.set(2.65, 1.95, -3.63);
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

// ------------------------------------------------------------------ Rival Dashboard Monitor (Act A & Act C)
function makeRivalDashMonitor() {
  const g = new THREE.Group();
  const base = inkMesh(rb(0.40, 0.025, 0.24, 0.01), 0x1e1b2e, 0.7);
  base.position.set(0, 0.0125, 0); g.add(base);
  const neck = inkMesh(rb(0.08, 0.20, 0.05, 0.015), 0x1e1b2e, 0.7);
  neck.position.set(0, 0.11, -0.05); g.add(neck);
  const frame = inkMesh(rb(1.06, 0.64, 0.055, 0.02), 0x1a1728, 0.95);
  frame.position.set(0, 0.45, 0); g.add(frame);

  // 1: LAUNCHED!
  const launchTex = makeTex(768, 480, (c, w, h) => {
    c.fillStyle = '#141221'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#2bb673'; c.fillRect(0, 0, w, 78);
    c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '900 38px Poppins, sans-serif';
    c.fillText('LIVE  •  ANALYTICS', w / 2, 40);
    c.fillStyle = '#26243d'; c.fillRect(100, 128, w - 200, 260);
    c.strokeStyle = '#2bb673'; c.lineWidth = 8; c.strokeRect(100, 128, w - 200, 260);
    c.fillStyle = '#ffd23f'; c.font = '900 66px Poppins, sans-serif';
    c.fillText('LAUNCHED!', w / 2, 232);
    c.fillStyle = '#a3a8d6'; c.font = '800 32px Poppins, sans-serif';
    c.fillText('CHECKING USERS...', w / 2, 326);
  });
  const scrLaunch = makeUnlit(0.98, 0.56, launchTex);
  scrLaunch.position.set(0, 0.45, 0.030); g.add(scrLaunch);

  // 2: REFRESHING...
  const refreshTex = makeTex(768, 480, (c, w, h) => {
    c.fillStyle = '#141221'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#7c5cff'; c.fillRect(0, 0, w, 78);
    c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '900 38px Poppins, sans-serif';
    c.fillText('REFRESHING...', w / 2, 40);
    c.fillStyle = '#a3a8d6'; c.font = '800 34px Poppins, sans-serif';
    c.fillText('LOADING SALES...', w / 2, 412);
  });
  const scrRefresh = makeUnlit(0.98, 0.56, refreshTex);
  scrRefresh.position.set(0, 0.45, 0.031); scrRefresh.visible = false; g.add(scrRefresh);

  const spinWheel = new THREE.Group();
  spinWheel.position.set(0, 0.46, 0.042);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const dot = new THREE.Mesh(ball(0.022, 10, 8), new THREE.MeshBasicMaterial({ color: i === 0 ? 0xffd23f : 0x56d8ff }));
    dot.position.set(Math.cos(a) * 0.11, Math.sin(a) * 0.11, 0);
    dot.scale.setScalar(i === 0 ? 1.25 : 0.85);
    spinWheel.add(dot);
  }
  spinWheel.visible = false; g.add(spinWheel);

  // 3: ZERO! (Act A after 2.35s & Act C)
  const zeroTex = makeTex(768, 480, (c, w, h) => {
    c.fillStyle = '#1a1221'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#e63946'; c.fillRect(0, 0, w, 78);
    c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '900 38px Poppins, sans-serif';
    c.fillText('USERS  •  REVENUE', w / 2, 40);
    c.fillStyle = '#2d1a2e'; c.fillRect(96, 114, w - 192, 232);
    c.strokeStyle = '#e63946'; c.lineWidth = 10; c.strokeRect(96, 114, w - 192, 232);
    c.fillStyle = '#ff4d5a'; c.font = '900 176px Poppins, sans-serif';
    c.fillText('0', w / 2, 238);
    c.fillStyle = '#ffd23f'; c.font = '900 38px Poppins, sans-serif';
    c.fillText('$0  •  NO ONE WANTS IT', w / 2, 412);
  });
  const scrZero = makeUnlit(0.98, 0.56, zeroTex);
  scrZero.position.set(0, 0.45, 0.032); scrZero.visible = false; g.add(scrZero);

  function update(t) {
    const isLaunch = t < 1.25;
    const isRefresh = t >= 1.25 && t < 2.45;
    const isZero = t >= 2.45;
    scrLaunch.visible = isLaunch;
    scrRefresh.visible = isRefresh;
    spinWheel.visible = isRefresh;
    scrZero.visible = isZero;
    if (isRefresh) spinWheel.rotation.z = -t * TAU * 1.6;
  }
  return { group: g, update };
}

// ------------------------------------------------------------------ Painted Cartoon Doors Wall + Built Shop Room Behind Door 2
function makePaintedDoor({ label, sub, doorCol, panelCol, hasHandle3D = false }) {
  const g = new THREE.Group();
  const tex = makeTex(360, 720, (c, w, h) => {
    // Painted flat wooden frame + cartoon door lines right on the wall
    c.fillStyle = '#2a1442'; c.fillRect(0, 0, w, h);
    c.fillStyle = doorCol; c.fillRect(14, 14, w - 28, h - 14);
    c.fillStyle = panelCol;
    c.fillRect(46, 52, w - 92, 210);
    c.strokeStyle = '#2a1442'; c.lineWidth = 10; c.strokeRect(46, 52, w - 92, 210);
    c.fillRect(46, 400, w - 92, 250);
    c.strokeRect(46, 400, w - 92, 250);

    // Header text painted on door
    c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '900 54px Poppins, sans-serif';
    c.fillText(label, w / 2, 136);
    c.fillStyle = '#ffd23f'; c.font = '800 32px Poppins, sans-serif';
    c.fillText(sub, w / 2, 210);

    if (!hasHandle3D) {
      // Flat painted doorknob on Door 1 & 3
      c.fillStyle = '#ffd23f';
      c.beginPath(); c.arc(w - 64, 345, 22, 0, TAU); c.fill();
      c.strokeStyle = '#2a1442'; c.lineWidth = 6; c.stroke();
    }
  });
  // Door thickness = 0.06m, hinged nicely
  const slab = inkMesh(rb(1.02, 2.12, 0.06, 0.015), 0xf6efe4, 0.85);
  slab.position.set(0.51, 1.06, 0);
  g.add(slab);
  const face = makeUnlit(1.00, 2.10, tex);
  face.position.set(0.51, 1.06, 0.032);
  g.add(face);
  const backFace = makeUnlit(1.00, 2.10, tex);
  backFace.position.set(0.51, 1.06, -0.032);
  backFace.rotation.y = Math.PI;
  g.add(backFace);

  let handleGroup = null;
  if (hasHandle3D) {
    handleGroup = new THREE.Group();
    handleGroup.position.set(0.86, 1.02, 0.038);
    const plate = inkMesh(rb(0.08, 0.20, 0.02, 0.006), 0xffb81c, 0.7);
    handleGroup.add(plate);
    const stem = inkMesh(new THREE.CylinderGeometry(0.022, 0.022, 0.08, 12), 0xffd23f, 0.6);
    stem.rotation.x = Math.PI / 2; stem.position.set(0, 0, 0.04);
    handleGroup.add(stem);
    const lever = inkMesh(rb(0.16, 0.035, 0.035, 0.012), 0xffd23f, 0.75);
    lever.position.set(-0.06, 0, 0.08);
    handleGroup.add(lever);
    g.add(handleGroup);
  }
  return { group: g, handleGroup };
}

function makeCourtyardAndShop() {
  const g = new THREE.Group();

  // Sunlit grass & stone courtyard floor
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(18, 18), toon(0x73c464));
  grass.rotation.x = -Math.PI / 2; grass.receiveShadow = true; g.add(grass);
  const patio = inkMesh(rb(6.4, 0.02, 4.6, 0.01), 0xe8dec8, 0.6, { shadow: false });
  patio.position.set(0, 0.01, -1.2); g.add(patio);
  const path = inkMesh(rb(1.25, 0.022, 4.4, 0.01), 0xd4c3a3, 0.5, { shadow: false });
  path.position.set(0, 0.012, -1.2); g.add(path);

  // Cream plaster front wall with REAL cutout for Door 2 (x = -0.52..+0.52, y = 0..2.14)
  const wallCol = 0xf6efe4, trimCol = 0xd96b43;
  const wallLeft = inkMesh(rb(4.0, 3.6, 0.14, 0.02), wallCol, 0.7);
  wallLeft.position.set(-2.52, 1.80, -3.40); g.add(wallLeft);
  const wallRight = inkMesh(rb(4.0, 3.6, 0.14, 0.02), wallCol, 0.7);
  wallRight.position.set(2.52, 1.80, -3.40); g.add(wallRight);
  const wallTop = inkMesh(rb(1.06, 1.46, 0.14, 0.02), wallCol, 0.7);
  wallTop.position.set(0, 2.87, -3.40); g.add(wallTop);
  const roofCap = inkMesh(rb(9.2, 0.16, 0.30, 0.02), trimCol, 0.8);
  roofCap.position.set(0, 3.62, -3.40); g.add(roofCap);

  // Door 1 (left, flat on wall) & Door 3 (right, flat on wall)
  const d1 = makePaintedDoor({ label: 'APP 1', sub: '2 CLICKS', doorCol: '#3a86ff', panelCol: '#2466cc', hasHandle3D: false });
  d1.group.position.set(-2.00, 0.02, -3.32); g.add(d1.group);
  const d3 = makePaintedDoor({ label: 'APP 3', sub: '5 CLICKS', doorCol: '#ff6b35', panelCol: '#cc4b1f', hasHandle3D: false });
  d3.group.position.set(0.98, 0.02, -3.32); g.add(d3.group);

  // Door 2 (center HERO painted door with 3D brass handle, hinged at x = -0.51, z = -3.32!)
  const d2 = makePaintedDoor({ label: 'APP 2', sub: '190 TALLIES', doorCol: '#e63946', panelCol: '#b82532', hasHandle3D: true });
  d2.group.position.set(-0.51, 0.02, -3.32);
  g.add(d2.group);

  // Top sign above Door 2: switches from "FAKE DOOR TEST" (5.2..15.8s) -> "190 TALLIES • BUILT!" (15.8..22.15s)
  const signFake = makeUnlit(1.12, 0.40, makeSignTex('#ffd23f', '#2a1442', 'FAKE DOOR', 'TEST • 190', '#2a1442', 76, 42));
  signFake.position.set(0, 2.38, -3.31);
  g.add(signFake);

  const signBuilt = makeUnlit(1.12, 0.40, makeSignTex('#2bb673', '#ffffff', '190 TALLIES', 'ROOM BUILT! ✓', '#2a1442', 72, 40));
  signBuilt.position.set(0, 2.38, -3.30);
  signBuilt.visible = false;
  g.add(signBuilt);

  // Decorative potted bushes flanking courtyard
  for (const bx of [-2.45, 2.45]) {
    const pot = inkMesh(new THREE.CylinderGeometry(0.22, 0.16, 0.34, 14), 0xd96b43, 0.7);
    pot.position.set(bx, 0.17, -2.90); g.add(pot);
    const bush = inkMesh(ball(0.28, 14, 10), 0x3d9a4a, 0.7);
    bush.position.set(bx, 0.50, -2.90); g.add(bush);
  }

  // BEFORE 15.80s: flat painted "UNBUILT" sign/dashed chalk wall visible ONLY if anything peeks behind (plus solid backing wall that hides when room builds)
  const solidBack = new THREE.Mesh(new THREE.PlaneGeometry(1.12, 2.20), toon(0xe6dfd3));
  solidBack.position.set(0, 1.10, -3.44);
  g.add(solidBack);

  // BUILT SHOP ROOM BEHIND DOOR 2 (pops up at 15.80s!)
  const builtRoom = new THREE.Group();
  builtRoom.position.set(0, 0, -3.45);
  builtRoom.scale.setScalar(0.001);
  builtRoom.visible = false;
  g.add(builtRoom);

  const rFloor = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.8), toon(0xd4a36a));
  rFloor.rotation.x = -Math.PI / 2; rFloor.position.set(0, 0.015, -1.4); rFloor.receiveShadow = true; builtRoom.add(rFloor);
  const rBack = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.4), toon(0xfff4de));
  rBack.position.set(0, 1.7, -2.75); builtRoom.add(rBack);
  const rLeft = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 3.4), toon(0xffeacc));
  rLeft.rotation.y = Math.PI / 2; rLeft.position.set(-1.55, 1.7, -1.4); builtRoom.add(rLeft);
  const rRight = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 3.4), toon(0xffeacc));
  rRight.rotation.y = -Math.PI / 2; rRight.position.set(1.55, 1.7, -1.4); builtRoom.add(rRight);
  const rCeil = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.8), toon(0xf5e5cc));
  rCeil.rotation.x = Math.PI / 2; rCeil.position.set(0, 3.35, -1.4); builtRoom.add(rCeil);

  // Warm shop light inside room
  const shopLight = new THREE.PointLight(0xffefc2, 3.0, 9);
  shopLight.position.set(0, 2.6, -1.2);
  builtRoom.add(shopLight);

  // Shop counter + cash register + Open sign + product shelves!
  const counter = inkMesh(rb(1.25, 0.88, 0.50, 0.03), 0x3a86ff, 0.8);
  counter.position.set(-0.22, 0.44, -1.15); builtRoom.add(counter);
  const counterTop = inkMesh(rb(1.32, 0.07, 0.56, 0.02), 0xffe4b8, 0.7);
  counterTop.position.set(-0.22, 0.90, -1.15); builtRoom.add(counterTop);

  const reg = inkMesh(rb(0.28, 0.20, 0.24, 0.02), 0x2a2438, 0.8);
  reg.position.set(-0.56, 1.03, -1.15); builtRoom.add(reg);

  const openSign = makeUnlit(0.92, 0.36, makeSignTex('#2bb673', '#ffffff', 'APP #2 SHOP', 'OPEN FOR BUSINESS', '#2a1442', 72, 34));
  openSign.position.set(0, 2.28, -2.72); builtRoom.add(openSign);

  // Gold "$49" coin & "PAID!" popup cleanly above counter/heads (appears 20.3..22.15s)
  const coin = inkMesh(new THREE.CylinderGeometry(0.11, 0.11, 0.035, 18), 0xffd23f, 0.8);
  coin.rotation.x = Math.PI / 2;
  coin.position.set(0.10, 1.12, -1.00);
  coin.visible = false;
  builtRoom.add(coin);

  const paidPop = makeUnlit(0.92, 0.36, makeSignTex('#ffd23f', '#2bb673', '+$49 PAID!', 'FIRST CUSTOMER ★', '#2a1442', 80, 34));
  paidPop.position.set(0.0, 1.88, -1.35);
  paidPop.visible = false;
  builtRoom.add(paidPop);

  // Floating "+1" / "190" tally popup badge above Door 2 handle (13.0..15.6s)
  const tallyPop = makeUnlit(0.68, 0.30, makeSignTex('#ffd23f', '#e63946', '190!', 'CLICKS', '#2a1442', 92, 38));
  tallyPop.position.set(0.02, 1.66, -3.18);
  tallyPop.visible = false;
  g.add(tallyPop);

  function update(t) {
    // Handle jiggle when Stranger tries handle (12.8..14.4s)
    if (d2.handleGroup) {
      if (t >= 12.80 && t < 14.45) {
        d2.handleGroup.rotation.z = 0.42 * Math.sin((t - 12.80) * TAU * 2.5);
      } else {
        d2.handleGroup.rotation.z = 0;
      }
    }

    // Tally pop
    tallyPop.visible = t >= 13.05 && t < 15.70;
    if (tallyPop.visible) {
      tallyPop.scale.setScalar(Math.max(0.001, backOut((t - 13.05) / 0.3)));
    }

    // Build room & swing open Door 2 at 15.65s!
    const isBuilt = t >= 15.65;
    signFake.visible = !isBuilt;
    signBuilt.visible = isBuilt;
    solidBack.visible = !isBuilt;
    builtRoom.visible = isBuilt;
    if (isBuilt) {
      const bk = backOut((t - 15.65) / 0.55);
      builtRoom.scale.setScalar(Math.max(0.001, bk));
      const swing = sstep((t - 15.75) / 0.75);
      d2.group.rotation.y = lerp(0, -1.68, swing);
    } else {
      d2.group.rotation.y = 0;
    }

    // Coin & PAID popup at 20.55s
    coin.visible = t >= 20.30 && t < 21.30;
    if (coin.visible) {
      const ck = sstep((t - 20.30) / 0.65);
      coin.position.set(lerp(0.28, -0.10, ck), 1.15 + Math.sin(ck * Math.PI) * 0.25, lerp(-0.65, -1.15, ck));
      coin.rotation.y = t * 4;
    }
    paidPop.visible = t >= 20.75;
    if (paidPop.visible) {
      paidPop.scale.setScalar(Math.max(0.001, backOut((t - 20.75) / 0.35)));
    }
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
  Object.assign(key.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 25 });
  key.shadow.bias = -0.0012; key.shadow.normalBias = 0.04;
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x9b5de5, 0.9);
  rim.position.set(-4.0, 4.5, -2.0);
  scene.add(rim);

  // ================================================================== SET A / C: RIVAL'S DEV CAVE (0..5.20s & 22.15..24.38s)
  const rivalSet = new THREE.Group();
  scene.add(rivalSet);

  rivalSet.add(makeRoomShell({
    wallCol: 0x2b2d47, wainscotCol: 0x1e1f36, floorCol: 0x3b3854, seamCol: 0x2b2842,
    ceilCol: 0x24253d, beamCol: 0x171829, rugCol: 0x5b3a9e, rugInCol: 0x7c5cff,
  }));

  const rDesk = makeDesk(0x28273d, 0x171626, 0x7c5cff);
  rDesk.position.set(0.45, 0, -3.12); rivalSet.add(rDesk);

  const rChair = makeSwivelChair(0x6d35a3);
  rChair.position.set(-0.42, 0, -2.42); rChair.rotation.y = 1.45; rivalSet.add(rChair);

  const rMon = makeRivalDashMonitor();
  rMon.group.position.set(0.48, 0.75, -3.18); rMon.group.rotation.y = -0.18;
  rivalSet.add(rMon.group);

  const rKb = inkMesh(rb(0.38, 0.02, 0.14, 0.006), 0x1e1b2e, 0.6);
  rKb.position.set(0.45, 0.76, -2.86); rKb.rotation.y = -0.18; rivalSet.add(rKb);
  const poster = inkMesh(rb(0.86, 1.04, 0.03, 0.01), 0x1a1728, 0.8);
  poster.position.set(-0.62, 1.84, -3.60); rivalSet.add(poster);
  const posterPlate = makeUnlit(0.76, 0.94, makeSignTex('#5b3a9e', '#ffd23f', 'SHIP', 'FAST!', '#ffffff'));
  posterPlate.position.set(-0.62, 1.84, -3.58); rivalSet.add(posterPlate);

  const rival = makeCharacter({
    name: 'rival',
    look: {
      skin: '#ecc09e',
      hair: { style: 'swoop', color: '#8a3a22' },
      face: { eyeColor: '#355c7d', eyeRX: 0.145, eyeRY: 0.175, irisR: 0.10, browThick: 1.5, browLen: 1.05, mouthW: 0.26, seed: 19 },
      outfit: { style: 'jacket', top: '#5b3a9e', inner: '#f4f1ff', bottom: '#232038', shoes: '#1a1728', sole: '#7c5cff', trim: '#ffd23f' },
    },
  });
  rivalSet.add(rival.group);

  // ================================================================== SET B: COURTYARD & PAINTED DOORS (5.20..22.15s)
  const yardSet = new THREE.Group();
  yardSet.visible = false;
  scene.add(yardSet);

  const yard = makeCourtyardAndShop();
  yardSet.add(yard.group);

  const samYard = makeSam();
  yardSet.add(samYard.group);

  // Tally counter / clipboard in Sam's hand while counting Door 2 attempts
  const clipboard = inkMesh(rb(0.20, 0.26, 0.02, 0.005), 0xfff9ee, 0.5, { shadow: false });
  samYard.attach(clipboard, 'HandL');

  // Stranger character who tries the painted door handle & later walks into built room to pay $49!
  const stranger = makeCharacter({
    name: 'stranger',
    look: {
      skin: '#d9a17a',
      hair: { style: 'cap', color: '#3552e0', brim: '#ffd23f' },
      face: { eyeColor: '#2a1442', eyeRX: 0.14, eyeRY: 0.17, irisR: 0.095, browThick: 1.4, browLen: 1.0, mouthW: 0.24, seed: 31 },
      outfit: { style: 'hoodie', top: '#ff6b35', inner: '#ffffff', bottom: '#264653', shoes: '#1a1728', sole: '#ffffff', trim: '#ffd23f' },
    },
  });
  yardSet.add(stranger.group);

  // ================================================================== SET D: BRIGHT STUDIO CTA FINALE (24.38..30.64s)
  const ctaSet = new THREE.Group();
  ctaSet.visible = false;
  scene.add(ctaSet);

  ctaSet.add(makeRoomShell({
    wallCol: 0xf6efe4, wainscotCol: 0x7c9e87, floorCol: 0xc99c6d, seamCol: 0xb08354,
    ceilCol: 0xefe6d8, beamCol: 0x8f6239, rugCol: 0x456990, rugInCol: 0x5c80a8, windowSky: 0x8ad4ff,
  }));

  const samCta = makeSam();
  samCta.group.position.set(-0.46, 0, -2.10);
  samCta.group.rotation.y = 0.22;
  ctaSet.add(samCta.group);

  const adaCta = makeAda();
  adaCta.group.position.set(0.46, 0, -2.10);
  adaCta.group.rotation.y = -0.22;
  ctaSet.add(adaCta.group);

  // Clean wall CTA cards positioned high & well-padded so captions at 70% & edges never clip!
  const badgeNoClaude = makeUnlit(1.08, 0.44, makeSignTex('#1a1728', '#ffd23f', 'NO CODE NEEDED', 'WITHOUT CLAUDE CODE', '#e63946', 44, 30));
  badgeNoClaude.position.set(0, 2.02, -2.75);
  badgeNoClaude.visible = false;
  ctaSet.add(badgeNoClaude);

  const badgeGuide = makeUnlit(1.16, 0.48, makeSignTex('#ffd23f', '#2a1442', 'COMMENT "GUIDE"', 'SEND FULL GUIDE ↓', '#e63946', 46, 32));
  badgeGuide.position.set(0, 2.04, -2.70);
  badgeGuide.visible = false;
  ctaSet.add(badgeGuide);

  // ================================================================== Camera Beats (smooth intra-room glides, hard cuts ONLY on location change!)
  const cam = new THREE.PerspectiveCamera(58, ctx.w / ctx.h, 0.15, 60);
  const beats = [
    // --- ACT A: Rival's Dark Dev Cave (0.00..5.20s)
    { pos: [-0.24, 1.40, -0.35], look: [0.16, 1.20, -2.85], fov: 58 },
    // 1.35: smooth glide closer onto refreshing dashboard -> "0"
    { at: 1.35, dur: 0.70, pos: [0.48, 1.24, -1.10], look: [0.48, 1.14, -3.18], fov: 52, roll: -0.02 },
    // 3.15: smooth pan left onto stunned Rival ("It says zero. No one wants it.")
    { at: 3.15, dur: 0.65, pos: [0.38, 1.24, -1.05], look: [-0.36, 1.28, -2.42], fov: 48, roll: 0.02 },

    // --- ACT B: HARD CUT FOR LOCATION CHANGE -> Courtyard & Painted Doors (5.20..22.15s)
    // Wide shot showing Sam + ALL 3 painted doors ("which app to build?")
    { at: 5.20, cut: true, pos: [-0.08, 1.52, 1.55], look: [-0.08, 1.30, -3.20], fov: 60 },
    // 7.90: smooth glide onto Sam + FAKE DOOR TEST + Door 2 ("Well, it's called a fake door test.")
    { at: 7.90, dur: 0.70, pos: [-0.36, 1.44, -0.05], look: [-0.26, 1.34, -3.15], fov: 56, roll: -0.02 },
    // 10.20: smooth glide onto Door 2 painted flat on wall ("a door painted on a wall")
    { at: 10.20, dur: 0.65, pos: [0.02, 1.38, -0.55], look: [0.02, 1.30, -3.32], fov: 52, roll: 0.02 },
    // 12.40: smooth orbit LEFT onto 3/4 view of Stranger trying brass handle + Sam + 190 counter!
    { at: 12.40, dur: 0.65, pos: [-0.68, 1.38, -0.70], look: [0.10, 1.26, -2.95], fov: 56, roll: -0.02 },
    // 14.45: smooth drift to frame Door 2 + 190 sign clearly
    { at: 14.45, dur: 0.60, pos: [-0.15, 1.44, -0.45], look: [0.0, 1.34, -3.32], fov: 56 },
    // 15.85: smooth dolly straight through opening Door 2 into the newly built shop room!
    { at: 15.85, dur: 0.85, pos: [0.05, 1.40, -1.55], look: [-0.05, 1.28, -4.35], fov: 54 },
    // 18.50: smooth push inside the shop framing Sam, Stranger, open sign & $49 PAID!
    { at: 18.50, dur: 0.75, pos: [0.32, 1.40, -1.95], look: [-0.08, 1.36, -4.45], fov: 56, roll: 0.02 },
    { at: 20.40, dur: 0.65, pos: [0.22, 1.42, -2.10], look: [-0.06, 1.40, -4.45], fov: 54, roll: -0.02 },

    // --- ACT C: HARD CUT FOR LOCATION CHANGE -> Rival's Dark Dev Cave ("still says zero") (22.15..24.32s)
    { at: 22.15, cut: true, pos: [-0.08, 1.36, -0.58], look: [0.10, 1.18, -2.85], fov: 54 },
    { at: 23.00, dur: 0.65, pos: [0.12, 1.30, -0.95], look: [0.18, 1.16, -2.95], fov: 50, roll: 0.02 },

    // --- ACT D: HARD CUT FOR LOCATION CHANGE -> Bright Hero Studio CTA Finale (24.32..30.64s)
    { at: 24.32, cut: true, pos: [0.0, 1.38, 0.55], look: [0.0, 1.36, -2.25], fov: 56 },
    { at: 26.20, dur: 0.75, pos: [0.04, 1.42, 0.35], look: [0.0, 1.38, -2.35], fov: 56, roll: -0.02 },
    { at: 27.80, dur: 0.75, pos: [0.0, 1.42, 0.25], look: [0.0, 1.40, -2.40], fov: 56, roll: 0.02 },
  ];

  const rig = ctx.landscape
    ? makeRig(calm(beats.filter((_, i) => i % 2 === 0)), { drift: 0, arc: 0, fps: ctx.fps })
    : makeRig(beats, { drift: 0.030, arc: 0.016, fps: ctx.fps });

  return {
    scene,
    camera: cam,
    update(t) {
      const inRival = t < 5.20 || (t >= 22.15 && t < 24.32);
      const inYard = t >= 5.20 && t < 22.15;
      const inCta = t >= 24.32;

      rivalSet.visible = inRival;
      yardSet.visible = inYard;
      ctaSet.visible = inCta;

      if (inRival) {
        skyColor.setHex(0x1f2242);
        hemi.color.setHex(0xa3baff); hemi.groundColor.setHex(0x30294d);
        key.color.setHex(0xcfe0ff); rim.color.setHex(0x9b5de5);

        rMon.update(t);
        rival.group.position.set(-0.42, 0, -2.42);
        rival.group.rotation.y = 1.42;
        rival.expression((tt) => (tt < 2.45 ? 'happy' : 'worried'));
        rival.lookAt(t >= 3.0 && t < 5.20 ? [0.38, 1.24, -1.05] : [0.48, 1.18, -3.18]);
        const slumpW = t >= 2.65 ? sstep((t - 2.65) / 0.35) : 0;
        rival.act({
          sit: { w: 1, seat: 0.43 },
          slump: slumpW > 0.05 ? slumpW : 0,
        }, t);
      } else if (inYard) {
        skyColor.setHex(0x8ed6ff);
        hemi.color.setHex(0xfff6ea); hemi.groundColor.setHex(0x73c464);
        key.color.setHex(0xfff0d4); rim.color.setHex(0xbbe0ff);

        yard.update(t);

        // Sam stands left of Door 2 (5.2..15.65), then glides behind shop counter inside Door 2 (15.65..22.15)
        const moveShop = sstep((t - 15.65) / 0.65);
        samYard.group.position.set(lerp(-0.78, -0.44, moveShop), 0, lerp(-2.35, -4.92, moveShop));
        samYard.group.rotation.y = lerp(0.32, 0.14, moveShop);
        samYard.expression('happy');
        samYard.lookAt(t < 15.65 ? [0.0, 1.32, -3.10] : [0.22, 1.36, -4.15]);

        clipboard.visible = t < 15.65;
        const samPoint = t >= 7.8 && t < 12.2 ? sstep((t - 7.8) / 0.25) * (1 - sstep((t - 11.8) / 0.3)) : 0;
        const samWave = t >= 20.5 ? sstep((t - 20.5) / 0.25) : 0;
        samYard.act({
          point: samPoint > 0.05 ? { w: samPoint, target: [0.0, 1.30, -3.32] } : 0,
          wave: samWave > 0.05 ? { w: samWave, t0: 20.5 } : 0,
          talk: t < 12.0 || t >= 16.5 ? 0.55 : 0,
        }, t);

        // Stranger: walks up right of Door 2 handle (11.2..12.8) so he never blocks Door 2/190!, tries handle, then enters built shop & pays!
        stranger.group.visible = t >= 11.20;
        if (stranger.group.visible) {
          const walkToDoor = sstep((t - 11.20) / 1.40);
          const stepClear = sstep((t - 15.00) / 0.65);
          const enterShop = sstep((t - 18.20) / 1.75);

          let sx = lerp(1.65, 0.58, walkToDoor);
          let sz = lerp(-1.55, -2.62, walkToDoor);
          let syaw = lerp(-2.25, -2.45, walkToDoor);

          if (t >= 15.00 && t < 18.20) {
            sx = lerp(0.58, 0.72, stepClear);
            sz = lerp(-2.62, -2.35, stepClear);
            syaw = lerp(-2.45, -2.85, stepClear);
          } else if (t >= 18.20) {
            sx = lerp(0.72, 0.34, enterShop);
            sz = lerp(-2.35, -4.15, enterShop);
            syaw = lerp(-2.85, -2.65, enterShop);
          }
          stranger.group.position.set(sx, 0, sz);
          stranger.group.rotation.y = syaw;
          stranger.expression(t >= 19.8 ? 'happy' : 'neutral');
          stranger.lookAt(t >= 18.2 ? [-0.44, 1.36, -4.92] : [0.35, 1.02, -3.28]);

          const isWalking = (t >= 11.20 && t < 12.60) || (t >= 18.20 && t < 19.95);
          if (t >= 12.60 && t < 14.45) {
            const hw = sstep((t - 12.60) / 0.20) * (1 - sstep((t - 14.20) / 0.25));
            stranger.reach('R', [0.35, 1.02 + 0.04 * Math.sin((t - 12.60) * TAU * 2.5), -3.25], hw);
          } else if (t >= 20.15 && t < 21.45) {
            const pw = sstep((t - 20.15) / 0.25) * (1 - sstep((t - 21.15) / 0.25));
            stranger.reach('R', [-0.08, 1.14, -4.55], pw);
          } else {
            stranger.reach('R', null);
          }
          stranger.act({
            walk: isWalking ? 0.9 : 0,
            talk: t >= 20.3 ? 0.4 : 0,
          }, t);
        }
      } else {
        skyColor.setHex(0x90d4f7);
        hemi.color.setHex(0xfff6ea); hemi.groundColor.setHex(0x7b6352);
        key.color.setHex(0xfff0d4); rim.color.setHex(0xbbe0ff);

        samCta.expression('happy');
        samCta.lookAt([0.0, 1.42, 0.20]);
        adaCta.expression('happy');
        adaCta.lookAt([0.0, 1.42, 0.20]);

        badgeNoClaude.visible = t >= 26.20 && t < 27.80;
        if (badgeNoClaude.visible) {
          badgeNoClaude.scale.setScalar(Math.max(0.001, backOut((t - 26.20) / 0.35)));
        }
        badgeGuide.visible = t >= 27.80;
        if (badgeGuide.visible) {
          badgeGuide.scale.setScalar(Math.max(0.001, backOut((t - 27.80) / 0.35)));
        }

        const ctaPoint = t >= 27.90 ? sstep((t - 27.90) / 0.30) : 0;
        samCta.act({
          wave: sstep((t - 24.50) / 0.30) * (1 - ctaPoint * 0.7),
          point: ctaPoint > 0.05 ? { w: ctaPoint, target: [0.0, 2.12, -2.35] } : 0,
          talk: 0.8,
        }, t);
        adaCta.act({
          point: ctaPoint > 0.05 ? { w: ctaPoint, target: [0.0, 2.12, -2.35] } : 0,
          wave: t >= 24.60 && t < 27.80 ? 0.85 : 0,
          talk: 0.55,
        }, t);
      }

      applyPose(cam, rig(t));
    },
  };
}
