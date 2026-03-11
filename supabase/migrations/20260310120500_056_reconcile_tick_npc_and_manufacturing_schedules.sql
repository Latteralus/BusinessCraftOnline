-- Reconcile hosted environments that may still have legacy cron cadences
-- for NPC purchases and manufacturing.

DO $$
BEGIN
  PERFORM cron.unschedule('tick-npc-purchases');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

SELECT cron.schedule(
  'tick-npc-purchases',
  '* * * * *',
  $$ SELECT invoke_edge_function('tick-npc-purchases') $$
);

DO $$
BEGIN
  PERFORM cron.unschedule('tick-manufacturing');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

SELECT cron.schedule(
  'tick-manufacturing',
  '* * * * *',
  $$ SELECT invoke_edge_function('tick-manufacturing') $$
);

-- Migration complete: npc purchase and manufacturing schedules reconciled
