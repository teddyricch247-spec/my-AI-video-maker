// Usage: node scripts/upload.mjs <video.mp4 | render-folder> [name] [--folder <session>] [--scene-file <path.js>] [--style 3d|paper] [--dry-run]
// Saves a render (and optionally its scene code to the `scenes` bucket) to Supabase. ONLY run it when the owner asks. One render folder (/tmp/inkbeat-renders/<slug>) uploads all its parts in order.
// Files over 45 MB are re-encoded first (libx264, CRF 23, same resolution, audio untouched). 16:9 files get "-16x9" and Mode 2 files get "-paper" in the name.
// The work is done in skill/inkbeat-shorts/pipeline/publish.mjs (it reads config/shelf.json; env vars and .env.local override).
import './_supabase.mjs';   // loads .env.local / .env into process.env first
import '../skill/inkbeat-shorts/pipeline/publish.mjs';
