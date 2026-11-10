-- 006_spend_functions.sql  (idempotent)
-- spend_today(tz): sum of cost_events.usd since local midnight in tz (e.g. 'Europe/Berlin'; null/'' -> UTC).
-- project_spend(project): sum of cost_events.usd for a project.
-- ROLLBACK: drop function public.spend_today(text); drop function public.project_spend(uuid);
create or replace function public.spend_today(p_tz text default 'UTC')
 returns numeric
 language sql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(sum(usd), 0)::numeric
    from public.cost_events
   where created_at >= (date_trunc('day', now() at time zone coalesce(nullif(p_tz, ''), 'UTC'))
                        at time zone coalesce(nullif(p_tz, ''), 'UTC'));
$function$;

create or replace function public.project_spend(p_project uuid)
 returns numeric
 language sql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(sum(usd), 0)::numeric from public.cost_events where project_id = p_project;
$function$;

revoke all on function public.spend_today(text) from public, anon, authenticated;
revoke all on function public.project_spend(uuid) from public, anon, authenticated;
grant execute on function public.spend_today(text) to service_role;
grant execute on function public.project_spend(uuid) to service_role;
