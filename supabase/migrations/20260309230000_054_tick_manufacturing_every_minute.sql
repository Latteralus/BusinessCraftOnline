-- Align manufacturing with the minute-based production cadence.

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
