// Page-side API (window.vb). Every method returns plain JSON: {ok:true,...} or {ok:false,error:{type,message,stack,t?}}.
// Nothing here throws across the Playwright boundary, so the driver can always tell a scene fault from a tool fault.
import { createRuntime, SceneError, MarkerError } from './runtime.js';
import { renderContactSheet } from './contact-sheet.js';

const canvas = document.getElementById('c');
Object.assign(canvas.style, { position: 'fixed', left: '0', top: '0' });   // CSSOM is allowed under the CSP
let R = null;

function errInfo(e) {
  if (e instanceof SceneError) return { type: 'SceneError', t: e.t, message: e.message, stack: e.stack };
  if (e instanceof MarkerError) return { type: 'MarkerError', message: e.message, stack: e.stack };
  return { type: (e && e.name) || 'Error', message: String((e && e.message) || e), stack: (e && e.stack) || '' };
}

async function guard(fn, asLoadError = false) {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    const error = errInfo(e);
    if (asLoadError && error.type !== 'SceneError') error.type = 'LoadError';
    return { ok: false, error };
  }
}

function needRuntime() {
  if (!R) throw new Error('init(spec) has not succeeded on this page');
  return R;
}

const normQuality = (q) => (q === undefined ? 0.85 : q > 1 ? q / 100 : q);
const mimeOf = (format) => (format === 'jpeg' ? 'image/jpeg' : 'image/png');

function toBlob(cv, format, quality) {
  return new Promise((resolve, reject) => {
    cv.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))), mimeOf(format),
      format === 'jpeg' ? normQuality(quality) : undefined);
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1]);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

// cyrb53 over the RGBA words: cheap, deterministic, good enough to detect any pixel difference.
function hashPixels(data) {
  const u32 = new Uint32Array(data.buffer, data.byteOffset, data.byteLength >> 2);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < u32.length; i++) {
    const x = u32[i];
    h1 = Math.imul(h1 ^ x, 2654435761);
    h2 = Math.imul(h2 ^ x, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

window.vb = {
  init: (spec) => guard(async () => {
    R = await createRuntime({ canvas, spec, baseUrl: '/' });
    let meta = null;
    try { meta = JSON.parse(JSON.stringify(R.meta)); } catch (_) { /* meta is optional */ }
    return { info: R.info, meta };
  }, true),

  drawAt: (t, scale = 1) => guard(() => {
    needRuntime().drawFrame(t, scale);
    return { width: canvas.width, height: canvas.height };
  }),

  capture: ({ t, scale = 1, format = 'png', quality }) => guard(async () => {
    needRuntime().drawFrame(t, scale);
    return { data: await blobToBase64(await toBlob(canvas, format, quality)) };
  }),

  captureBatch: (times, { scale = 1, format = 'png', quality } = {}) => guard(async () => {
    const r = needRuntime();
    const data = [], draw = [], capture = [];
    for (const t of times) {
      const a = performance.now();
      r.drawFrame(t, scale);
      const b = performance.now();
      data.push(await blobToBase64(await toBlob(canvas, format, quality)));
      draw.push(b - a);
      capture.push(performance.now() - b);
    }
    return { data, timing: { draw, capture } };
  }),

  strip: ({ times, cols, tileW = 640, format = 'jpeg', quality } = {}) => guard(async () => {
    const r = needRuntime();
    const sheet = renderContactSheet(r, { times, cols, tileW, fps: r.rt.fps });
    return { data: await blobToBase64(await toBlob(sheet, format, quality)), width: sheet.width, height: sheet.height };
  }),

  pixelHash: (t) => guard(() => {
    const r = needRuntime();
    r.drawFrame(t, 1);
    const img = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    return { hash: hashPixels(img.data) };
  }),

  markers: () => guard(() => ({ markers: needRuntime().markers() })),

  pageChecks: (opts) => guard(async () => {
    const { runPageChecks } = await import('./page-checks.js');
    return await runPageChecks(needRuntime(), opts);
  }),

  lint: (source) => guard(async () => {
    const { lintScene } = await import('./lint.js');
    return { findings: lintScene(source) };
  }),
};
