-- CityPlan Phase 2: schedule tick-government-daily. Time of day is
-- arbitrary (06:00 UTC, a low-traffic window) -- the RPC itself is the
-- actual idempotency guard (run_government_daily_update, migration 112), so
-- this cadence only controls how soon after economic-day rollover the
-- update actually fires, not correctness.

DO $$
BEGIN
  PERFORM cron.unschedule('tick-government-daily');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

SELECT cron.schedule('tick-government-daily', '0 6 * * *', $$ SELECT invoke_edge_function('tick-government-daily') $$);
