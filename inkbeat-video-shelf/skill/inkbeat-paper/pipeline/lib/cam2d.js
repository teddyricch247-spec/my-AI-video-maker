// 2D camera rig for 1280x720 virtual paper stage -> 9:16 portrait or 16:9 landscape.
// Pure function of t. Zero Math.random, zero mutable state across frames.
//
// Beats: [{ at, dur, atPos:[cx, cy], viewH, roll, cut, zoom }] (beat 0 is initial framing).
// - Default stage is 1280x720. At viewH = 720 in 16:9 the full 1280x720 canvas fills the screen.
// - In 9:16 portrait at viewH = 720 the visible window is 405x720 centered at [cx, cy]; zoom in with viewH ~ 440-560
//   for presenter/talking head shots (keep face around cy ~ 380-430 so it lands in upper 30-45% above 70% captions).
// - `cut: true` snaps on a half-frame boundary so sub-frame motion blur never smears across a hard cut.

export const STAGE_W = 1280;
export const STAGE_H = 720;

const LEAD = 0.2;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const eio = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const lerp = (a, b, k) => a + (b - a) * k;

export function makeCam2d(beats, { drift = 0.03, arc = 12, fps = 30 } = {}) {
  const cutT = (at) => (Math.round(at * fps) - 0.5) / fps;
  const B = beats.map((b, i) => ({
    atPos: b.center || b.pos || [640, 360],
    viewH: 720,
    roll: 0,
    dur: 0.7,
    zoom: 0,
    ...b,
    start: i ? (b.cut ? cutT(b.at) : b.at - LEAD) : -1e9,
  }));

  function state(j, s) {
    const b = B[j];
    let cx = b.atPos[0];
    let cy = b.atPos[1];
    let viewH = b.viewH;
    let roll = b.roll;
    let landed = 0;

    if (j) {
      if (b.cut) {
        landed = b.start;
      } else {
        const prev = state(j - 1, b.start);
        const k = clamp01((s - b.start) / Math.max(0.05, b.dur));
        const e = eio(k);
        cx = lerp(prev.cx, b.atPos[0], e);
        cy = lerp(prev.cy, b.atPos[1], e);
        viewH = lerp(prev.viewH, b.viewH, e);
        roll = lerp(prev.roll, b.roll, e);
        landed = b.start + b.dur;
      }
    }

    const td = Math.max(0, s - landed);
    const holdEnd = j + 1 < B.length ? B[j + 1].start : landed + 5;
    const zk = b.zoom ? b.zoom * eio(clamp01(td / Math.max(0.1, holdEnd - landed))) : 0;

    // Gentle camera drift (Shorts) and eased zoom (both modes)
    const driftScale = Math.max(0.55, 1 - drift * td - zk);
    viewH = viewH * driftScale;
    if (arc) {
      cx += Math.sin(td * 0.9 + j * 1.3) * arc * Math.min(1, td);
    }

    return { cx, cy, viewH, roll };
  }

  return function poseAt(t) {
    let i = 0;
    while (i + 1 < B.length && t >= B[i + 1].start) i++;
    return state(i, t);
  };
}

export function calm2d(beats, { zoom = 0.08, every = 3 } = {}) {
  return beats.map((b, i) =>
    i
      ? { ...b, cut: true, roll: 0, zoom: b.zoom ?? (i % every === 1 ? zoom : 0) }
      : { ...b, roll: 0 }
  );
}

export function clampPoseToStage(pose, { w, h, stageW = STAGE_W, stageH = STAGE_H }) {
  const aspect = w / h;
  const maxViewH = Math.min(stageH, stageW / Math.max(0.2, aspect));
  const viewH = Math.min(pose.viewH, maxViewH);
  const halfW = (viewH * aspect) / 2;
  const halfH = viewH / 2;
  const cx = Math.max(halfW, Math.min(stageW - halfW, pose.cx));
  const cy = Math.max(halfH, Math.min(stageH - halfH, pose.cy));
  return { cx, cy, viewH, roll: pose.roll || 0 };
}

export function applyCam2d(g, pose, { w, h, clamp = true } = {}) {
  const p = clamp ? clampPoseToStage(pose, { w, h }) : pose;
  const scale = h / p.viewH;
  g.translate(w / 2, h / 2);
  if (p.roll) g.rotate(-p.roll);
  g.scale(scale, scale);
  g.translate(-p.cx, -p.cy);
  return scale;
}
