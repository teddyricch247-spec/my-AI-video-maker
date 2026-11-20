// Shared helper for the scripts in this folder. Node 20.12+ (uses global fetch).
// Defaults come from config/shelf.json (the real project). Env vars or .env.local override them.
import { readFileSync } from 'node:fs';
for (const f of ['.env.local', '.env']) {
  try { process.loadEnvFile(f); } catch { /* file not there, fine */ }
}

let shelf = {};
try { shelf = JSON.parse(readFileSync(new URL('../config/shelf.json', import.meta.url), 'utf8')); } catch { /* no config file */ }

export const URL_BASE = (process.env.SUPABASE_URL || shelf.url || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || shelf.publishableKey || '';
export const BUCKET = process.env.SUPABASE_BUCKET || shelf.bucket || 'videos';
export const MAX_BYTES = 50 * 1024 * 1024; // Supabase free tier per-file limit

export function requireEnv() {
  if (!URL_BASE || !KEY) {
    console.error('No Supabase URL or key. Check config/shelf.json (or set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY).');
    process.exit(1);
  }
}

function authHeaders(extra = {}) {
  const h = { apikey: KEY, ...extra };
  // Legacy keys are JWTs and also go in Authorization. New "secret" keys use apikey only.
  if (KEY.startsWith('eyJ')) h.Authorization = `Bearer ${KEY}`;
  return h;
}

export async function call(path, { method = 'GET', json, body, headers = {} } = {}) {
  const res = await fetch(`${URL_BASE}/storage/v1${path}`, {
    method,
    headers: authHeaders(json ? { 'Content-Type': 'application/json', ...headers } : headers),
    body: json ? JSON.stringify(json) : body,
  });
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch { /* keep text */ }
  return { ok: res.ok, status: res.status, data };
}

export const publicUrl = (name) =>
  `${URL_BASE}/storage/v1/object/public/${encodeURIComponent(BUCKET)}/${encodeURIComponent(name)}`;

export async function listAll() {
  const r = await call(`/object/list/${encodeURIComponent(BUCKET)}`, {
    method: 'POST',
    json: { prefix: '', limit: 1000, offset: 0, sortBy: { column: 'created_at', order: 'desc' } },
  });
  if (!r.ok) {
    console.error(`Could not list bucket "${BUCKET}" (status ${r.status}). ${typeof r.data === 'string' ? r.data : JSON.stringify(r.data)}`);
    process.exit(1);
  }
  return r.data.filter((i) => i.id && !i.name.startsWith('.'));
}
