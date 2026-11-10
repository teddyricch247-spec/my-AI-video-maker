-- 003_workers.sql  (idempotent)
-- One row per worker, upserted by the worker every 10 s (heartbeat for the Ops page).
-- ROLLBACK: drop table public.workers;
create table if not exists public.workers (
  id        text primary key,
  role      text,
  url       text,
  slots     int,
  running   int,
  heavy     int,
  version   text,
  last_seen timestamptz,
  info      jsonb
);
alter table public.workers enable row level security;   -- no policies: only the service role / postgres connect
