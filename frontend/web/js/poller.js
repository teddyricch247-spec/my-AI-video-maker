// Cheap polling: one in-flight request per poller, no overlap, faster when the tab is visible, immediate refresh on re-focus.
import { api } from './api.js';

export const INTERVALS = { visible: 2500, hidden: 10000 };

/**
 * poll(fn, delay): fn(isStopped) runs, then waits delay (number or () => number) and repeats.
 * Returns {stop(), now()}. now() runs again as soon as possible (coalesced if already running).
 */
export function poll(fn, delay, { immediate = true } = {}) {
  let stopped = false;
  let running = false;
  let kick = false;
  let timer = 0;
  const wait = () => (typeof delay === 'function' ? delay() : delay);
  const isStopped = () => stopped;

  async function tick() {
    timer = 0;
    if (stopped || running) return;
    running = true;
    try {
      await fn(isStopped);
    } catch (e) { /* errors already surfaced by the api layer; keep polling */ }
    running = false;
    if (stopped) return;
    if (kick) {
      kick = false;
      timer = setTimeout(tick, 0);
    } else timer = setTimeout(tick, wait());
  }
  function now() {
    if (stopped) return;
    if (running) {
      kick = true;
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(tick, 0);
  }
  const onVis = () => { if (!document.hidden) now(); };
  document.addEventListener('visibilitychange', onVis);
  if (immediate) now();
  else timer = setTimeout(tick, wait());
  return {
    now,
    stop() {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    },
  };
}

const cache = new Map(); // pid -> {rev, project, beats}

/** Watch GET /projects/{pid}/status using rev so unchanged polls do no work. cb({rev, project, beats}) only on change (and once from cache). */
export function watchProject(pid, cb) {
  const first = cache.get(pid);
  if (first) queueMicrotask(() => cb(first));
  const p = poll(async (isStopped) => {
    const cur = cache.get(pid);
    const r = await api.get('/projects/' + encodeURIComponent(pid) + '/status?rev=' + (cur ? cur.rev : 0), { alive: () => !isStopped() });
    if (isStopped()) return;
    if (r.changed) {
      const next = { rev: r.rev, project: r.project, beats: r.beats };
      cache.set(pid, next);
      cb(next);
    } else if (cur) cur.rev = r.rev;
  }, () => (document.hidden ? INTERVALS.hidden : INTERVALS.visible));
  return { now: p.now, stop: p.stop, get: () => cache.get(pid) };
}

export function forgetProject(pid) {
  cache.delete(pid);
}
