-- CityPlan Phase 3: schedule tick-city-stockpiles. Every 5 minutes, matching
-- tick-shipping's cadence -- this is a pure due-time sweep driven by the
-- indexed next_reorder_at column (materialize_city_stockpiles_due, migration
-- 114), not a per-tick output accumulator, so this cadence only controls how
-- promptly a threshold crossing is recognized, not any balance number.

DO $$
BEGIN
  PERFORM cron.unschedule('tick-city-stockpiles');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

SELECT cron.schedule('tick-city-stockpiles', '*/5 * * * *', $$ SELECT invoke_edge_function('tick-city-stockpiles') $$);
