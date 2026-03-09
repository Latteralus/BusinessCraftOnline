-- Phase 1 economy rebalance:
-- - manufacturing tick cadence
-- - upgrade definition economics

DO $$
BEGIN
  PERFORM cron.unschedule('tick-manufacturing');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

SELECT cron.schedule(
  'tick-manufacturing',
  '*/5 * * * *',
  $$ SELECT invoke_edge_function('tick-manufacturing') $$
);

update public.upgrade_definitions
set
  base_cost = 500,
  base_effect = 1.12,
  updated_at = now()
where upgrade_key = 'extraction_efficiency';

update public.upgrade_definitions
set
  base_cost = 800,
  base_effect = 1.15,
  updated_at = now()
where upgrade_key = 'tool_durability';

update public.upgrade_definitions
set
  base_cost = 400,
  base_effect = 1.12,
  updated_at = now()
where upgrade_key = 'crop_yield';

update public.upgrade_definitions
set
  base_cost = 500,
  updated_at = now()
where upgrade_key = 'water_efficiency';

update public.upgrade_definitions
set
  base_cost = 600,
  base_effect = 1.15,
  updated_at = now()
where upgrade_key = 'production_efficiency';
