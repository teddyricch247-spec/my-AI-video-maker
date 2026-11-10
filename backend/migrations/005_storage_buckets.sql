-- 005_storage_buckets.sql  (idempotent)  Private buckets. Existing bucket `uploads` is untouched.
--   renders  : final MP4s (renders/<project_id>/<beat_id>/final.mp4) and export zips
--   previews : strips, wavs, spectrograms (previews/<project_id>/<beat_id>/...)
-- PLAN CAP: the project is on the Supabase FREE plan -> max 50 MB per file (global cap) and 1 GB total storage.
-- Limits below are set to stay inside that: renders 50 MB, previews 10 MB per file. On a paid plan raise them.
-- ROLLBACK: delete from storage.buckets where id in ('renders','previews');  (only when empty)
insert into storage.buckets (id, name, public, file_size_limit)
values ('renders', 'renders', false, 52428800),
       ('previews', 'previews', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;
