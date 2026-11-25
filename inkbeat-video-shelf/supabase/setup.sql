-- Applied to project oblzunlbkmifwbpqvzis (inkbeat-video-shelf).
-- Kept here so the shelf can be rebuilt on a new Supabase project:
-- paste into the SQL editor, then put the new URL and publishable key in config/shelf.json.
-- Public buckets, open read/write for the publishable (anon) key.

-- 1) Videos bucket (already applied)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('videos', 'videos', true, 52428800, array['video/mp4','video/webm','video/quicktime'])
on conflict (id) do update set public = true, file_size_limit = 52428800,
  allowed_mime_types = array['video/mp4','video/webm','video/quicktime'];

drop policy if exists "videos open read" on storage.objects;
drop policy if exists "videos open insert" on storage.objects;
drop policy if exists "videos open update" on storage.objects;
drop policy if exists "videos open delete" on storage.objects;

create policy "videos open read"   on storage.objects for select to anon, authenticated using (bucket_id = 'videos');
create policy "videos open insert" on storage.objects for insert to anon, authenticated with check (bucket_id = 'videos');
create policy "videos open update" on storage.objects for update to anon, authenticated using (bucket_id = 'videos') with check (bucket_id = 'videos');
create policy "videos open delete" on storage.objects for delete to anon, authenticated using (bucket_id = 'videos');

-- 2) Scenes bucket (run this in Supabase SQL Editor so generated scene .js & transcript files are stored in Supabase instead of the codebase)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scenes', 'scenes', true, 5242880, array['text/javascript','application/javascript','application/json','text/plain','text/x-python','application/octet-stream'])
on conflict (id) do update set public = true, file_size_limit = 5242880,
  allowed_mime_types = array['text/javascript','application/javascript','application/json','text/plain','text/x-python','application/octet-stream'];

drop policy if exists "scenes open read" on storage.objects;
drop policy if exists "scenes open insert" on storage.objects;
drop policy if exists "scenes open update" on storage.objects;
drop policy if exists "scenes open delete" on storage.objects;

create policy "scenes open read"   on storage.objects for select to anon, authenticated using (bucket_id = 'scenes');
create policy "scenes open insert" on storage.objects for insert to anon, authenticated with check (bucket_id = 'scenes');
create policy "scenes open update" on storage.objects for update to anon, authenticated using (bucket_id = 'scenes') with check (bucket_id = 'scenes');
create policy "scenes open delete" on storage.objects for delete to anon, authenticated using (bucket_id = 'scenes');
