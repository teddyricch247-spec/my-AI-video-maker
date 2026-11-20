// target_fixation: full 60-second story ("If you plant a tree beside an empty road...")
// Everything is a pure function of t. Road runs along z (cars drive toward +z), tree/stump at (-4.7, -8.4).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { toon } from '../lib/toon.js';
import { makeRig, applyPose, calm } from '../lib/rig.js';
import { makeCharacter, makeSam, makeAda, CAST, inkMesh } from '../../objects/character.js';
import { makeCar, crashPath } from '../../objects/car.js';
import { TREE_STYLES } from '../../objects/tree.js';

const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const lerp3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const sstep = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const backOut = (x) => { x = clamp(x, 0, 1); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const rb = (w, h, l, r) => new RoundedBoxGeometry(w, h, l, 4, r);
const ball = (r = 1, a = 20, b = 14) => new THREE.SphereGeometry(r, a, b);

export const words = [];

// ------------------------------------------------------------------ layout & anchors
const TREE_POS = new THREE.Vector2(-4.7, -8.4);
const LANE = 1.7;
const V = 18;
const VEER = 1.15;
const PSI_H = -0.40;

const CRASH_HITS = [3.96, 10.75, 16.08, 16.65, 19.65, 27.85, 41.48, 58.85];
const CHOP_TIMES = [31.55, 32.05, 32.55];

const TOW_POS = [-7.3, -16.0];
const CHAIR_POS = [-6.6, -12.2];
const CHAIR_YAW = 0.72; // faces toward tree & road

function starShape(rOut, rIn, n) {
  const s = new THREE.Shape();
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * TAU;
    const r = i % 2 ? rIn : rOut;
    if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return s;
}

function makeLabelTex(bg, fg, title, subtitle = '', border = '#2a1442') {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 256;
  const c = cv.getContext('2d');
  c.fillStyle = bg;
  c.fillRect(0, 0, 512, 256);
  c.strokeStyle = border;
  c.lineWidth = 20;
  c.strokeRect(10, 10, 492, 236);
  c.fillStyle = fg;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = '900 106px Poppins, sans-serif';
  c.fillText(title, 256, subtitle ? 98 : 128);
  if (subtitle) {
    c.font = '800 58px Poppins, sans-serif';
    c.fillText(subtitle, 256, 186);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeUnlitPlate(w, h, tex) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex })
  );
  return m;
}

// ------------------------------------------------------------------ choppable tree + persistent stump + flashing arrow
function makeChoppableTree() {
  const st = TREE_STYLES.round;
  const group = new THREE.Group();
  group.name = 'choppableTree';

  // Persistent stump: y = 0 .. 0.72
  const stumpG = new THREE.Group();
  group.add(stumpG);
  const stumpMesh = inkMesh(new THREE.CylinderGeometry(0.22, 0.27, 0.72, 16, 1, true), st.trunk, 1);
  stumpMesh.position.y = 0.36;
  stumpG.add(stumpMesh);
  // Fresh wood top cap on stump (slightly proud so zero z-fighting)
  const stumpTop = new THREE.Mesh(
    new THREE.CircleGeometry(0.215, 16),
    toon(0xe6c18a)
  );
  stumpTop.rotation.x = -Math.PI / 2;
  stumpTop.position.y = 0.722;
  stumpG.add(stumpTop);

  // Upper trunk + canopy pivoted at y = 0.72 so it can tilt and fall cleanly
  const upperPivot = new THREE.Group();
  upperPivot.position.y = 0.72;
  group.add(upperPivot);

  const upperBody = new THREE.Group();
  upperPivot.add(upperBody);

  const upperTrunk = inkMesh(new THREE.CylinderGeometry(0.17, 0.22, 1.38, 16, 1, true), st.trunk, 1);
  upperTrunk.position.y = 0.69;
  upperBody.add(upperTrunk);

  for (const [x, y, z, r, ci] of st.blobs) {
    const b = inkMesh(ball(1, 22, 16), st.leaves[ci], 1.1);
    b.scale.setScalar(r);
    b.position.set(x, y - 0.72, z);
    upperBody.add(b);
  }

  // Giant flashing arrow attached to the upper trunk below canopy (y_world = 1.50m, completely clear of leaves!)
  const arrowGroup = new THREE.Group();
  arrowGroup.position.set(1.38, 0.78, 0.45); // mounted pointing left (-x) at the trunk, below canopyBottom
  arrowGroup.rotation.y = 0.14;
  upperBody.add(arrowGroup);

  // Wooden mounting bracket behind arrow
  const bracket = inkMesh(rb(1.2, 0.18, 0.12, 0.04), 0x8a5a33, 0.8);
  bracket.position.set(-0.6, 0, -0.09);
  arrowGroup.add(bracket);

  // Arrow shaft + head (points toward -x, right at the tree!)
  const arrowBody = inkMesh(rb(1.75, 0.55, 0.16, 0.05), 0xffd23f, 1.0);
  arrowBody.position.set(0.1, 0, 0);
  arrowGroup.add(arrowBody);

  const headGeo = new THREE.ConeGeometry(0.62, 1.0, 4);
  const arrowHead = inkMesh(headGeo, 0xffd23f, 1.0);
  arrowHead.rotation.y = Math.PI / 4;
  arrowHead.rotation.z = Math.PI / 2;
  arrowHead.scale.set(1.0, 1.0, 0.22);
  arrowHead.position.set(-0.98, 0, 0);
  arrowGroup.add(arrowHead);

  // Unlit "LOOK!" face on front of arrow
  const lookTex = makeLabelTex('#ffd23f', '#2a1442', 'LOOK!', '', '#2a1442');
  const lookPlate = makeUnlitPlate(1.45, 0.44, lookTex);
  lookPlate.position.set(0.18, 0, 0.088);
  arrowGroup.add(lookPlate);

  // Flashing bulbs along the arrow (<= 1.8 Hz so never strobing)
  const bulbs = [];
  const bulbMatOn = new THREE.MeshBasicMaterial({ color: 0xff4d2e });
  const bulbMatBright = new THREE.MeshBasicMaterial({ color: 0xfff8b8 });
  const bulbMatOff = new THREE.MeshBasicMaterial({ color: 0x7a2b1c });
  const bulbPts = [
    [-1.15, 0], [-0.82, 0.34], [-0.82, -0.34], [-0.45, 0.22], [-0.45, -0.22],
    [0.05, 0.22], [0.05, -0.22], [0.55, 0.22], [0.55, -0.22], [0.9, 0],
  ];
  for (let i = 0; i < bulbPts.length; i++) {
    const [bx, by] = bulbPts[i];
    const m = new THREE.Mesh(ball(0.085, 10, 8), bulbMatOn);
    m.position.set(bx, by, 0.11);
    arrowGroup.add(m);
    bulbs.push({ m, i });
  }

  // Lighthouse golden cone (visible during explanation 47.0..52.6)
  const beamGeo = new THREE.ConeGeometry(2.8, 12.0, 24, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffe478,
    transparent: true,
    opacity: 0.26,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.rotation.z = Math.PI / 2;
  beam.rotation.y = -0.35;
  beam.position.set(5.4, 2.2, 2.0);
  beam.visible = false;
  upperBody.add(beam);

  // Shed leaves
  const leaves = [];
  const leafMatA = toon(st.leaves[0]);
  const leafMatB = toon(st.leaves[2]);
  for (let h = 0; h < 8; h++) {
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(ball(1, 8, 6), i % 2 ? leafMatA : leafMatB);
      m.scale.set(0.13, 0.025, 0.08);
      m.visible = false;
      group.add(m);
      leaves.push({ m, h, i: i + h * 20 });
    }
  }

  // Wood chips for chopping (31.55, 32.05, 32.55)
  const chips = [];
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < 7; i++) {
      const m = inkMesh(rb(0.12, 0.05, 0.07, 0.015), 0xe6c18a, 0.7, { shadow: false });
      m.visible = false;
      group.add(m);
      chips.push({ m, t0: CHOP_TIMES[c], i: i + c * 17 });
    }
  }

  function update(t, hitTimes, pushDir) {
    // Growth from sapling (0..1.75s)
    const sc = t < 1.05 ? 0.2 : 0.2 + 0.8 * backOut((t - 1.05) / 0.7);
    group.scale.setScalar(Math.max(0.001, sc));

    // Tree chop fall state: falls between 32.60 and 35.10, stays down until 47.05 (explanation resets tree)
    // After 57.85 ("even when it's just a stump"), upper tree hides cleanly so only the stump remains!
    const fallStart = 32.60;
    const fallEnd = 34.85;
    let fallK = 0;
    let showUpper = true;
    if (t >= 57.85) {
      showUpper = false;
    } else if (t >= 47.05) {
      fallK = 0; // upright for lighthouse explanation
    } else if (t >= fallStart) {
      const u = clamp((t - fallStart) / (fallEnd - fallStart), 0, 1);
      // Gravity-like acceleration + tiny bounce on landing
      fallK = u < 0.88 ? Math.pow(u / 0.88, 2.2) : 1 - 0.04 * Math.sin(((u - 0.88) / 0.12) * Math.PI);
    }

    upperPivot.visible = showUpper;
    // Tip toward +x/-x? Tip toward -x (+z rotation tilts +y toward -x, away from the road!)
    upperPivot.rotation.z = fallK * (Math.PI / 2 - 0.08);
    // Offset slightly -x as it falls so trunk base doesn't clip through stump cap
    upperPivot.position.x = -0.22 * sstep(fallK * 1.4);

    // Impact sway (cars + chops)
    let sx = 0, sz = 0;
    for (const th of hitTimes) {
      const d = t - th;
      if (d >= 0 && d < 2.2) {
        const a = 0.085 * Math.exp(-3.5 * d) * Math.sin(TAU * 3.1 * d);
        sx += a * pushDir[1];
        sz += a * -pushDir[0];
      }
    }
    for (const tc of CHOP_TIMES) {
      const d = t - tc;
      if (d >= 0 && d < 0.45) {
        const a = 0.055 * Math.exp(-7 * d) * Math.sin(TAU * 4.5 * d);
        sz += a;
      }
    }
    upperBody.rotation.set(sx, 0, sz);

    // Giant flashing arrow visibility: 12.60..47.05 (falls with tree) and 49.75..57.85
    let arrowVis = false;
    let arrowScale = 1;
    if (t >= 12.58 && t < 47.05) {
      arrowVis = true;
      arrowScale = backOut((t - 12.58) / 0.42);
    } else if (t >= 49.75 && t < 57.85) {
      arrowVis = true;
      arrowScale = backOut((t - 49.75) / 0.35);
    }
    arrowGroup.visible = arrowVis;
    arrowGroup.scale.setScalar(Math.max(0.001, arrowScale));

    if (arrowVis) {
      // Smooth 1.8 Hz wave flash (safe below 2 Hz)
      const phase = t * 1.8;
      for (const b of bulbs) {
        const wave = Math.sin(TAU * phase - b.i * 0.55);
        b.m.material = wave > 0.35 ? bulbMatBright : wave > -0.25 ? bulbMatOn : bulbMatOff;
        b.m.scale.setScalar(wave > 0.35 ? 1.18 : 0.92);
      }
    }

    // Lighthouse beam (47.1..52.5)
    const beamVis = t >= 47.1 && t < 52.5;
    beam.visible = beamVis;
    if (beamVis) {
      beam.rotation.y = -0.35 + 0.35 * Math.sin(t * 1.4);
    }

    // Leaves falling on tree hits (only hits before tree fell or during 47.1..57.85)
    for (const L of leaves) {
      const th = hitTimes[L.h];
      const d = th === undefined ? -1 : t - th - 0.05;
      if (d < 0 || (th > 32.5 && th < 47.0) || t >= 57.85) {
        L.m.visible = false;
        continue;
      }
      const y0 = 2.2 + hash(L.i * 2.1) * 1.5;
      const ang = hash(L.i * 3.7) * TAU;
      const r0 = 0.3 + hash(L.i * 5.9) * 1.0;
      const y = Math.max(0.05, y0 - (d * 1.1 + d * d * 1.6));
      const air = y > 0.05 ? 1 : 0;
      const sway = air ? 0.5 * Math.sin(3.2 * d + L.i) : 0.5 * Math.sin(3.2 * (y0 / 2.6) + L.i);
      L.m.visible = true;
      L.m.position.set(Math.cos(ang) * (r0 + d * 0.7) + sway * 0.4, y, Math.sin(ang) * (r0 + d * 0.7));
      L.m.rotation.set(air * (3 * d + L.i), L.i, air * 2.2 * d);
    }

    // Wood chips on chop
    for (const C of chips) {
      const d = t - C.t0;
      if (d < 0 || d > 0.85) { C.m.visible = false; continue; }
      const ang = (C.i % 7) * 0.85 - 1.2;
      const sp = 1.8 + hash(C.i * 3.3) * 1.6;
      const y = Math.max(0.04, 0.75 + d * (2.6 + hash(C.i) * 1.2) - 4.8 * d * d);
      C.m.visible = true;
      C.m.position.set(0.2 + Math.cos(ang) * sp * d, y, Math.sin(ang) * sp * d);
      C.m.rotation.set(d * 8, C.i, d * 6);
    }
  }

  return { group, stumpG, upperPivot, update };
}

// ------------------------------------------------------------------ open-cab car (shows driver + hands turning wheel!)
function makeOpenCabCar({ color = 0x26324d, police = false, label = '' } = {}) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  // Floor & front/rear body sections (leaving cockpit open for driver)
  const put = (geo, c, k, x, y, z) => {
    const m = inkMesh(geo, c, k);
    m.position.set(x, y, z);
    body.add(m);
    return m;
  };
  put(rb(1.76, 0.24, 4.05, 0.08), 0x2b2838, 0.8, 0, 0.46, 0);          // lower frame/floor
  put(rb(1.8, 0.52, 1.38, 0.16), color, 0.9, 0, 0.72, 1.34);            // front engine bay
  put(rb(1.8, 0.62, 1.15, 0.2), color, 0.9, 0, 0.74, -1.46);            // rear trunk
  for (const s of [-1, 1]) {
    put(rb(0.18, 0.56, 1.56, 0.06), police ? 0xf4f1ff : color, 0.9, s * 0.81, 0.74, -0.1); // side doors
  }
  put(rb(0.8, 0.2, 0.1, 0.04), 0x2a2438, 0.4, 0, 0.62, 2.06);           // grille
  put(rb(1.9, 0.2, 0.2, 0.08), 0x3b3550, 0.6, 0, 0.42, 2.02);           // front bumper
  put(rb(1.9, 0.2, 0.2, 0.08), 0x3b3550, 0.6, 0, 0.42, -2.02);          // back bumper
  for (const s of [-1, 1]) {
    put(ball(0.15), 0xfff6b0, 0.5, s * 0.62, 0.74, 1.98);
    put(ball(0.12), 0xe63946, 0.4, s * 0.66, 0.76, -2.0);
  }

  // Seat + dash
  put(rb(1.1, 0.16, 0.55, 0.06), 0x3b3550, 0.5, 0, 0.58, -0.35);        // seat cushion
  put(rb(1.1, 0.58, 0.18, 0.06), 0x3b3550, 0.5, 0, 0.88, -0.66);        // seat back
  put(rb(1.46, 0.34, 0.36, 0.08), 0x2a2438, 0.6, 0, 0.98, 0.55);        // dashboard

  // Windshield frame (clear open glass so face & hands read 100%)
  for (const s of [-1, 1]) {
    const pillar = inkMesh(rb(0.07, 0.52, 0.07, 0.02), color, 0.7);
    pillar.position.set(s * 0.74, 1.32, 0.52);
    pillar.rotation.x = -0.32;
    body.add(pillar);
  }
  const topBar = inkMesh(rb(1.54, 0.07, 0.08, 0.02), color, 0.7);
  topBar.position.set(0, 1.54, 0.43);
  body.add(topBar);

  // Steering column + rotating steering wheel
  const col = inkMesh(new THREE.CylinderGeometry(0.035, 0.04, 0.36, 10), 0x2b2838, 0.5);
  col.rotation.x = Math.PI / 2 - 0.45;
  col.position.set(0, 0.98, 0.34);
  body.add(col);

  const wheelPivot = new THREE.Group();
  wheelPivot.position.set(0, 1.07, 0.17);
  wheelPivot.rotation.x = -0.45;
  body.add(wheelPivot);

  const rim = inkMesh(new THREE.TorusGeometry(0.17, 0.026, 8, 24), 0x221d2d, 0.8);
  wheelPivot.add(rim);
  const spokeH = inkMesh(rb(0.32, 0.032, 0.022, 0.01), 0xd9d6e6, 0.5);
  wheelPivot.add(spokeH);
  const spokeV = inkMesh(rb(0.035, 0.16, 0.022, 0.01), 0xd9d6e6, 0.5);
  spokeV.position.y = -0.08;
  wheelPivot.add(spokeV);
  // Bright yellow top-dead-center tape marker on steering wheel so rotation is unmistakably clear!
  const tape = new THREE.Mesh(rb(0.05, 0.058, 0.06, 0.01), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
  tape.position.set(0, 0.17, 0);
  wheelPivot.add(tape);

  // Hood (hinged to pop on impact)
  const hood = new THREE.Group();
  hood.position.set(0, 0.98, 0.70);
  body.add(hood);
  const hm = inkMesh(rb(1.72, 0.14, 1.32, 0.06), color, 0.9);
  hm.position.set(0, 0, 0.66);
  hood.add(hm);

  // Police rollbar + lightbar + door badge
  let redLight = null, blueLight = null;
  if (police) {
    const bar = inkMesh(rb(1.48, 0.1, 0.16, 0.04), 0x2b2838, 0.7);
    bar.position.set(0, 1.48, -0.78);
    body.add(bar);
    for (const s of [-1, 1]) {
      const post = inkMesh(rb(0.08, 0.54, 0.08, 0.02), 0x2b2838, 0.7);
      post.position.set(s * 0.71, 1.24, -0.78);
      body.add(post);
    }
    redLight = new THREE.Mesh(rb(0.42, 0.14, 0.22, 0.04), new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
    redLight.position.set(-0.34, 1.58, -0.78);
    body.add(redLight);
    blueLight = new THREE.Mesh(rb(0.42, 0.14, 0.22, 0.04), new THREE.MeshBasicMaterial({ color: 0x3a86ff }));
    blueLight.position.set(0.34, 1.58, -0.78);
    body.add(blueLight);
  }
  if (label) {
    const tex = makeLabelTex('#f4f1ff', '#1e2742', label, '', '#2a1442');
    for (const s of [-1, 1]) {
      const p = makeUnlitPlate(0.92, 0.34, tex);
      p.position.set(s * 0.905, 0.76, -0.1);
      p.rotation.y = s * Math.PI / 2;
      body.add(p);
    }
  }

  // Wheels
  const wheels = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1.3, 1.3]) {
      const w = new THREE.Group();
      w.position.set(sx * 0.9, 0.36, sz);
      group.add(w);
      const tire = inkMesh(ball(1, 20, 14), 0x2b2838, 0.9);
      tire.scale.set(0.17, 0.36, 0.36);
      w.add(tire);
      const spin = new THREE.Group();
      w.add(spin);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 16), toon(0xd9d6e6));
      hub.rotation.z = Math.PI / 2;
      hub.position.x = sx * 0.14;
      spin.add(hub);
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.06), toon(0x3b3550));
      sp.position.x = sx * 0.17;
      spin.add(sp);
      wheels.push(spin);
    }
  }

  // Driver mount inside cockpit
  const seatSocket = new THREE.Group();
  seatSocket.position.set(0, 0.38, -0.25);
  body.add(seatSocket);

  // Crash smoke puffs
  const puffs = [];
  for (let i = 0; i < 6; i++) {
    const p = inkMesh(ball(1, 14, 10), i % 2 ? 0xb9b4c9 : 0xf2f0fa, 0.6, { shadow: false });
    p.visible = false;
    body.add(p);
    puffs.push(p);
  }

  // Local grip points on steering wheel
  const gripL = new THREE.Vector3(0.155, 0.04, 0.0);
  const gripR = new THREE.Vector3(-0.155, 0.04, 0.0);

  function update(t, { x, z, yaw, dist, steer = 0, crashAt = Infinity, repairAt = Infinity }) {
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    wheels.forEach((w) => { w.rotation.x = (dist || 0) / 0.36; });
    wheelPivot.rotation.z = steer;

    const imp = (t >= crashAt && t < repairAt) ? 1 : 0;
    const dt = imp ? t - crashAt : 0;
    hood.rotation.x = imp * (-0.55 * (1 - Math.exp(-14 * dt)) + 0.07 * Math.sin(30 * dt) * Math.exp(-5 * dt));
    body.rotation.x = imp * 0.06 * Math.exp(-6 * dt) * Math.sin(22 * dt);
    body.rotation.z = imp ? 0 : clamp(-yaw * 0.1, -0.05, 0.05);
    body.position.y = imp * 0.05 * Math.exp(-8 * dt) * Math.abs(Math.sin(18 * dt));

    if (police && redLight && blueLight) {
      const flash = Math.sin(TAU * 1.9 * t) > 0;
      redLight.material.color.setHex(flash ? 0xff3b30 : 0x6b1818);
      blueLight.material.color.setHex(flash ? 0x1a3875 : 0x4da6ff);
    }

    puffs.forEach((pf, i) => {
      if (!imp || dt < 0.1) { pf.visible = false; return; }
      const ph = ((dt - 0.1) * 0.9 + i / puffs.length) % 1;
      const sc = 0.32 * Math.pow(Math.sin(Math.PI * ph), 0.7) + 0.02;
      pf.visible = sc > 0.04;
      pf.position.set(0.18 * Math.sin(i * 2.3), 1.15 + 1.4 * ph, 1.35 - 0.5 * ph);
      pf.scale.setScalar(sc);
    });

    group.updateMatrixWorld(true);
    const leftGripWorld = gripL.clone().applyMatrix4(wheelPivot.matrixWorld);
    const rightGripWorld = gripR.clone().applyMatrix4(wheelPivot.matrixWorld);
    return { leftGripWorld, rightGripWorld };
  }

  return { group, body, seatSocket, wheelPivot, update };
}

// ------------------------------------------------------------------ Tow Truck + Rack Axe
function makeTowTruck() {
  const group = new THREE.Group();
  const put = (geo, c, k, x, y, z) => {
    const m = inkMesh(geo, c, k);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };
  put(rb(2.05, 0.45, 4.9, 0.1), 0xff8c2b, 0.9, 0, 0.65, 0);          // chassis/flatbed
  put(rb(1.9, 1.15, 1.65, 0.2), 0xff8c2b, 0.9, 0, 1.25, 1.15);        // cab
  put(rb(1.94, 0.42, 1.7, 0.1), 0x23406b, 0.4, 0, 1.42, 1.15);        // windshield/windows
  put(rb(2.1, 0.22, 0.22, 0.08), 0x3b3550, 0.6, 0, 0.45, 2.48);       // front bumper
  put(rb(0.9, 0.24, 0.1, 0.04), 0xd9d6e6, 0.5, 0, 0.72, 2.45);        // grille
  for (const s of [-1, 1]) put(ball(0.15), 0xfff6b0, 0.5, s * 0.66, 0.78, 2.42);
  // Amber roof beacon
  const beacon = inkMesh(new THREE.CylinderGeometry(0.18, 0.22, 0.2, 12), 0xffd23f, 0.7);
  beacon.position.set(0, 1.94, 1.15);
  group.add(beacon);

  // Tow boom + hook at rear
  const boom = inkMesh(rb(0.24, 0.24, 2.1, 0.05), 0xd9d6e6, 0.8);
  boom.position.set(0, 1.45, -1.65);
  boom.rotation.x = -0.55;
  group.add(boom);
  const support = inkMesh(rb(0.28, 1.1, 0.28, 0.05), 0x3b3550, 0.8);
  support.position.set(0, 1.15, -0.95);
  group.add(support);
  const hook = inkMesh(new THREE.TorusGeometry(0.14, 0.045, 8, 16, Math.PI * 1.4), 0x3b3550, 0.7);
  hook.position.set(0, 1.65, -2.55);
  group.add(hook);

  // "TOW" unlit door badges
  const towTex = makeLabelTex('#fff5d6', '#2a1442', 'TOW', '', '#2a1442');
  for (const s of [-1, 1]) {
    const p = makeUnlitPlate(0.95, 0.42, towTex);
    p.position.set(s * 0.96, 1.0, 1.15);
    p.rotation.y = s * Math.PI / 2;
    group.add(p);
  }

  // Wheels
  for (const sx of [-1, 1]) {
    for (const sz of [-1.55, 1.55]) {
      const w = new THREE.Group();
      w.position.set(sx * 1.02, 0.42, sz);
      group.add(w);
      const tire = inkMesh(ball(1, 18, 12), 0x2b2838, 0.9);
      tire.scale.set(0.2, 0.42, 0.42);
      w.add(tire);
      const hub = inkMesh(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 12), 0xd9d6e6, 0.4);
      hub.rotation.z = Math.PI / 2;
      hub.position.x = sx * 0.16;
      w.add(hub);
    }
  }

  // Axe mounted on the passenger (+x) side rack (facing road/tree)
  const rackAxe = makeAxe();
  rackAxe.group.position.set(1.09, 0.95, -0.4);
  rackAxe.group.rotation.set(0.15, Math.PI / 2, Math.PI / 2);
  group.add(rackAxe.group);

  return { group, rackAxe };
}

// ------------------------------------------------------------------ Folding Lawn Chair
function makeLawnChair() {
  const group = new THREE.Group();
  const frameCol = 0xd9d6e6;
  const fabricCol = 0x3ab8d9;
  const seat = inkMesh(rb(0.58, 0.07, 0.52, 0.03), fabricCol, 0.8);
  seat.position.set(0, 0.43, 0.02);
  group.add(seat);
  const back = inkMesh(rb(0.58, 0.56, 0.07, 0.03), fabricCol, 0.8);
  back.position.set(0, 0.72, -0.23);
  back.rotation.x = -0.18;
  group.add(back);
  for (const s of [-1, 1]) {
    const arm = inkMesh(rb(0.07, 0.05, 0.52, 0.02), frameCol, 0.7);
    arm.position.set(s * 0.31, 0.62, 0);
    group.add(arm);
    for (const sz of [-0.21, 0.21]) {
      const leg = inkMesh(new THREE.CylinderGeometry(0.02, 0.02, 0.44, 8), frameCol, 0.6);
      leg.position.set(s * 0.27, 0.22, sz);
      group.add(leg);
    }
  }
  return { group };
}

// ------------------------------------------------------------------ Cartoon Axe (compatible with character.carry)
function makeAxe() {
  const L = 0.95;
  const group = new THREE.Group();
  const shaft = inkMesh(new THREE.CylinderGeometry(0.024, 0.028, L, 12), 0xb9854a, 0.8);
  shaft.position.y = L / 2;
  group.add(shaft);
  const head = inkMesh(rb(0.28, 0.2, 0.07, 0.025), 0xb8c7d9, 0.9);
  head.position.set(0.08, L - 0.1, 0);
  group.add(head);
  const edge = inkMesh(rb(0.06, 0.22, 0.03, 0.01), 0xf4f1ff, 0.8);
  edge.position.set(0.21, L - 0.1, 0);
  group.add(edge);
  return {
    group,
    grips: { A: new THREE.Vector3(0, L * 0.56, 0), B: new THREE.Vector3(0, L * 0.22, 0) },
  };
}

// ------------------------------------------------------------------ Cash Fan Prop
function makeCashFan() {
  const g = new THREE.Group();
  for (let i = -1; i <= 1; i++) {
    const bill = inkMesh(rb(0.16, 0.015, 0.09, 0.005), 0x48c768, 0.7, { shadow: false });
    bill.position.set(i * 0.03, i * 0.006, 0);
    bill.rotation.y = i * 0.32;
    g.add(bill);
  }
  const tex = makeLabelTex('#48c768', '#1a4222', '$$$', '', '#1a4222');
  const plate = makeUnlitPlate(0.14, 0.07, tex);
  plate.rotation.x = -Math.PI / 2;
  plate.position.set(0, 0.015, 0);
  g.add(plate);
  return g;
}

// ------------------------------------------------------------------ Sheriff Hat + Tow Guy Cap
function makeSheriffHat() {
  const g = new THREE.Group();
  const brim = inkMesh(new THREE.CylinderGeometry(0.24, 0.25, 0.028, 20), 0x6e5438, 0.8);
  g.add(brim);
  const crown = inkMesh(new THREE.CylinderGeometry(0.135, 0.155, 0.14, 18), 0x6e5438, 0.8);
  crown.position.y = 0.075;
  g.add(crown);
  const band = inkMesh(new THREE.CylinderGeometry(0.158, 0.158, 0.032, 18), 0xffd23f, 0.4);
  band.position.y = 0.025;
  g.add(band);
  g.position.set(0, -0.035, 0.025);
  return g;
}

function makeTruckerCap() {
  const g = new THREE.Group();
  const dome = inkMesh(new THREE.SphereGeometry(0.165, 18, 12, 0, TAU, 0, Math.PI / 2), 0xe8452c, 0.8);
  dome.scale.set(1.02, 0.86, 1.14);
  g.add(dome);
  const visor = inkMesh(rb(0.24, 0.024, 0.18, 0.01), 0xf4f1ff, 0.7);
  visor.position.set(0, -0.005, 0.16);
  g.add(visor);
  g.position.set(0, -0.04, 0.035);
  return g;
}

// ------------------------------------------------------------------ Build Scene
export function build(ctx) {
  const scene = new THREE.Scene();
  const skyColor = new THREE.Color(0x86d0f4);
  scene.background = skyColor;

  const hemi = new THREE.HemisphereLight(0xdff1ff, 0x4c8a3c, 0.95);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff0d0, 2.4);
  const sunTarget = new THREE.Object3D();
  sunTarget.position.set(-3, 0, -8);
  scene.add(sunTarget);
  sun.position.set(4, 11, 2);
  sun.target = sunTarget;
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 45 });
  sun.shadow.bias = -0.0012;
  sun.shadow.normalBias = 0.05;
  scene.add(sun);

  // Ground + straight endless road
  const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 48), toon(0x58b447));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const flat = (w, l, c, x, y, z) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), toon(c));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  flat(7.4, 700, 0x57516f, 0, 0.03, -290);
  flat(0.16, 700, 0xf4f1ff, -3.15, 0.06, -290);
  flat(0.16, 700, 0xf4f1ff, 3.15, 0.06, -290);
  for (let i = 0; i < 90; i++) flat(0.16, 2.6, 0xffd23f, 0, 0.06, 20 - i * 7);

  // Tiny grass tufts & flowers (well outside road and tree area)
  for (let i = 0; i < 95; i++) {
    const side = hash(i * 3.1) > 0.5 ? 1 : -1;
    const x = side * (4.6 + hash(i * 1.7) * 14);
    const z = 12 - hash(i * 5.3) * 60;
    if (Math.hypot(x - TREE_POS.x, z - TREE_POS.y) < 1.5) continue;
    if (Math.hypot(x - CHAIR_POS[0], z - CHAIR_POS[1]) < 1.5) continue;
    if (Math.hypot(x - TOW_POS[0], z - TOW_POS[1]) < 3.0) continue;
    const m = new THREE.Mesh(ball(1, 8, 6), toon(hash(i * 9.9) > 0.8 ? 0xffe066 : 0x3d9a38));
    m.scale.set(0.16, 0.1, 0.16);
    m.position.set(x, 0.05, z);
    scene.add(m);
  }

  // Far horizon hills & clouds
  const hillCol = [0x5fbf72, 0x66c27f, 0x56b46a];
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(ball(1, 20, 12), toon(hillCol[i % 3]));
    m.scale.set(75 + hash(i) * 70, 15 + hash(i + 7) * 22, 42);
    m.position.set(-420 + i * 105, 0, -480 - hash(i + 3) * 40);
    scene.add(m);
  }
  for (const [x, y, z, s] of [[-70, 70, -340, 1], [90, 92, -400, 1.3], [-190, 62, -450, 1.1], [20, 112, -480, 1.5], [200, 80, -360, 1.1]]) {
    for (const [dx, dy, r] of [[0, 0, 14], [14, -3, 10], [-14, -3, 10], [6, 6, 9]]) {
      const m = new THREE.Mesh(ball(1, 14, 10), toon(0xffffff));
      m.scale.set(r * s, r * s * 0.7, r * s * 0.7);
      m.position.set(x + dx * s, y + dy * s, z);
      scene.add(m);
    }
  }

  // Target Fixation bullseye rings on ground around the stump (visible 43.8..47.1)
  const bullseye = new THREE.Group();
  bullseye.position.set(TREE_POS.x, 0.04, TREE_POS.y);
  for (const [r0, r1, col] of [[0.75, 1.15, 0xe63946], [1.15, 1.55, 0xf4f1ff], [1.55, 1.95, 0xe63946]]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 32), new THREE.MeshBasicMaterial({ color: col }));
    ring.rotation.x = -Math.PI / 2;
    bullseye.add(ring);
  }
  bullseye.visible = false;
  scene.add(bullseye);

  // Target Fixation signpost beside stump (43.7..47.0), sized to stay whole inside 9:16 frame
  const targetSign = new THREE.Group();
  targetSign.position.set(-2.95, 0, -7.8);
  targetSign.rotation.y = 0.22;
  const post = inkMesh(new THREE.CylinderGeometry(0.055, 0.065, 1.45, 10), 0x8a5a33, 0.7);
  post.position.y = 0.72;
  targetSign.add(post);
  const board = inkMesh(rb(1.36, 0.72, 0.1, 0.03), 0xffd23f, 0.9);
  board.position.y = 1.48;
  targetSign.add(board);
  const tfTex = makeLabelTex('#ffd23f', '#2a1442', 'TARGET', 'FIXATION', '#2a1442');
  const tfPlate = makeUnlitPlate(1.26, 0.64, tfTex);
  tfPlate.position.set(0, 1.48, 0.056);
  targetSign.add(tfPlate);
  targetSign.visible = false;
  scene.add(targetSign);

  // ------------------------------------------------------------------ Tree
  const tree = makeChoppableTree();
  tree.group.position.set(TREE_POS.x, 0, TREE_POS.y);
  scene.add(tree.group);

  // ------------------------------------------------------------------ Regular crashing cars
  const redCP = crashPath({ target: [TREE_POS.x, TREE_POS.y], hit: 3.96, lane: LANE, speed: V, veer: VEER, heading: PSI_H });
  const yellowCP = crashPath({ target: [TREE_POS.x, TREE_POS.y], hit: 10.75, lane: LANE, speed: V, veer: VEER, heading: PSI_H });
  const blueCP = crashPath({ target: [TREE_POS.x, TREE_POS.y], hit: 16.08, lane: LANE, speed: V, veer: VEER, heading: -0.38 });
  const greenCP = crashPath({ target: [TREE_POS.x, TREE_POS.y], hit: 16.65, lane: LANE, speed: V, veer: 1.0, heading: -0.18 });
  const orangeCP = crashPath({ target: [TREE_POS.x, TREE_POS.y], hit: 19.65, lane: LANE, speed: V, veer: VEER, heading: PSI_H });

  const carConfigs = [
    { color: 'red', cp: redCP, hit: 3.96, t0: 0, t1: 7.5 },
    { color: 'yellow', cp: yellowCP, hit: 10.75, t0: 8.5, t1: 14.0 },
    { color: 'blue', cp: blueCP, hit: 16.08, t0: 14.5, t1: 19.0 },
    { color: 'green', cp: greenCP, hit: 16.65, t0: 15.0, t1: 19.4 },
    { color: 'orange', cp: orangeCP, hit: 19.65, t0: 17.8, t1: 22.0 },
  ];
  const regCars = carConfigs.map((cfg) => {
    const c = makeCar({ color: cfg.color });
    c.path(cfg.cp.path).crash(cfg.hit);
    scene.add(c.group);
    return { c, ...cfg };
  });

  const P_HIT = new THREE.Vector2(...redCP.contact);

  // ------------------------------------------------------------------ Sheriff Cruiser (Open-cab so we see Sheriff + hands on wheel!)
  const sheriffCar = makeOpenCabCar({ color: 0x26324d, police: true, label: 'SHERIFF' });
  scene.add(sheriffCar.group);

  // Sheriff character (cloned from sam family with navy sheriff uniform + hat)
  const sheriff = makeCharacter({
    name: 'sheriff',
    look: {
      skin: '#d9a47a',
      hair: { style: 'swoop', color: '#3d2a22' },
      face: { eyeColor: '#485a38', eyeRX: 0.14, eyeRY: 0.175, irisR: 0.1, browThick: 1.6, browLen: 1.1, mouthW: 0.25, seed: 17 },
      outfit: { style: 'jacket', top: '#2b3a5c', inner: '#d9d6cf', bottom: '#232c44', shoes: '#221d2d', sole: '#3b3550', trim: '#ffd23f' },
    },
  });
  sheriff.attach(makeSheriffHat(), 'Head');
  scene.add(sheriff.group);

  // Sheriff's hand axe (carried cleanly; visible only 30.65..35.6)
  const handAxe = makeAxe();
  sheriff.carry(handAxe.group, handAxe.grips.A, handAxe.grips.B);

  // ------------------------------------------------------------------ Ada's Open-cab Coupe (for Target Fixation ending 51.7..59.95)
  const adaCar = makeOpenCabCar({ color: 0x3a86ff, police: false });
  scene.add(adaCar.group);
  const ada = makeAda();
  scene.add(ada.group);

  // Glowing sightline dots from Ada's eyes to tree (52.5..57.6)
  const sightDots = [];
  for (let i = 0; i < 8; i++) {
    const dot = new THREE.Mesh(ball(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
    dot.visible = false;
    scene.add(dot);
    sightDots.push(dot);
  }

  // ------------------------------------------------------------------ Sam (plants tree 0..2.4)
  const sam = makeSam();
  sam.expression('happy');
  scene.add(sam.group);
  const SAM0 = new THREE.Vector2(TREE_POS.x - 0.28, TREE_POS.y - 0.28);
  const vRun = sam.speed('run');

  // ------------------------------------------------------------------ Tow Truck, Lawn Chair, Tow Truck Guy
  const towTruck = makeTowTruck();
  towTruck.group.position.set(TOW_POS[0], 0, TOW_POS[1]);
  towTruck.group.rotation.y = 0.42;
  scene.add(towTruck.group);

  const chair = makeLawnChair();
  chair.group.position.set(CHAIR_POS[0], 0, CHAIR_POS[1]);
  chair.group.rotation.y = CHAIR_YAW;
  scene.add(chair.group);

  const towGuy = makeCharacter({
    name: 'towGuy',
    height: 1.62,
    build: { torsoWidth: 1.12, torsoHeight: 0.86, headScale: 1.02, limb: 1.1 },
    look: {
      skin: '#e0a97f',
      hair: { style: 'swoop', color: '#6b4730' },
      face: { eyeColor: '#4e3c2e', eyeRX: 0.145, eyeRY: 0.175, irisR: 0.1, browThick: 1.4, mouthW: 0.26, seed: 23 },
      outfit: { style: 'jacket', top: '#e86a2c', inner: '#f4f1ff', bottom: '#324a7a', shoes: '#543528', sole: '#d8c9a0', trim: '#ffd23f' },
    },
  });
  towGuy.attach(makeTruckerCap(), 'Head');
  scene.add(towGuy.group);

  const cashFan = makeCashFan();
  towGuy.attach(cashFan, 'HandR');

  // ------------------------------------------------------------------ Impact Dust + Comic Star
  const dust = [];
  CRASH_HITS.forEach((th, hi) => {
    for (let i = 0; i < 7; i++) {
      const m = inkMesh(ball(1, 14, 10), i % 2 ? 0xeeeaf6 : 0xd9d3e6, 0.7, { shadow: false });
      m.visible = false;
      scene.add(m);
      dust.push({ m, th, i: i + hi * 20 });
    }
  });

  const starG = new THREE.Group();
  scene.add(starG);
  const starBack = new THREE.Mesh(new THREE.ShapeGeometry(starShape(1.0, 0.55, 9)), new THREE.MeshBasicMaterial({ color: 0x2a1442 }));
  starBack.scale.setScalar(1.14);
  starBack.position.z = -0.01;
  starG.add(starBack);
  starG.add(new THREE.Mesh(new THREE.ShapeGeometry(starShape(1.0, 0.55, 9)), new THREE.MeshBasicMaterial({ color: 0xffd23f })));
  const starIn = new THREE.Mesh(new THREE.ShapeGeometry(starShape(0.55, 0.3, 9)), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  starIn.position.z = 0.01;
  starIn.rotation.z = 0.2;
  starG.add(starIn);
  starG.visible = false;

  // ------------------------------------------------------------------ Motion helpers for Sheriff & Ada cars
  // Sheriff 1st drive (21.8..28.6): drives slowly at 6.7 m/s (~15 mph), then veers into tree at 27.85
  const s1CP = crashPath({ target: [TREE_POS.x, TREE_POS.y], hit: 27.85, lane: LANE, speed: 6.7, veer: 1.5, heading: -0.45 });
  // Sheriff 2nd drive (35.6..42.0): cruiser fixed, drives out along empty road, plows straight into stump at 41.48!
  const s2CP = crashPath({ target: [TREE_POS.x, TREE_POS.y], hit: 41.48, lane: LANE, speed: 9.5, veer: 1.15, heading: -0.42 });

  function sheriffCarPose(t) {
    if (t < 35.6) {
      // Hold at impact pose while sheriff gets out & chops tree (27.85..35.6)
      const tt = Math.min(t, 28.45);
      const p = s1CP.path(tt);
      const steer = t >= 26.2 && t <= 27.9 ? lerp(0, 0.58, sstep((t - 26.2) / 1.4)) : 0;
      return { ...p, steer, crashAt: 27.85, repairAt: 35.6 };
    }
    const tt = Math.min(t, 42.1);
    const p = s2CP.path(tt);
    const steer = t >= 40.3 && t <= 41.5 ? lerp(0, 0.55, sstep((t - 40.3) / 0.9)) : 0;
    return { ...p, steer, crashAt: 41.48, repairAt: Infinity };
  }

  // Ada's car (51.2..60.0): drives steadily at 9.5 m/s, wheel slowly turns 55.6..57.8, plows into stump at 58.85!
  const adaCP = crashPath({ target: [TREE_POS.x, TREE_POS.y], hit: 58.85, lane: LANE, speed: 9.5, veer: 1.65, heading: -0.42 });
  function adaCarPose(t) {
    const p = adaCP.path(t);
    const steer = t >= 55.6 ? lerp(0, 0.78, sstep((t - 55.6) / 2.1)) : 0;
    return { ...p, steer, crashAt: 58.85, repairAt: Infinity };
  }

  // ------------------------------------------------------------------ Camera Beats (9:16 moving rig, 16:9 calm cuts)
  const cam = new THREE.PerspectiveCamera(60, ctx.w / ctx.h, 0.25, 1200);
  const WIDE = { pos: [-1.0, 1.4, 2.0], look: [-2.5, 1.0, -14], fov: 62 };
  const PUSH = { pos: [-2.0, 1.2, -1.5], look: [-4.2, 1.0, -10.3], fov: 52 };

  const beats = [
    // Act 1 (0..11.8): plant -> empty road -> 1st crash -> straight road -> 2nd crash
    { pos: [0.2, 1.7, -3.2], look: [-4.5, 1.6, -8.2], fov: 56 },
    { at: 1.65, dur: 0.75, pos: [-0.6, 1.1, -3.5], look: [0.4, 0.9, -60], fov: 60, roll: 0.02 },
    { at: 2.45, dur: 0.75, ...WIDE, roll: -0.02 },
    { at: 3.15, dur: 0.70, ...PUSH, roll: 0.03 },
    { at: 4.25, dur: 0.90, pos: [-0.6, 9.0, 14.5], look: [0.0, 0.0, -90], fov: 58, roll: 0 },
    { at: 6.40, dur: 0.85, pos: [3.8, 1.7, -2.5], look: [-4.7, 2.0, -8.4], fov: 50, roll: -0.02 },
    { at: 7.90, dur: 0.85, pos: [-0.2, 1.5, -4.2], look: [-4.7, 2.0, -8.4], fov: 46, roll: 0.02 },
    { at: 9.25, dur: 0.75, ...WIDE, roll: -0.02 },
    { at: 10.00, dur: 0.70, ...PUSH, roll: 0.03 },
    { at: 11.05, dur: 0.75, pos: [-0.5, 2.1, -0.4], look: [-4.2, 1.3, -9.5], fov: 54, roll: -0.03 },

    // Act 2 (11.88..21.8): Giant flashing arrow -> double crash -> tow truck guy & cash
    { at: 12.15, dur: 0.80, pos: [-1.4, 1.65, -3.2], look: [-3.9, 1.55, -8.4], fov: 56, roll: 0.02 },
    { at: 13.40, dur: 0.75, pos: [-2.4, 1.65, -4.4], look: [-3.7, 1.52, -8.4], fov: 46, roll: -0.03 },
    { at: 14.65, dur: 0.75, pos: [1.5, 1.7, -1.5], look: [-4.0, 1.65, -8.4], fov: 56, roll: 0.02 },
    { at: 15.75, dur: 0.65, pos: [-0.8, 1.6, 1.5], look: [-3.5, 1.3, -10.5], fov: 62, roll: -0.03 },
    { at: 16.35, dur: 0.55, pos: [-1.8, 1.4, -2.0], look: [-4.4, 1.3, -9.5], fov: 52, roll: 0.04 },
    { at: 17.25, dur: 0.85, pos: [-3.2, 1.7, -10.8], look: [-6.6, 1.1, -12.6], fov: 54, roll: -0.02 },
    { at: 18.60, dur: 0.80, pos: [-4.5, 1.35, -9.4], look: [-6.6, 1.05, -12.2], fov: 48, roll: 0.03 },
    { at: 20.00, dur: 0.75, pos: [-5.1, 1.35, -10.0], look: [-6.6, 1.15, -12.2], fov: 42, roll: -0.02 },

    // Act 3 (21.85..35.6): Sheriff approaches -> 15 mph both hands -> slams -> climbs out -> axe -> chops down -> tow guy despairs
    { at: 21.85, dur: 0.85, pos: [2.8, 1.6, -34.0], look: [1.6, 1.0, -45.0], fov: 56, roll: 0.02 },
    { at: 23.10, dur: 0.80, pos: [-0.4, 1.5, -28.0], look: [1.5, 1.0, -37.0], fov: 52, roll: -0.02 },
    { at: 24.40, dur: 0.70, pos: [0.3, 1.45, -24.0], look: [1.7, 1.05, -29.0], fov: 48, roll: 0.02 },
    { at: 25.80, dur: 0.70, pos: [0.5, 1.5, -18.0], look: [1.5, 1.1, -21.0], fov: 44, roll: -0.02 },
    { at: 27.15, dur: 0.65, pos: [-2.0, 1.3, -2.5], look: [-4.2, 1.1, -10.3], fov: 54, roll: 0.03 },
    { at: 27.90, dur: 0.50, pos: [-2.4, 1.25, -5.2], look: [-4.2, 1.1, -10.3], fov: 48, roll: -0.04 },
    { at: 28.65, dur: 0.65, pos: [-0.8, 1.9, -6.2], look: [-2.8, 1.2, -9.8], fov: 52, roll: 0.02 },
    { at: 30.00, dur: 0.70, pos: [-2.2, 2.3, -13.6], look: [-6.2, 1.2, -16.0], fov: 54, roll: -0.02 },
    { at: 31.20, dur: 0.65, pos: [-1.4, 1.55, -5.2], look: [-4.3, 1.2, -8.4], fov: 48, roll: 0.03 },
    { at: 32.10, dur: 0.65, pos: [-2.2, 1.9, -4.4], look: [-4.7, 1.7, -8.4], fov: 54, roll: -0.02 },
    { at: 32.90, dur: 0.65, pos: [-7.8, 1.7, -9.4], look: [-6.6, 1.15, -12.2], fov: 50, roll: 0.02 },
    { at: 34.35, dur: 0.75, pos: [-1.4, 2.3, -2.0], look: [-5.4, 0.9, -9.2], fov: 58, roll: -0.03 },

    // Act 4 (35.6..42.0): Cruiser fixed -> drives back out -> plows straight into stump
    { at: 35.45, dur: 0.65, pos: [-0.8, 1.5, -42.0], look: [1.5, 1.0, -60.0], fov: 44, roll: 0.02 },
    { at: 37.15, dur: 0.80, pos: [3.0, 1.55, -34.0], look: [1.5, 1.0, -45.0], fov: 52, roll: -0.02 },
    { at: 38.75, dur: 0.75, pos: [-0.6, 1.5, -20.0], look: [1.4, 1.05, -30.0], fov: 52, roll: 0.02 },
    { at: 40.30, dur: 0.65, pos: [-1.4, 1.35, -2.2], look: [-3.8, 0.8, -9.0], fov: 56, roll: -0.03 },
    { at: 41.15, dur: 0.50, pos: [-2.4, 1.1, -5.2], look: [-4.4, 0.65, -8.6], fov: 48, roll: 0.04 },

    // Act 5 (42.0..60.0): Target fixation -> lighthouse -> flashing arrow -> driver eyes + hands -> stump crash
    { at: 42.10, dur: 0.85, pos: [-1.2, 3.2, -1.5], look: [-4.2, 0.8, -8.4], fov: 58, roll: -0.02 },
    { at: 43.75, dur: 0.85, pos: [-2.4, 1.9, -2.2], look: [-3.8, 1.2, -8.1], fov: 58, roll: 0.02 },
    { at: 45.65, dur: 0.85, pos: [0.0, 5.5, 8.0], look: [-1.5, 1.2, -55], fov: 62, roll: 0 },
    { at: 47.20, dur: 0.85, pos: [1.5, 1.4, -22.0], look: [-4.7, 2.2, -8.4], fov: 50, roll: -0.02 },
    { at: 49.40, dur: 0.80, pos: [-2.0, 1.7, -3.6], look: [-3.8, 1.6, -8.4], fov: 48, roll: 0.03 },
    { at: 51.80, dur: 0.80, pos: [0.2, 1.6, -40.0], look: [1.7, 1.2, -46.0], fov: 46, roll: -0.02 },
    { at: 53.20, dur: 0.80, pos: [0.2, 1.5, -30.0], look: [1.7, 1.2, -36.0], fov: 42, roll: 0.02 },
    { at: 54.80, dur: 0.80, pos: [0.8, 1.4, -22.0], look: [1.7, 1.0, -25.0], fov: 44, roll: -0.02 },
    { at: 56.20, dur: 0.85, pos: [0.2, 1.35, -14.0], look: [1.4, 0.95, -17.0], fov: 42, roll: 0.03 },
    { at: 57.85, dur: 0.70, pos: [-1.8, 1.4, -3.2], look: [-4.4, 0.75, -8.5], fov: 56, roll: -0.03 },
    { at: 58.80, dur: 0.45, pos: [-1.8, 1.45, -3.6], look: [-4.4, 0.75, -8.5], fov: 54, roll: 0.02 },
  ];

  const rig = ctx.landscape
    ? makeRig(calm(beats), { drift: 0, arc: 0, fps: ctx.fps })
    : makeRig(beats, { drift: 0.035, arc: 0.02, fps: ctx.fps });

  const shake = (t) => {
    let sx = 0, sy = 0, sr = 0;
    for (const th of CRASH_HITS) {
      const d = t - th;
      if (d >= 0 && d < 0.6) {
        const a = Math.exp(-8 * d);
        sx += 0.07 * a * Math.sin(d * 96);
        sy += 0.06 * a * Math.cos(d * 83);
        sr += 0.012 * a * Math.sin(d * 70);
      }
    }
    return [sx, sy, sr];
  };

  return {
    scene,
    camera: cam,
    update(t) {
      // --- Mood lighting per act (bright day -> golden lighthouse explanation -> bright payoff)
      const lightGold = sstep((t - 45.6) / 0.8) * (1 - sstep((t - 57.5) / 0.6));
      skyColor.setRGB(
        lerp(0.525, 0.44, lightGold),
        lerp(0.816, 0.68, lightGold),
        lerp(0.957, 0.88, lightGold)
      );
      sun.color.setRGB(1.0, lerp(0.941, 0.84, lightGold), lerp(0.816, 0.56, lightGold));

      // --- Sam (0..3.5s)
      const samVis = t < 3.5;
      sam.group.visible = samVis;
      if (samVis) {
        const plantW = sstep((t - 0.05) / 0.2) * (1 - sstep((t - 1.0) / 0.3));
        const runW = sstep((t - 1.15) / 0.25);
        const s = (t - 1.2) / 0.35;
        const runDist = t < 1.2 ? 0 : s < 1 ? vRun * 0.35 * (s * s * s - s * s * s * s / 2) : vRun * 0.35 * 0.5 + vRun * (t - 1.55);
        sam.group.position.set(SAM0.x - runDist, 0, SAM0.y);
        sam.group.rotation.y = lerp(0.785, -Math.PI / 2, sstep((t - 1.15) / 0.3));
        sam.act({ plant: plantW, run: runW }, t);
      }

      // --- Regular crashing cars
      for (const rc of regCars) {
        rc.c.group.visible = t >= rc.t0 && t < rc.t1;
        if (rc.c.group.visible) rc.c.update(t);
      }

      // --- Tow Truck & Lawn Chair & Tow Guy (17.0..43.0)
      const towVis = t >= 17.0 && t < 43.0;
      towTruck.group.visible = towVis;
      chair.group.visible = towVis;
      towGuy.group.visible = towVis;
      towTruck.rackAxe.group.visible = !(t >= 30.65 && t < 35.6);

      if (towVis) {
        // Tow truck drives slightly into park spot 17.0..17.9
        const parkK = sstep((t - 17.0) / 0.9);
        towTruck.group.position.set(lerp(TOW_POS[0] - 4.0, TOW_POS[0], parkK), 0, lerp(TOW_POS[1] - 6.0, TOW_POS[1], parkK));

        const standUp = sstep((t - 32.75) / 0.45);
        towGuy.group.position.set(CHAIR_POS[0], 0, CHAIR_POS[1] + 0.1 * standUp);
        towGuy.group.rotation.y = CHAIR_YAW;

        cashFan.visible = t >= 18.0 && t < 32.9;

        if (t < 32.75) {
          towGuy.expression('happy');
          towGuy.lookAt([TREE_POS.x, 1.6, TREE_POS.y]);
          towGuy.act({ sit: { w: 1, seat: 0.45 }, wave: t > 19.8 && t < 21.6 ? 0.65 : 0 }, t);
        } else if (t < 34.0) {
          towGuy.expression('shocked');
          towGuy.lookAt([TREE_POS.x, 1.8, TREE_POS.y]);
          towGuy.act({ sit: { w: 1 - standUp, seat: 0.45 }, react: { w: standUp, t0: 32.75 } }, t);
        } else {
          towGuy.expression('sad');
          towGuy.lookAt([TREE_POS.x - 1.2, 0.6, TREE_POS.y]);
          towGuy.act({ idle: 1 }, t);
        }
      }

      // --- Sheriff & Police Cruiser (21.5..46.0)
      const sheriffVis = t >= 21.5 && t < 46.5;
      sheriffCar.group.visible = sheriffVis;
      sheriff.group.visible = sheriffVis;
      handAxe.group.visible = t >= 30.65 && t < 35.6;

      if (sheriffVis) {
        const sPose = sheriffCarPose(t);
        const sGrips = sheriffCar.update(t, sPose);

        // Is sheriff driving (inside car) or outside chopping tree (28.70..35.60)?
        const inCar = t < 28.70 || t >= 35.60;
        if (inCar) {
          sheriffCar.seatSocket.updateMatrixWorld(true);
          const seatWorld = new THREE.Vector3();
          sheriffCar.seatSocket.getWorldPosition(seatWorld);
          sheriff.group.position.copy(seatWorld);
          sheriff.group.rotation.set(0, sPose.yaw, 0);
          sheriff.reach('L', sGrips.leftGripWorld, 1);
          sheriff.reach('R', sGrips.rightGripWorld, 1);

          if (t < 27.85) {
            sheriff.expression('worried');
            sheriff.lookAt([TREE_POS.x, 1.5, TREE_POS.y]);
          } else if (t < 28.70) {
            sheriff.expression('shocked');
            sheriff.lookAt(null);
          } else if (t < 41.48) {
            sheriff.expression('happy');
            sheriff.lookAt([TREE_POS.x, 0.5, TREE_POS.y]);
          } else {
            sheriff.expression('shocked');
            sheriff.lookAt(null);
          }
          sheriff.act({ sit: { w: 1, seat: 0.1 } }, t);
        } else {
          // Sheriff climbs out (28.7..35.6): clear steering IK
          sheriff.reach('L', null);
          sheriff.reach('R', null);
          sheriff.expression('angry');

          const P_EXIT = [-2.5, -9.8];
          const P_MID = [-2.2, -13.2];
          const P_RACK = [-5.4, -16.0];
          const P_CHOP = [-3.9, -8.4];

          if (t < 29.7) {
            // Furious beside wrecked cruiser
            sheriff.group.position.set(P_EXIT[0], 0, P_EXIT[1]);
            sheriff.group.rotation.y = -0.3;
            sheriff.lookAt([TREE_POS.x, 1.5, TREE_POS.y]);
            sheriff.act({ react: { w: 1, t0: 28.7 } }, t);
          } else if (t < 30.65) {
            // Walk around cruiser to tow truck rack
            const u = clamp((t - 29.7) / 0.95, 0, 1);
            const A = u < 0.45 ? P_EXIT : P_MID;
            const B = u < 0.45 ? P_MID : P_RACK;
            const k = sstep(u < 0.45 ? u / 0.45 : (u - 0.45) / 0.55);
            sheriff.group.position.set(lerp(A[0], B[0], k), 0, lerp(A[1], B[1], k));
            sheriff.group.rotation.y = Math.atan2(B[0] - A[0], B[1] - A[1]);
            sheriff.lookAt([TOW_POS[0], 1.2, TOW_POS[1]]);
            sheriff.act({ run: 0.7, walk: 0.3 }, t);
          } else if (t < 31.35) {
            // Grab axe and march back around cruiser to tree
            const u = clamp((t - 30.65) / 0.70, 0, 1);
            const A = u < 0.48 ? P_RACK : P_MID;
            const B = u < 0.48 ? P_MID : P_CHOP;
            const k = sstep(u < 0.48 ? u / 0.48 : (u - 0.48) / 0.52);
            sheriff.group.position.set(lerp(A[0], B[0], k), 0, lerp(A[1], B[1], k));
            sheriff.group.rotation.y = Math.atan2(B[0] - A[0], B[1] - A[1]);
            sheriff.lookAt([TREE_POS.x, 1.0, TREE_POS.y]);
            sheriff.act({ run: 0.7, walk: 0.3, hold: { w: 1, at: [0, 0.9, 0.35], rx: -0.35, rz: 0.2 } }, t);
          } else {
            // Chop at the trunk (vigorous swings on chop hits!)
            sheriff.group.position.set(P_CHOP[0], 0, P_CHOP[1]);
            sheriff.group.rotation.y = -Math.PI / 2;
            sheriff.lookAt([TREE_POS.x, 0.9, TREE_POS.y]);
            const swing = Math.sin((t - 31.35) * TAU * 2.0);
            const chopW = t < 32.8 ? 1 : 0;
            sheriff.act({
              hold: { w: 1, at: [0.1 * swing, 0.85, 0.38], rx: -0.3 - 0.45 * swing, yaw: 0.4 * swing, rz: 0.75 * chopW },
            }, t);
          }
        }
      }

      // --- Ada & Open-cab Coupe (51.2..60.0)
      const adaVis = t >= 51.2;
      adaCar.group.visible = adaVis;
      ada.group.visible = adaVis;
      if (adaVis) {
        const aPose = adaCarPose(t);
        const aGrips = adaCar.update(t, aPose);
        adaCar.seatSocket.updateMatrixWorld(true);
        const seatWorld = new THREE.Vector3();
        adaCar.seatSocket.getWorldPosition(seatWorld);
        ada.group.position.copy(seatWorld);
        ada.group.rotation.set(0, aPose.yaw, 0);
        ada.reach('L', aGrips.leftGripWorld, 1);
        ada.reach('R', aGrips.rightGripWorld, 1);
        ada.expression(t >= 58.85 ? 'shocked' : 'worried');
        ada.lookAt([TREE_POS.x, t < 57.85 ? 2.2 : 0.65, TREE_POS.y]);
        ada.act({ sit: { w: 1, seat: 0.1 } }, t);

        // Sightline dots from Ada's head to the tree
        const showDots = t >= 52.3 && t < 57.7;
        for (let i = 0; i < sightDots.length; i++) {
          sightDots[i].visible = showDots;
          if (showDots) {
            const u = ((i + (t * 1.4) % 1) / sightDots.length);
            sightDots[i].position.set(
              lerp(seatWorld.x, TREE_POS.x, u),
              lerp(seatWorld.y + 0.85, 2.0, u),
              lerp(seatWorld.z, TREE_POS.y, u)
            );
          }
        }
      } else {
        ada.reach('L', null);
        ada.reach('R', null);
        for (const d of sightDots) d.visible = false;
      }

      // --- Target Fixation signpost + bullseye
      const showTF = t >= 43.7 && t < 47.0;
      bullseye.visible = showTF;
      targetSign.visible = showTF;
      if (showTF) {
        const s = backOut((t - 43.7) / 0.35);
        targetSign.scale.setScalar(Math.max(0.001, s));
      }

      // --- Update tree
      tree.update(t, CRASH_HITS, redCP.dir);

      // --- Dust bursts on crashes
      for (const D of dust) {
        const d = t - D.th;
        if (d < 0 || d > 0.9) { D.m.visible = false; continue; }
        const ang = (D.i % 20) / 7 * TAU + 0.4;
        const sp = 1.6 + hash(D.i * 4.1) * 1.8;
        const q = 1 - Math.exp(-4.5 * d);
        const sc = 0.1 + 0.3 * Math.sin(Math.PI * clamp(d / 0.9, 0, 1)) * (0.7 + hash(D.i) * 0.5);
        D.m.visible = true;
        D.m.position.set(
          P_HIT.x + Math.cos(ang) * sp * q * 0.55,
          0.35 + 0.8 * q - 0.7 * d * d,
          P_HIT.y + Math.sin(ang) * sp * q * 0.55
        );
        D.m.scale.setScalar(sc);
      }

      // --- Camera: base beat rig + car-mount overrides for tight driver/hands shots!
      let pose = rig(t);

      // Smooth car-mount camera for Sheriff 15 mph ("both hands on the wheel", 24.5..27.15)
      const sMountW = sstep((t - 24.45) / 0.45) * (1 - sstep((t - 26.85) / 0.45));
      if (sMountW > 0.001) {
        const sp = sheriffCarPose(t);
        const fx = Math.sin(sp.yaw), fz = Math.cos(sp.yaw);
        const rx = fz, rz = -fx;
        const camPos = [sp.x + fx * 2.25 - rx * 0.85, 1.55, sp.z + fz * 2.25 - rz * 0.85];
        const camLook = [sp.x + fx * 0.05, 1.22, sp.z + fz * 0.05];
        pose = {
          pos: lerp3(pose.pos, camPos, sMountW),
          look: lerp3(pose.look, camLook, sMountW),
          fov: lerp(pose.fov, 44, sMountW),
          roll: lerp(pose.roll, 0.02, sMountW),
        };
      }

      // Smooth car-mount camera for Ada's eyes (51.8..54.7) & hands turning wheel (54.7..57.75)
      const aMountW = sstep((t - 51.75) / 0.45) * (1 - sstep((t - 57.55) / 0.45));
      if (aMountW > 0.001) {
        const ap = adaCarPose(t);
        const fx = Math.sin(ap.yaw), fz = Math.cos(ap.yaw);
        const rx = fz, rz = -fx;
        const handsK = sstep((t - 54.65) / 0.55);
        // Eyes shot: front-3/4 outside windshield looking right into Ada's locked eyes
        const eyesPos = [ap.x + fx * 1.95 - rx * 0.68, 1.54, ap.z + fz * 1.95 - rz * 0.68];
        const eyesLook = [ap.x - fx * 0.15, 1.30, ap.z - fz * 0.15];
        // Hands shot: side-front angle clear of Ada's hair so both hands & yellow wheel tape read cleanly!
        const handsPos = [ap.x + fx * 0.40 + rx * 1.25, 1.62, ap.z + fz * 0.40 + rz * 1.25];
        const handsLook = [ap.x + fx * 0.16, 1.02, ap.z + fz * 0.16];
        const camPos = lerp3(eyesPos, handsPos, handsK);
        const camLook = lerp3(eyesLook, handsLook, handsK);
        pose = {
          pos: lerp3(pose.pos, camPos, aMountW),
          look: lerp3(pose.look, camLook, aMountW),
          fov: lerp(pose.fov, lerp(40, 44, handsK), aMountW),
          roll: lerp(pose.roll, lerp(-0.02, 0.03, handsK), aMountW),
        };
      }

      const [sx, sy, sr] = shake(t);
      pose.pos = [pose.pos[0] + sx, pose.pos[1] + sy, pose.pos[2]];
      pose.roll += sr;
      applyPose(cam, pose);

      // --- Comic star at contact point (kept compact so it accents the crash without hiding the stump)
      const hitD = CRASH_HITS.map((th) => t - th).find((d) => d >= 0 && d < 0.32);
      starG.visible = hitD !== undefined;
      if (hitD !== undefined) {
        const k = backOut(hitD / 0.12) * (1 - sstep((hitD - 0.2) / 0.12));
        starG.position.set(P_HIT.x, 1.15, P_HIT.y);
        starG.quaternion.copy(cam.quaternion);
        starG.translateZ(0.65);
        starG.scale.setScalar(0.54 * k + 0.001);
        starG.rotateZ(hitD * 2);
      }
    },
  };
}
