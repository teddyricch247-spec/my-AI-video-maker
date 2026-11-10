-- 007_settings.sql  (idempotent; never overwrites a value the operator changed)
--   beat_concurrency: 1 (old single-process default) -> 27 (9 workers x 3 slots). Any other value is left alone.
--   caps.beat_usd = 0.5 added only when absent; run_usd / daily_usd / max_steps / max_minutes preserved.
-- ROLLBACK: update settings set value='1' where key='beat_concurrency';
--           update settings set value = value - 'beat_usd' where key='caps';
update public.settings set value = '27'::jsonb
 where key = 'beat_concurrency' and (value #>> '{}') = '1';

update public.settings set value = value || '{"beat_usd": 0.5}'::jsonb
 where key = 'caps' and not (value ? 'beat_usd');
