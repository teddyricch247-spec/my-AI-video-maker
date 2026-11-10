-- 001_claim_job_limits.sql  (idempotent: CREATE OR REPLACE)
-- Fixes traps 1 and 3 in the original claim_job, which was designed for one backend process:
--   * per-kind concurrency limits come from settings (beat_concurrency, concurrency.director.turn,
--     concurrency.export.build; defaults 27 / 2 / 2 when the key is absent or null) instead of
--     "beat.run = beat_concurrency, everything else = 1".
--   * attempts was incremented twice (stale sweep AND claim), so max_attempts=3 allowed two tries.
--     The claim is now the only place that counts an attempt; the sweep fails a job whose attempts
--     already reached max_attempts.
--   * (small, same function) a stale job that had cancel_requested is finished 'canceled' instead of requeued.
-- Kept: the advisory lock, the kill-switch check, the paused-project filter, ordering, skip locked.
--
-- ROLLBACK: re-run the ORIGINAL definition below.
-- CREATE OR REPLACE FUNCTION public.claim_job(p_worker text, p_kinds text[], p_stale interval DEFAULT '00:01:30'::interval)
--  RETURNS jobs LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
-- AS $function$
-- declare
--   v_job       public.jobs;
--   v_beat_conc int;
-- begin
--   perform pg_advisory_xact_lock(hashtextextended('vbeat.claim_job', 0));
--   update public.jobs j
--      set attempts    = coalesce(j.attempts, 0) + 1,
--          status      = case when coalesce(j.attempts, 0) + 1 >= coalesce(j.max_attempts, 3) then 'failed' else 'queued' end,
--          finished_at = case when coalesce(j.attempts, 0) + 1 >= coalesce(j.max_attempts, 3) then now() else null end,
--          error       = 'stale heartbeat (worker ' || coalesce(j.locked_by, '?') || ')',
--          locked_by   = case when coalesce(j.attempts, 0) + 1 >= coalesce(j.max_attempts, 3) then j.locked_by else null end,
--          locked_at   = case when coalesce(j.attempts, 0) + 1 >= coalesce(j.max_attempts, 3) then j.locked_at else null end,
--          heartbeat_at = case when coalesce(j.attempts, 0) + 1 >= coalesce(j.max_attempts, 3) then j.heartbeat_at else null end
--    where j.status = 'running'
--      and coalesce(j.heartbeat_at, j.locked_at, j.created_at) < now() - p_stale;
--   if coalesce((select (s.value #>> '{}')::boolean from public.settings s where s.key = 'kill_switch'), false) then
--     return null;
--   end if;
--   v_beat_conc := coalesce((select (s.value #>> '{}')::int from public.settings s where s.key = 'beat_concurrency'), 1);
--   select j.* into v_job from public.jobs j
--    where j.status = 'queued' and j.run_after <= now() and j.kind = any(p_kinds)
--      and (j.project_id is null or not exists (select 1 from public.projects p where p.id = j.project_id and coalesce(p.paused, false)))
--      and (select count(*) from public.jobs r where r.status = 'running' and r.kind = j.kind)
--          < (case j.kind when 'beat.run' then v_beat_conc else 1 end)
--    order by coalesce(j.priority, 0) desc, j.run_after, j.id
--    limit 1 for update of j skip locked;
--   if v_job.id is null then return null; end if;
--   update public.jobs set status = 'running', locked_by = p_worker, locked_at = now(), heartbeat_at = now(),
--          attempts = coalesce(attempts, 0) + 1
--    where id = v_job.id returning * into v_job;
--   return v_job;
-- end $function$

create or replace function public.claim_job(p_worker text, p_kinds text[], p_stale interval default '00:01:30'::interval)
 returns jobs
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_job   public.jobs;
  v_beat  int;
  v_dir   int;
  v_exp   int;
begin
  perform pg_advisory_xact_lock(hashtextextended('vbeat.claim_job', 0));

  -- Stale sweep. The attempt was already counted when the job was claimed; do not count it again.
  update public.jobs j
     set status = case when coalesce(j.cancel_requested, false) then 'canceled'
                       when coalesce(j.attempts, 0) >= coalesce(j.max_attempts, 3) then 'failed'
                       else 'queued' end,
         finished_at = case when coalesce(j.cancel_requested, false)
                              or coalesce(j.attempts, 0) >= coalesce(j.max_attempts, 3) then now() else null end,
         error = 'stale heartbeat (worker ' || coalesce(j.locked_by, '?') || ')',
         locked_by = case when coalesce(j.cancel_requested, false)
                            or coalesce(j.attempts, 0) >= coalesce(j.max_attempts, 3) then j.locked_by else null end,
         locked_at = case when coalesce(j.cancel_requested, false)
                            or coalesce(j.attempts, 0) >= coalesce(j.max_attempts, 3) then j.locked_at else null end,
         heartbeat_at = case when coalesce(j.cancel_requested, false)
                               or coalesce(j.attempts, 0) >= coalesce(j.max_attempts, 3) then j.heartbeat_at else null end
   where j.status = 'running'
     and coalesce(j.heartbeat_at, j.locked_at, j.created_at) < now() - p_stale;

  if coalesce((select (s.value #>> '{}')::boolean from public.settings s where s.key = 'kill_switch'), false) then
    return null;
  end if;

  v_beat := coalesce((select (s.value #>> '{}')::int from public.settings s where s.key = 'beat_concurrency'), 27);
  v_dir  := coalesce((select (s.value #>> '{}')::int from public.settings s where s.key = 'concurrency.director.turn'), 2);
  v_exp  := coalesce((select (s.value #>> '{}')::int from public.settings s where s.key = 'concurrency.export.build'), 2);

  select j.* into v_job
    from public.jobs j
   where j.status = 'queued'
     and j.run_after <= now()
     and j.kind = any(p_kinds)
     and (j.project_id is null
          or not exists (select 1 from public.projects p
                          where p.id = j.project_id and coalesce(p.paused, false)))
     and (select count(*) from public.jobs r
           where r.status = 'running' and r.kind = j.kind)
         < (case j.kind when 'beat.run' then v_beat
                        when 'director.turn' then v_dir
                        when 'export.build' then v_exp
                        else 1 end)
   order by coalesce(j.priority, 0) desc, j.run_after, j.id
   limit 1
   for update of j skip locked;

  if v_job.id is null then
    return null;
  end if;

  update public.jobs
     set status = 'running', locked_by = p_worker, locked_at = now(),
         heartbeat_at = now(), attempts = coalesce(attempts, 0) + 1
   where id = v_job.id
  returning * into v_job;

  return v_job;
end $function$;
