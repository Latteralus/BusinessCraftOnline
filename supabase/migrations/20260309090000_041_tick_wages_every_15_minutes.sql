-- Phase 23: align wage cron cadence with 15-minute payroll windows.

DO $$
BEGIN
  PERFORM cron.unschedule('tick-wages');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

SELECT cron.schedule(
  'tick-wages',
  '*/15 * * * *',
  $$ SELECT invoke_edge_function('tick-wages') $$
);

-- Migration complete: tick-wages now runs every 15 minutes
