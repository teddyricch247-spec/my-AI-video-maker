// HTTP client for the frozen contract: same-origin JSON, cold-start retry for GET, 401 -> login. Never retries POST/PUT/DELETE.
import { setBanner } from './ui.js';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const COLD = { retries: 6, delayMs: 5000 };
let waking = 0;
let returnTo = '';

export function takeReturnTo() {
  const r = returnTo;
  returnTo = '';
  return r;
}

function wake(delta) {
  waking += delta;
  setBanner('wake', waking > 0 ? 'Waking the server (about a minute)...' : null, 'wake');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const COLD_STATUS = new Set([0, 502, 503, 504]);

async function once(method, path, { body, form } = {}) {
  const init = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
  if (form) init.body = form; // the browser sets the multipart boundary itself
  else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch('/api' + path, init);
  } catch (e) {
    throw new ApiError(0, 'network', 'Network error: could not reach the server');
  }
  if (res.status === 204) return null;
  let data = null;
  try {
    data = await res.json();
  } catch (e) { /* non-JSON body (proxy error page) */ }
  if (!res.ok) {
    const err = data && data.error;
    throw new ApiError(res.status, (err && err.code) || 'http_' + res.status, (err && err.message) || 'Request failed (' + res.status + ')');
  }
  return data;
}

function unauthorized() {
  if (!location.hash.startsWith('#/login')) {
    returnTo = location.hash;
    location.hash = '#/login';
  }
}

/**
 * opts: {body, form, quiet, alive, noRedirect}
 * quiet: GET only, no retry and no banner (background refreshes). alive(): return false to abandon retries.
 */
export async function request(method, path, opts = {}) {
  const isGet = method === 'GET';
  const maxRetries = isGet && !opts.quiet ? COLD.retries : 0;
  let shown = false;
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        return await once(method, path, opts);
      } catch (e) {
        if (e.status === 401 && !opts.noRedirect) unauthorized();
        const retry = isGet && COLD_STATUS.has(e.status) && attempt < maxRetries && (!opts.alive || opts.alive());
        if (!retry) throw e;
        if (!shown) {
          shown = true;
          wake(1);
        }
        await sleep(COLD.delayMs);
        if (opts.alive && !opts.alive()) throw e;
      }
    }
  } finally {
    if (shown) wake(-1);
  }
}

export const api = {
  get: (path, opts) => request('GET', path, opts),
  post: (path, body, opts) => request('POST', path, { ...opts, body: body === undefined ? {} : body }),
  put: (path, body, opts) => request('PUT', path, { ...opts, body }),
  del: (path, opts) => request('DELETE', path, opts),
  upload: (path, file, filename) => {
    const form = new FormData();
    form.append('file', file, filename || file.name);
    return request('POST', path, { form });
  },
};
