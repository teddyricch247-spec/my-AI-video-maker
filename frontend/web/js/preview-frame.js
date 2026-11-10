// Runs inside <iframe sandbox="allow-scripts" src="/preview-frame.html"> (opaque origin: no cookies, no storage, no parent access).
// Protocol (postMessage, parent owns the clock):
//   parent -> frame: {type:'load', bundle} | {type:'seek', t}
//   frame -> parent: {type:'ready'} | {type:'loaded', dur, fps, frames, markers} | {type:'error', message, t}
import { loadEngine } from './preview-adapter.js';

const canvas = document.getElementById('c');
let engine = null;
let lastT = null;
let lastErr = '';
let loadId = 0;

// The frame's origin is opaque ("null"), so the parent cannot be addressed by origin; identity is checked via e.source instead.
const send = (msg) => parent.postMessage(msg, '*');

function fail(message, t) {
  const key = message + '@' + t;
  if (key === lastErr) return; // do not flood the parent while playing over a broken frame
  lastErr = key;
  send({ type: 'error', message: String(message), t: t == null ? null : t });
}

function draw(t) {
  if (!engine) return;
  const tt = Math.min(Math.max(0, Number(t) || 0), engine.dur);
  if (tt === lastT && !lastErr) return;
  lastT = tt;
  try {
    engine.draw(tt);
    lastErr = '';
  } catch (e) {
    fail((e && e.message) || String(e), tt);
  }
}

async function load(bundle) {
  const my = ++loadId;
  engine = null;
  lastT = null;
  lastErr = '';
  try {
    const eng = await loadEngine(bundle, canvas);
    if (my !== loadId) return;
    engine = eng;
    send({ type: 'loaded', dur: eng.dur, fps: eng.fps, frames: eng.frames, markers: eng.markers });
  } catch (e) {
    if (my === loadId) fail('Could not load the scene: ' + ((e && e.message) || e), null);
  }
}

addEventListener('message', (e) => {
  if (e.source !== parent) return;
  const d = e.data;
  if (!d || typeof d !== 'object') return;
  if (d.type === 'load' && d.bundle) load(d.bundle);
  else if (d.type === 'seek') draw(d.t);
});
addEventListener('error', (e) => fail(e.message || 'Script error', lastT));
addEventListener('unhandledrejection', (e) => fail((e.reason && e.reason.message) || String(e.reason), lastT));

send({ type: 'ready' });
