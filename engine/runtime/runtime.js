// vbeat scene runtime. Plain ES module; no Playwright specifics, so it can run in any sandboxed
// browser iframe. Loads the frozen core API + asset modules, then exposes `rt` to a scene.

export const MARKER_KINDS = ['pop', 'tick', 'whoosh', 'thud', 'stamp', 'slide', 'chime', 'rustle'];
const LOGICAL_W = 1280;
const LOGICAL_H = 720;

export class SceneError extends Error {
  constructor(t, cause) {
    super(cause && cause.message !== undefined ? String(cause.message) : String(cause));
    this.name = 'SceneError';
    this.t = t;
    this.stack = cause && cause.stack ? String(cause.stack) : this.stack;
  }
}

export class MarkerError extends Error {
  constructor(message) { super(message); this.name = 'MarkerError'; }
}

export function editDistance(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function nearest(name, candidates, count) {
  return candidates
    .map((c, i) => ({ c, i, d: editDistance(String(name), String(c)) }))
    .sort((x, y) => x.d - y.d || x.i - y.i)
    .slice(0, count)
    .map((x) => x.c);
}

async function loadMedia(spec) {
  const status = {};
  const images = {};
  await Promise.all(Object.entries(spec.media || {}).map(async ([id, src]) => {
    try {
      const img = new Image();
      img.src = src;
      await img.decode();
      if (!(img.naturalWidth > 0 && img.naturalHeight > 0)) throw new Error('image has zero size');
      images[id] = img;
      status[id] = { ok: true, w: img.naturalWidth, h: img.naturalHeight };
    } catch (e) {
      status[id] = { ok: false, error: String((e && e.message) || e) };
    }
  }));
  return { images, status };
}

function addStylesheet(href) {
  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => reject(new Error('failed to load stylesheet ' + href));
    document.head.appendChild(link);
  });
}

export async function createRuntime({ canvas, spec, baseUrl = '/', sceneUrl = null }) {
  const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  const index = await (await fetch(base + '_index.json')).json();

  // 1. frozen core API
  const palette = await import(base + 'assets/core/palette.js');
  const core = await import(base + 'assets/core/core.js');

  // 2. fonts, then wait for them
  if (index.fonts_css) await addStylesheet(base + 'assets/core/fonts.css');
  await document.fonts.ready;
  await core.fontsReady();

  // 3. asset modules (the server decides manifest vs glob)
  const registry = new Map();
  const origin = new Map();
  for (const rel of index.modules) {
    const mod = await import(base + 'assets/' + rel);
    if (!mod.assets) continue;
    for (const [id, asset] of Object.entries(mod.assets)) {
      if (registry.has(id)) throw new Error(`Duplicate asset id '${id}' (in ${origin.get(id)} and ${rel})`);
      registry.set(id, asset);
      origin.set(id, rel);
    }
  }

  // 4. media + scene module
  const { images, status: mediaStatus } = await loadMedia(spec);
  const scene = await import(sceneUrl || base + 'scene.js');   // sceneUrl: versioned scene URL (browser preview); default is the render page's /scene.js
  if (typeof scene.draw !== 'function') throw new Error('scene must export a draw(rt, t) function');

  const fps = spec.project.fps;
  const f0 = spec.beat.f0;
  const frames = spec.beat.f1 - spec.beat.f0;
  const dur = frames / fps;
  const W = palette.W || LOGICAL_W;
  const H = palette.H || LOGICAL_H;
  const g = canvas.getContext('2d');

  const words = spec.words.map((w, i) => ({
    id: w.id,
    text: w.text,
    start: Math.max(0, (w.f0 - f0) / fps),
    end: Math.max(0, (w.f1 - f0) / fps),
    i,
  }));
  const byId = new Map(words.map((w) => [w.id, w]));

  const word = (id) => {
    const w = byId.get(id);
    if (!w) {
      const near = nearest(id, words.map((x) => x.id), 5);
      throw new Error(`Unknown word id '${id}'. Nearest ids: ${near.join(', ') || '(this beat has no words)'}`);
    }
    return w;
  };

  const lib = {
    get(id) {
      const a = registry.get(id);
      if (!a) {
        const near = nearest(id, [...registry.keys()], 3);
        throw new Error(`Unknown asset '${id}'. Did you mean: ${near.join(', ') || '(no assets loaded)'}`);
      }
      return a;
    },
    list() {
      return [...registry.entries()].map(([id, a]) => ({ id, ...(a.meta || {}) })).sort((x, y) => (x.id < y.id ? -1 : 1));
    },
    draw(id, t, params) {
      const a = lib.get(id);
      g.save();
      try { a.draw(g, t, params); } finally { g.restore(); }
    },
    markers(id, params) {
      const a = lib.get(id);
      return typeof a.markers === 'function' ? a.markers(params) : [];
    },
  };

  const rt = {
    g, W, H, fps, frames, dur, t: 0,
    words,
    at(id, edge = 'start', offset = 0) {
      if (edge !== 'start' && edge !== 'end') throw new Error(`at(): edge must be 'start' or 'end', got '${edge}'`);
      return word(id)[edge] + offset;
    },
    range(idA, idB) {
      const start = word(idA).start;
      const end = word(idB).end;
      return { start, end, dur: end - start };
    },
    param(name, dflt) {
      const v = spec.params ? spec.params[name] : undefined;
      return v === undefined ? dflt : v;
    },
    rng: (seed) => core.rng(seed),
    ease: { cl: core.cl, lerp: core.lerp, eo: core.eo, eio: core.eio, eb: core.eb },
    A: (delay, d) => core.A(rt.t, delay, d),
    layer: (key, w, h) => core.getLayer(key, w, h),
    media(id) {
      if (!(id in mediaStatus)) {
        throw new Error(`Unknown media '${id}'. Declared: ${Object.keys(mediaStatus).join(', ') || '(none)'}`);
      }
      if (!mediaStatus[id].ok) throw new Error(`Media '${id}' failed to load: ${mediaStatus[id].error}`);
      return images[id];
    },
    core, palette, lib,
  };

  function drawFrame(t, scale = 1) {
    const w = Math.round(W * scale);
    const h = Math.round(H * scale);
    try {
      canvas.width = w;      // resizing also resets all 2D state
      canvas.height = h;
      core.resetG(g);
      g.scale(w / W, h / H);
      g.fillStyle = palette.PAPER;
      g.fillRect(0, 0, W, H);
      rt.t = t;
      scene.draw(rt, t);
    } catch (e) {
      throw new SceneError(t, e);
    }
  }

  function markers() {
    let list;
    try {
      rt.t = 0;
      list = typeof scene.markers === 'function' ? scene.markers(rt) : [];
    } catch (e) {
      throw new MarkerError('markers() threw: ' + ((e && e.message) || e));
    }
    if (!Array.isArray(list)) throw new MarkerError('markers() must return an array');
    const problems = [];
    const out = list.map((m, i) => {
      if (!m || typeof m !== 'object') { problems.push(`[${i}] is not an object`); return null; }
      if (typeof m.id !== 'string' || !m.id) problems.push(`[${i}] id must be a non-empty string`);
      if (!MARKER_KINDS.includes(m.kind)) problems.push(`[${i}] kind '${m.kind}' not in ${MARKER_KINDS.join('|')}`);
      if (typeof m.t !== 'number' || !Number.isFinite(m.t)) problems.push(`[${i}] t must be a finite number`);
      else if (m.t < 0 || m.t > dur + 1e-9) problems.push(`[${i}] t=${m.t} is outside 0..${dur}`);
      return { id: m.id, t: m.t, kind: m.kind };
    });
    if (problems.length) throw new MarkerError('invalid markers: ' + problems.join('; '));
    return out;
  }

  return {
    rt, drawFrame, markers, canvas,
    meta: scene.meta === undefined ? null : scene.meta,
    mediaStatus,
    info: { fps, frames, dur, words: words.length, assets: registry.size, modules: index.modules.length, source: index.source },
  };
}
