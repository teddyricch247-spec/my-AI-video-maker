// Usage: node scripts/list.mjs
import { listAll, publicUrl, requireEnv } from './_supabase.mjs';
requireEnv();
const items = await listAll();
if (!items.length) console.log('The shelf is empty.');
for (const i of items) {
  const mb = i.metadata?.size ? `${(i.metadata.size / 1048576).toFixed(1)} MB` : '?';
  console.log(`${i.name}  ${mb}  ${i.created_at || ''}\n  ${publicUrl(i.name)}`);
}
