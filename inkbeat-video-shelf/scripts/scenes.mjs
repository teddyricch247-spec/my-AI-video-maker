// Manage generated scene code & transcripts in the Supabase "scenes" bucket (keeps the codebase free of generated animations).
// Usage:
//   node scripts/scenes.mjs push <local-file> <remote-path>   e.g. push /tmp/inkbeat-work/story.js warehouse/story.js
//   node scripts/scenes.mjs pull <remote-path> <local-file>   e.g. pull warehouse/story.js /tmp/inkbeat-work/story.js
//   node scripts/scenes.mjs list
//   node scripts/scenes.mjs delete <remote-path> [more...]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname } from 'node:path';
import { SCENES_BUCKET, call, listAll, publicUrl, requireEnv } from './_supabase.mjs';

requireEnv();

const [cmd, ...args] = process.argv.slice(2);

function contentTypeFor(file) {
  const ext = extname(file).toLowerCase();
  if (ext === '.js' || ext === '.mjs') return 'text/javascript';
  if (ext === '.json') return 'application/json';
  if (ext === '.py') return 'text/x-python';
  return 'text/plain';
}

function encodePath(remotePath) {
  return String(remotePath || '')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
}

if (cmd === 'push') {
  const [localFile, remotePath] = args;
  if (!localFile || !remotePath) {
    console.error('Usage: node scripts/scenes.mjs push <local-file> <remote-path>');
    process.exit(1);
  }
  if (!existsSync(localFile)) {
    console.error(`File not found: ${localFile}`);
    process.exit(1);
  }
  const encoded = encodePath(remotePath);
  const res = await call(`/object/${encodeURIComponent(SCENES_BUCKET)}/${encoded}`, {
    method: 'POST',
    headers: { 'Content-Type': contentTypeFor(localFile), 'x-upsert': 'true' },
    body: readFileSync(localFile),
  });
  if (!res.ok) {
    const msg = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    if (res.status === 404 || /Bucket not found/i.test(msg)) {
      console.error(`Supabase "${SCENES_BUCKET}" bucket does not exist yet. Run the section 2 SQL in supabase/setup.sql in your Supabase SQL Editor first.`);
    } else {
      console.error(`Scene upload failed (status ${res.status}): ${msg}`);
    }
    process.exit(1);
  }
  console.log(`Saved scene -> ${SCENES_BUCKET}/${remotePath}`);
  console.log(`URL: ${publicUrl(remotePath, SCENES_BUCKET)}`);
} else if (cmd === 'pull') {
  const [remotePath, destFile] = args;
  if (!remotePath || !destFile) {
    console.error('Usage: node scripts/scenes.mjs pull <remote-path> <local-file>');
    process.exit(1);
  }
  const res = await fetch(publicUrl(remotePath, SCENES_BUCKET));
  if (!res.ok) {
    console.error(`Could not download ${SCENES_BUCKET}/${remotePath} (status ${res.status}).`);
    process.exit(1);
  }
  mkdirSync(dirname(destFile), { recursive: true });
  writeFileSync(destFile, Buffer.from(await res.arrayBuffer()));
  console.log(`Pulled ${SCENES_BUCKET}/${remotePath} -> ${destFile}`);
} else if (cmd === 'list') {
  const items = await listAll(SCENES_BUCKET);
  if (!items.length) console.log(`Bucket "${SCENES_BUCKET}" is empty (or not created yet).`);
  for (const i of items) {
    console.log(`${i.name}  ${i.created_at || ''}\n  ${publicUrl(i.name, SCENES_BUCKET)}`);
  }
} else if (cmd === 'delete') {
  if (!args.length) {
    console.error('Usage: node scripts/scenes.mjs delete <remote-path> [...]');
    process.exit(1);
  }
  const r = await call(`/object/${encodeURIComponent(SCENES_BUCKET)}`, {
    method: 'DELETE',
    json: { prefixes: args },
  });
  if (!r.ok) {
    console.error(`Delete failed (status ${r.status}): ${JSON.stringify(r.data)}`);
    process.exit(1);
  }
  console.log(`Deleted from ${SCENES_BUCKET}: ${args.join(', ')}`);
} else {
  console.error('Usage: node scripts/scenes.mjs <push|pull|list|delete> ...');
  process.exit(1);
}
