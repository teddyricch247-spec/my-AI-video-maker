// Save finished Mode 2 (inkbeat-paper) video(s) to the Supabase shelf and print links.
// ONLY run when the owner asks to save/upload.
// Delegates to the shared publisher with --style paper defaulted unless --style is passed explicitly.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const shared = resolve(here, '../../inkbeat-shorts/pipeline/publish.mjs');
const args = process.argv.slice(2);
const hasStyle = args.some((a) => a === '--style' || a.startsWith('--style='));
const finalArgs = hasStyle ? args : [...args, '--style', 'paper'];

const res = spawnSync(process.execPath, [shared, ...finalArgs], { stdio: 'inherit' });
process.exit(res.status ?? 1);
