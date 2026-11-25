// Usage: node scripts/delete.mjs <name.mp4> [more names...]   |   node scripts/delete.mjs --all
import { BUCKET, call, listAll, requireEnv } from './_supabase.mjs';
requireEnv();

const args = process.argv.slice(2);
if (!args.length) { console.error('Usage: node scripts/delete.mjs <name.mp4> [...]  or  --all'); process.exit(1); }

const names = args.includes('--all') ? (await listAll()).map((i) => i.name) : args;
if (!names.length) { console.log('Nothing to delete.'); process.exit(0); }

const r = await call(`/object/${encodeURIComponent(BUCKET)}`, { method: 'DELETE', json: { prefixes: names } });
if (!r.ok) { console.error(`Delete failed (status ${r.status}): ${JSON.stringify(r.data)}`); process.exit(1); }
console.log(`Deleted ${Array.isArray(r.data) ? r.data.length : names.length} file(s): ${names.join(', ')}`);
