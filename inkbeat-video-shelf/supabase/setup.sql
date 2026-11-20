-- Already applied to project oblzunlbkmifwbpqvzis (inkbeat-video-shelf).
-- Kept here so the shelf can be rebuilt on a new Supabase project:
-- paste into the SQL editor, then put the new URL and publishable key in config/shelf.json.
-- Public bucket, open read/write for the publishable (anon) key. Fine for a private toy shelf.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('videos', 'videos', true, 52428800, array['video/mp4','video/webm','video/quicktime'])
on conflict (id) do update set public = true, file_size_limit = 52428800,
  allowed_mime_types = array['video/mp4','video/webm','video/quicktime'];

create policy "videos open read"   on storage.objects for select to anon, authenticated using (bucket_id = 'videos');
create policy "videos open insert" on storage.objects for insert to anon, authenticated with check (bucket_id = 'videos');
create policy "videos open update" on storage.objects for update to anon, authenticated using (bucket_id = 'videos') with check (bucket_id = 'videos');
create policy "videos open delete" on storage.objects for delete to anon, authenticated using (bucket_id = 'videos');
