// Checks the shelf is connected. The "videos" bucket already exists on the project (see supabase/setup.sql).
// If the bucket is missing and you are using a service key, this creates it. Safe to run again.
import { BUCKET, MAX_BYTES, URL_BASE, call, requireEnv } from './_supabase.mjs';
requireEnv();

const listing = () => call(`/object/list/${encodeURIComponent(BUCKET)}`, {
  method: 'POST',
  json: { prefix: '', limit: 1, offset: 0 },
});

let r = await listing();
if (r.ok) {
  console.log(`Connected to ${URL_BASE}. Bucket "${BUCKET}" is ready.`);
  process.exit(0);
}

console.log(`Bucket "${BUCKET}" not reachable (status ${r.status}). Trying to create it...`);
r = await call('/bucket', {
  method: 'POST',
  json: {
    id: BUCKET, name: BUCKET, public: true, file_size_limit: MAX_BYTES,
    allowed_mime_types: ['video/mp4', 'video/webm', 'video/quicktime'],
  },
});
if (r.ok) {
  console.log(`Created public bucket "${BUCKET}". Note: with a publishable key you also need the policies in supabase/setup.sql.`);
} else {
  console.error(`Could not create it (status ${r.status}): ${JSON.stringify(r.data)}`);
  console.error('Run supabase/setup.sql in the Supabase SQL editor, then try again.');
  process.exit(1);
}
