-- Align NPC purchase tick cadence with sub-tick model.
-- pg_cron has minute granularity, so run every minute instead of every 10 minutes.

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

