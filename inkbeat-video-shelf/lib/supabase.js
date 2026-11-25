// Server-only helper. Reads and deletes videos directly from the Supabase Storage bucket.
import shelf from '../config/shelf.json';
import { groupVideosIntoFolders, isSafeVideoPath, parseVideoEntry } from './folders';

const VIDEO = /\.(mp4|webm|mov)$/i;

function config() {
  return {
    url: (process.env.SUPABASE_URL || shelf.url || '').replace(/\/+$/, ''),
    key:
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_PUBLISHABLE_KEY ||
      shelf.publishableKey ||
      '',
    bucket: process.env.SUPABASE_BUCKET || shelf.bucket || 'videos',
  };
}

function headers(key, extra = {}) {
  const h = { apikey: key, 'Content-Type': 'application/json', ...extra };
  // Legacy keys are JWTs and go in Authorization too. New "secret" keys use apikey only.
  if (key.startsWith('eyJ')) h.Authorization = `Bearer ${key}`;
  return h;
}

function encodeObjectPath(path) {
  return String(path || '')
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

async function listPrefix(url, key, bucket, prefix = '') {
  const res = await fetch(`${url}/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify({
      prefix,
      limit: 500,
      offset: 0,
      sortBy: { column: 'created_at', order: 'desc' },
    }),
    cache: 'no-store',
  });

  if (res.status === 404) return { ok: false, problem: 'no-bucket', bucket };
  if (!res.ok) return { ok: false, problem: 'rejected', status: res.status };

  const items = await res.json();
  if (!Array.isArray(items)) return { ok: true, items: [] };

  const files = [];
  const subfolders = [];

  for (const item of items) {
    if (!item?.name || item.name.startsWith('.')) continue;
    const fullName = prefix ? `${prefix}${item.name}` : item.name;
    if (item.id === null) {
      subfolders.push(`${fullName}/`);
    } else if (VIDEO.test(item.name)) {
      files.push({
        name: fullName,
        size: item.metadata?.size ?? null,
        created: item.created_at ?? null,
      });
    }
  }

  for (const sub of subfolders) {
    const subRes = await listPrefix(url, key, bucket, sub);
    if (subRes.ok) {
      files.push(...subRes.items);
    }
  }

  return { ok: true, items: files };
}

export async function listVideos() {
  const { url, key, bucket } = config();
  if (!url || !key) return { videos: [], folders: [], problem: 'not-connected' };

  let listed;
  try {
    listed = await listPrefix(url, key, bucket, '');
  } catch {
    return { videos: [], folders: [], problem: 'unreachable' };
  }

  if (!listed.ok) {
    return {
      videos: [],
      folders: [],
      problem: listed.problem,
      bucket: listed.bucket,
      status: listed.status,
    };
  }

  const base = `${url}/storage/v1/object/public/${encodeURIComponent(bucket)}`;
  const videos = listed.items.map((item) => {
    const src = `${base}/${encodeObjectPath(item.name)}`;
    const filename = item.name.split('/').pop() || item.name;
    return parseVideoEntry({
      name: item.name,
      size: item.size,
      created: item.created,
      src,
      download: `${src}?download=${encodeURIComponent(filename)}`,
    });
  });

  const folders = groupVideosIntoFolders(videos);
  return { videos, folders };
}

export async function deleteVideos(rawNames) {
  const { url, key, bucket } = config();
  if (!url || !key) {
    return { ok: false, status: 500, error: 'Supabase config is missing in config/shelf.json.' };
  }

  const list = Array.isArray(rawNames) ? rawNames : [rawNames];
  const names = list.map((n) => String(n || '').trim()).filter(Boolean);

  if (names.length === 0) {
    return { ok: false, status: 400, error: 'Provide at least one video path to delete.' };
  }

  for (const name of names) {
    if (!isSafeVideoPath(name)) {
      return { ok: false, status: 400, error: `Invalid video path: "${name}".` };
    }
  }

  let res;
  try {
    res = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}`, {
      method: 'DELETE',
      headers: headers(key),
      body: JSON.stringify({ prefixes: names }),
      cache: 'no-store',
    });
  } catch (err) {
    return { ok: false, status: 502, error: `Could not reach Supabase (${err?.message || 'network error'}).` };
  }

  if (!res.ok) {
    const detail = await res.text();
    return {
      ok: false,
      status: res.status,
      error: `Supabase delete failed (${res.status}): ${detail.slice(0, 200)}`,
    };
  }

  return { ok: true, deleted: names };
}
