import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, extname, join, resolve, sep } from 'node:path';
import shelf from '../config/shelf.json';

const SAFE_SEG = /^[a-z0-9][a-z0-9._-]*$/i;
const PART_MP4 = /^(video|part-\d+)\.mp4$/i;
const SHEET_JPG = /^(beatcheck|sheet(?:-part-\d+)?)\.jpg$/i;
const MB = 1024 * 1024;
const SHRINK_OVER = 45 * MB;
const LIMIT = 50 * MB;

export function rendersRoot() {
  const cwd = process.cwd();
  const nested = join(cwd, 'inkbeat-video-shelf');
  if (!existsSync(join(cwd, 'config', 'shelf.json')) && existsSync(join(nested, 'config', 'shelf.json'))) {
    return resolve(nested, '.renders');
  }
  return resolve(cwd, '.renders');
}

export function isSafeSegment(value) {
  return typeof value === 'string' && SAFE_SEG.test(value) && !value.includes('..');
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function titleFromSlug(slug) {
  return slug.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function supabaseConfig() {
  const url = (process.env.SUPABASE_URL || shelf.url || '').replace(/\/+$/, '');
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    shelf.publishableKey ||
    '';
  const bucket = process.env.SUPABASE_BUCKET || shelf.bucket || 'videos';
  return { url, key, bucket };
}

function normalizeStem(raw, fallback) {
  const cleaned = basename(String(raw || fallback || 'clip'), extname(String(raw || '')))
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || fallback || 'clip';
}

function probeDimensions(filePath) {
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', filePath],
    { encoding: 'utf8' }
  );
  const [w, h] = (r.stdout || '').trim().split(',').map(Number);
  return w && h ? { w, h } : null;
}

function shrinkVideo(filePath) {
  const dir = resolve(filePath, '..');
  const small = join(dir, basename(filePath, extname(filePath)) + '.small.mp4');
  for (const crf of ['23', '27']) {
    const r = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        '-i',
        filePath,
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-crf',
        crf,
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        '-c:a',
        'copy',
        small,
      ],
      { encoding: 'utf8' }
    );
    if (r.status !== 0) return { error: r.stderr?.trim() || 'ffmpeg re-encode failed' };
    if (statSync(small).size <= LIMIT) return { file: small };
  }
  return { file: small };
}

export function listDrafts() {
  const root = rendersRoot();
  if (!existsSync(root)) return [];

  const entries = readdirSync(root, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory() && !entry.name.startsWith('.') && isSafeSegment(entry.name)
  );

  const drafts = [];
  for (const entry of entries) {
    const slug = entry.name;
    const dir = join(root, slug);
    const report = readJsonSafe(join(dir, 'report.json')) || {};
    const partsMeta = readJsonSafe(join(dir, 'parts.json'));
    const dirFiles = readdirSync(dir);

    let partEntries = [];
    if (Array.isArray(partsMeta) && partsMeta.length > 0) {
      partEntries = partsMeta
        .filter((p) => p?.file && existsSync(join(dir, p.file)))
        .map((p, idx) => ({
          file: p.file,
          index: idx + 1,
          start: p.start ?? null,
          end: p.end ?? null,
          seconds: p.seconds ?? null,
          bytes: statSync(join(dir, p.file)).size,
          mtimeMs: statSync(join(dir, p.file)).mtimeMs,
        }));
    }

    if (partEntries.length === 0) {
      const mp4s = dirFiles.filter((f) => PART_MP4.test(f)).sort();
      partEntries = mp4s.map((f, idx) => {
        const st = statSync(join(dir, f));
        return {
          file: f,
          index: idx + 1,
          start: null,
          end: null,
          seconds: null,
          bytes: st.size,
          mtimeMs: st.mtimeMs,
        };
      });
    }

    const sheets = dirFiles
      .filter((f) => SHEET_JPG.test(f))
      .sort()
      .map((f) => ({
        file: f,
        label: f === 'beatcheck.jpg' ? 'Beat check' : f.replace(/\.jpg$/i, '').replace(/[-_]+/g, ' '),
        src: `/api/drafts/${encodeURIComponent(slug)}/${encodeURIComponent(f)}`,
        mtimeMs: statSync(join(dir, f)).mtimeMs,
      }));

    if (partEntries.length === 0 && sheets.length === 0) continue;

    const latestMtime = Math.max(
      ...partEntries.map((p) => p.mtimeMs),
      ...sheets.map((s) => s.mtimeMs),
      statSync(dir).mtimeMs
    );

    const totalBytes = partEntries.reduce((sum, p) => sum + p.bytes, 0);
    const aspect = report.aspect || (/(16x9|-yt$)/i.test(slug) ? '16:9' : '9:16');
    const parts = partEntries.map((p) => ({
      file: p.file,
      index: p.index,
      start: p.start,
      end: p.end,
      seconds: p.seconds,
      mb: Number((p.bytes / MB).toFixed(1)),
      src: `/api/drafts/${encodeURIComponent(slug)}/${encodeURIComponent(p.file)}`,
      download: `/api/drafts/${encodeURIComponent(slug)}/${encodeURIComponent(p.file)}?download=1`,
    }));

    drafts.push({
      slug,
      title: titleFromSlug(slug),
      aspect,
      wide: aspect === '16:9',
      mode: report.mode || (partEntries.length === 0 ? 'beatcheck' : 'draft'),
      captions: report.captions || null,
      seconds: report.seconds ?? null,
      sPerFrame: report.s_per_frame ?? null,
      totalMb: Number((totalBytes / MB).toFixed(1)),
      uploaded: Boolean(report.uploaded),
      uploadedFiles: Array.isArray(report.uploadedFiles) ? report.uploadedFiles : [],
      updatedAt: new Date(latestMtime).toISOString(),
      updatedMs: latestMtime,
      parts,
      sheets,
    });
  }

  drafts.sort((a, b) => b.updatedMs - a.updatedMs);
  return drafts;
}

export function resolveDraftFile(slug, file) {
  if (!isSafeSegment(slug) || !isSafeSegment(file)) return null;
  if (!/\.(mp4|webm|mov|jpg|jpeg|png)$/i.test(file)) return null;
  const root = rendersRoot();
  const resolved = resolve(root, slug, file);
  if (!resolved.startsWith(root + sep)) return null;
  if (!existsSync(resolved)) return null;
  const st = statSync(resolved);
  if (!st.isFile()) return null;
  return { path: resolved, size: st.size, mtimeMs: st.mtimeMs };
}

export async function publishDraft(slug, wantedName) {
  if (!isSafeSegment(slug)) return { ok: false, status: 400, error: 'Invalid draft name.' };
  const root = rendersRoot();
  const dir = resolve(root, slug);
  if (!dir.startsWith(root + sep) || !existsSync(dir)) {
    return { ok: false, status: 404, error: `Draft "${slug}" not found.` };
  }

  const { url, key, bucket } = supabaseConfig();
  if (!url || !key) {
    return { ok: false, status: 500, error: 'Supabase config is missing in config/shelf.json.' };
  }

  let files = [];
  const partsMeta = readJsonSafe(join(dir, 'parts.json'));
  if (Array.isArray(partsMeta)) {
    files = partsMeta.map((p) => join(dir, p.file)).filter((f) => existsSync(f));
  }
  if (files.length === 0) {
    files = readdirSync(dir)
      .filter((f) => PART_MP4.test(f))
      .sort()
      .map((f) => join(dir, f));
  }
  if (files.length === 0) {
    return { ok: false, status: 400, error: `No rendered video parts found in "${slug}".` };
  }

  const stem = normalizeStem(wantedName || slug, slug);
  const d0 = probeDimensions(files[0]);
  const tag = d0 && d0.w > d0.h && !/16x9/.test(stem) ? '-16x9' : '';

  const headers = { apikey: key, 'x-upsert': 'true', 'cache-control': 'max-age=3600' };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;

  const mimeMap = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' };
  const uploaded = [];

  for (let i = 0; i < files.length; i++) {
    const original = files[i];
    const ext = (extname(original) || '.mp4').toLowerCase();
    const remoteName = `${stem}${tag}${files.length > 1 ? `-part-${String(i + 1).padStart(2, '0')}` : ''}${ext}`;
    let fileToSend = original;

    if (statSync(fileToSend).size > SHRINK_OVER) {
      const shrunk = shrinkVideo(fileToSend);
      if (shrunk.error || !shrunk.file) {
        return { ok: false, status: 500, error: shrunk.error || `Failed to shrink ${basename(original)}.` };
      }
      fileToSend = shrunk.file;
    }

    const size = statSync(fileToSend).size;
    if (size > LIMIT) {
      return {
        ok: false,
        status: 413,
        error: `${remoteName} is ${(size / MB).toFixed(1)} MB (Supabase limit is 50 MB).`,
      };
    }

    let res;
    try {
      res = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeURIComponent(remoteName)}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': mimeMap[ext] || 'video/mp4' },
        body: readFileSync(fileToSend),
      });
    } catch (err) {
      return { ok: false, status: 502, error: `Could not reach Supabase (${err?.message || 'network error'}).` };
    }

    if (!res.ok) {
      const detail = await res.text();
      return {
        ok: false,
        status: res.status,
        error: `Supabase returned status ${res.status} for ${remoteName}: ${detail.slice(0, 200)}`,
      };
    }

    const watchUrl = `${url}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodeURIComponent(remoteName)}`;
    uploaded.push({
      name: remoteName,
      mb: Number((size / MB).toFixed(1)),
      watchUrl,
      downloadUrl: `${watchUrl}?download=${encodeURIComponent(remoteName)}`,
    });
  }

  const reportPath = join(dir, 'report.json');
  const existingReport = readJsonSafe(reportPath) || {};
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        ...existingReport,
        uploaded: true,
        uploadedAt: new Date().toISOString(),
        uploadedFiles: uploaded,
      },
      null,
      1
    )
  );

  // Clean up bulky raw frames once saved to the shelf.
  const framesDir = join(dir, 'frames');
  if (existsSync(framesDir)) {
    rmSync(framesDir, { recursive: true, force: true });
  }

  return { ok: true, files: uploaded };
}

export function discardDraft(slug) {
  if (!isSafeSegment(slug)) return { ok: false, status: 400, error: 'Invalid draft name.' };
  const root = rendersRoot();
  const dir = resolve(root, slug);
  if (!dir.startsWith(root + sep) || !existsSync(dir)) {
    return { ok: false, status: 404, error: `Draft "${slug}" not found.` };
  }
  rmSync(dir, { recursive: true, force: true });
  return { ok: true };
}
