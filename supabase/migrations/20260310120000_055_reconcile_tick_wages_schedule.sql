-- Reconcile hosted environments that may still have the legacy hourly wage cron.
-- This is safe to run repeatedly and forces tick-wages onto the intended 15-minute cadence.

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

-- Migration complete: tick-wages schedule reconciled to every 15 minutes
