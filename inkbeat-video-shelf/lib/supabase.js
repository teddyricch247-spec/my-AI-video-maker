// Server-only helper. Reads the bucket list directly from config/shelf.json.
import shelf from '../config/shelf.json';

const VIDEO = /\.(mp4|webm|mov)$/i;

function config() {
  return {
    url: (shelf.url || '').replace(/\/+$/, ''),
    key: shelf.publishableKey || '',
    bucket: shelf.bucket || 'videos',
  };
}

function headers(key) {
  const h = { apikey: key, 'Content-Type': 'application/json' };
  // Legacy keys are JWTs and go in Authorization too. New "secret" keys use apikey only.
  if (key.startsWith('eyJ')) h.Authorization = `Bearer ${key}`;
  return h;
}

// 16:9 renders are saved with "-16x9" in the name (e.g. my-story-16x9-part-01.mp4); everything else is 9:16.
const isWide = (name) => /(^|[-_])16x9([-_.]|$)/i.test(name);

function titleOf(name) {
  return name.replace(/\.[^.]+$/, '').replace(/(^|[-_])16x9(?=[-_]|$)/i, '').replace(/[-_]+/g, ' ').trim();
}

export async function listVideos() {
  const { url, key, bucket } = config();
  if (!url || !key) return { videos: [], problem: 'not-connected' };

  let res;
  try {
    res = await fetch(`${url}/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
      method: 'POST',
      headers: headers(key),
      body: JSON.stringify({
        prefix: '',
        limit: 200,
        offset: 0,
        sortBy: { column: 'created_at', order: 'desc' },
      }),
      cache: 'no-store',
    });
  } catch {
    return { videos: [], problem: 'unreachable' };
  }

  if (res.status === 404) return { videos: [], problem: 'no-bucket', bucket };
  if (!res.ok) return { videos: [], problem: 'rejected', status: res.status };

  const items = await res.json();
  const base = `${url}/storage/v1/object/public/${encodeURIComponent(bucket)}`;
  const videos = items
    .filter((i) => i.id && VIDEO.test(i.name))
    .map((i) => {
      const src = `${base}/${encodeURIComponent(i.name)}`;
      return {
        name: i.name,
        title: titleOf(i.name),
        wide: isWide(i.name),
        size: i.metadata?.size ?? null,
        created: i.created_at ?? null,
        src,
        download: `${src}?download=${encodeURIComponent(i.name)}`,
      };
    });
  return { videos };
}
