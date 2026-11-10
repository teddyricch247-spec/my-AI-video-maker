-- 004_beats_final.sql  (idempotent)  Where the finished MP4 of a beat lives in the `renders` bucket.
-- ROLLBACK: alter table public.beats drop column final_path, drop column final_bytes;
alter table public.beats add column if not exists final_path  text;
alter table public.beats add column if not exists final_bytes bigint;
