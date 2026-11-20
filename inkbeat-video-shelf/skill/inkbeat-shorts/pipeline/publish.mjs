// Save finished video(s) to the Supabase shelf and print the links. ONLY run this when the owner asks to save/upload.
// Usage (from the repo root):  node scripts/upload.mjs <video.mp4 | render-folder> [name]
//   (same thing from skill/inkbeat-shorts: node pipeline/publish.mjs <video.mp4 | render-folder> [name])   Add --dry-run to only show the plan.
//   - A render folder (.renders/<slug>) uploads every part from its parts.json (or video.mp4 / part-NN.mp4) in order.
//   - Size rule: Supabase's free tier rejects any file over 50 MB, so a file over 45 MB is re-encoded first with ffmpeg:
//     libx264, CRF 23, same resolution, audio copied untouched. The original is left in place (the copy is *.small.mp4).
//     If a file is still over 50 MB after that, one retry at CRF 27; if it is still too big the script says so.
//   - Names: <name>.mp4 for one file, <name>-part-01.mp4, -part-02.mp4 ... for several. 16:9 files get "-16x9" in the name so
//     the website shows them landscape; 9:16 is the default and gets no tag.
// No npm install needed (Node 20.12+, global fetch, ffmpeg + ffprobe on PATH).
// Config: config/shelf.json; SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY (or SUPABASE_SERVICE_ROLE_KEY), SUPABASE_BUCKET override it.
// The publishable key is meant to be public.
import { readFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { basename, extname, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

let shelf = {};
try { shelf = JSON.parse(readFileSync(new URL('../../../config/shelf.json', import.meta.url), 'utf8')); } catch { /* skill used outside the repo */ }
const URL_BASE = (shelf.url || 'https://oblzunlbkmifwbpqvzis.supabase.co').replace(/\/+$/, '');
const KEY = shelf.publishableKey || 'sb_publishable_G9YL_JGYzD_khs230uBSlA_-7CrYG-s';
const BUCKET = shelf.bucket || 'videos';
const MB = 1024 * 1024, LIMIT = 50 * MB, SHRINK_OVER = 45 * MB;

const argv = process.argv.slice(2), dry = argv.includes('--dry-run');
const [input, wanted] = argv.filter((a) => !a.startsWith('--'));
if (!input) { console.error('Usage: node scripts/upload.mjs <video.mp4 | render-folder> [name] [--dry-run]'); process.exit(1); }
if (!existsSync(input)) { console.error(`Not found: ${input}`); process.exit(1); }
if (!dry && (!URL_BASE || !KEY)) { console.error('No Supabase URL or key. Check config/shelf.json.'); process.exit(1); }

// ---- which files
let files = [], stem;
if (statSync(input).isDirectory()) {
  const dir = resolve(input);
  try { files = JSON.parse(readFileSync(join(dir, 'parts.json'), 'utf8')).map((p) => join(dir, p.file)); } catch { /* no parts.json */ }
  if (!files.length) files = readdirSync(dir).filter((f) => /^(video|part-\d+)\.mp4$/.test(f)).sort().map((f) => join(dir, f));
  if (!files.length) { console.error(`No video.mp4 or part-NN.mp4 in ${dir}. Render first.`); process.exit(1); }
  stem = wanted || basename(dir);
} else { files = [input]; stem = wanted || input; }
stem = basename(stem, extname(stem)).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'clip';

const dims = (f) => {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f], { encoding: 'utf8' });
  const [w, h] = (r.stdout || '').trim().split(',').map(Number);
  return w && h ? { w, h } : null;
};
const d0 = dims(files[0]);
const tag = d0 && d0.w > d0.h && !/16x9/.test(stem) ? '-16x9' : '';
const type = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' };
const nameOf = (f, i) => `${stem}${tag}${files.length > 1 ? `-part-${String(i + 1).padStart(2, '0')}` : ''}${(extname(f) || '.mp4').toLowerCase()}`;

// ---- shrink (only files over 45 MB)
function shrink(file) {
  const small = join(dirname(file), basename(file, extname(file)) + '.small.mp4');
  for (const crf of ['23', '27']) {
    console.log(`  ${basename(file)} is ${(statSync(file).size / MB).toFixed(1)} MB (over 45 MB): re-encoding with ffmpeg (libx264, CRF ${crf}, audio untouched)...`);
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-c:v', 'libx264', '-preset', 'medium', '-crf', crf,
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'copy', small], { stdio: 'inherit' });
    if (r.status !== 0) return null;
    if (statSync(small).size <= LIMIT) return small;
  }
  return small;
}

// ---- go
const headers = { apikey: KEY, 'x-upsert': 'true', 'cache-control': 'max-age=3600' };
if (KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${KEY}`;
let failed = 0; const links = [];
console.log(`${files.length} file(s) -> bucket "${BUCKET}"${dry ? '  (dry run: nothing is encoded or uploaded)' : ''}`);
for (const [i, original] of files.entries()) {
  const name = nameOf(original, i); let file = original;
  const mb = statSync(file).size / MB;
  if (dry) { console.log(`  ${name}  ${mb.toFixed(1)} MB${mb > 45 ? '  -> would be re-encoded first' : ''}`); continue; }
  if (statSync(file).size > SHRINK_OVER) { file = shrink(file); if (!file) { console.error(`  ffmpeg failed on ${basename(original)}.`); failed++; continue; } }
  const size = statSync(file).size;
  if (size > LIMIT) { console.error(`  ${name} is still ${(size / MB).toFixed(1)} MB; the limit is 50 MB. Render with a smaller --part-seconds or a lower mode.`); failed++; continue; }
  let res;
  try {
    res = await fetch(`${URL_BASE}/storage/v1/object/${encodeURIComponent(BUCKET)}/${encodeURIComponent(name)}`, {
      method: 'POST', headers: { ...headers, 'Content-Type': type[extname(name)] || 'video/mp4' }, body: readFileSync(file),
    });
  } catch (e) { console.error(`  Upload of ${name} failed: could not reach Supabase (${e.cause?.code || e.message}).`); failed++; continue; }
  if (!res.ok) { console.error(`  Upload of ${name} failed (status ${res.status}): ${await res.text()}`); failed++; continue; }
  const pub = `${URL_BASE}/storage/v1/object/public/${encodeURIComponent(BUCKET)}/${encodeURIComponent(name)}`;
  console.log(`Uploaded ${name} (${(size / MB).toFixed(1)} MB)`);
  console.log(`Watch:    ${pub}`);
  console.log(`Download: ${pub}?download=${encodeURIComponent(name)}`);
  links.push(`${name}: ${pub}`);
}
if (links.length > 1) console.log(`\nAll parts, in order:\n${links.join('\n')}`);
if (failed) { console.error(`\n${failed} file(s) failed. Report the exact status above to the owner.`); process.exit(1); }
