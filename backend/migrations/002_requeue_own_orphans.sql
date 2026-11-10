-- 002_requeue_own_orphans.sql  (idempotent)
-- NEVER call the old requeue_orphans(p_worker): it requeues every running job owned by ANYONE ELSE,
-- which with several workers steals live work. This one touches only jobs locked by THIS stable worker id
-- from a previous life (the worker just started, so it cannot be running them).
--   cancel_requested        -> canceled
--   attempts >= max_attempts -> failed (a job that keeps killing its worker must not loop forever)
--   otherwise                -> queued again (lock cleared)
-- Returns the number of jobs touched.
-- ROLLBACK: drop function public.requeue_own_orphans(text);
create or replace function public.requeue_own_orphans(p_worker text)
 returns integer
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_n int;
begin
  update public.jobs j
     set status = case when coalesce(j.cancel_requested, false) then 'canceled'
                       when coalesce(j.attempts, 0) >= coalesce(j.max_attempts, 3) then 'failed'
                       else 'queued' end,
         finished_at = case when coalesce(j.cancel_requested, false)
                              or coalesce(j.attempts, 0) >= coalesce(j.max_attempts, 3) then now() else null end,
         error = 'worker ' || p_worker || ' restarted while running this job',
         locked_by = case when coalesce(j.cancel_requested, false)
                            or coalesce(j.attempts, 0) >= coalesce(j.max_attempts, 3) then j.locked_by else null end,
         locked_at = case when coalesce(j.cancel_requested, false)
                            or coalesce(j.attempts, 0) >= coalesce(j.max_attempts, 3) then j.locked_at else null end,
         heartbeat_at = case when coalesce(j.cancel_requested, false)
                               or coalesce(j.attempts, 0) >= coalesce(j.max_attempts, 3) then j.heartbeat_at else null end
   where j.status = 'running' and j.locked_by = p_worker;
  get diagnostics v_n = row_count;
  return v_n;
end $function$;

revoke all on function public.requeue_own_orphans(text) from public, anon, authenticated;
grant execute on function public.requeue_own_orphans(text) to service_role;
