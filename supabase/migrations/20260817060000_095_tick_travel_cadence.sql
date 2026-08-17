-- Partially applies architectural recommendation #6 (Documents/SBAudit.md):
-- re-examine whether the 1-minute-cadence tick functions actually need it.
--
-- tick-travel only sweeps for wall-clock-due travel arrivals
-- (execute_due_travel_arrivals) -- it has no per-tick output accumulator, so
-- slowing its cadence doesn't change any game-balance number, only how
-- promptly a completed trip is recognized after its real arrival time.
-- Against travel durations of 30-360 minutes (src/domains/cities-travel/topology.ts),
-- a couple of extra minutes of recognition lag is negligible.
--
-- tick-extraction, tick-manufacturing, tick-npc-purchases, and
-- tick-npc-market-purchases are deliberately NOT touched here: their output
-- is driven by a per-invocation progress accumulator or subtick counter, not
-- wall-clock time, so slowing their cadence would silently cut production/
-- NPC-shopper volume rather than just cost. That needs a coordinated
-- rebalance (e.g. scaling EXTRACTION_BASE_OUTPUT_PER_TICK_BY_BUSINESS or
-- NPC_SHOPPERS_PER_SUBTICK_BASE to compensate), which is an economy-balance
-- change, not a pure cost optimization -- out of scope for this pass.

DO $$
BEGIN
  PERFORM cron.unschedule('tick-travel');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

SELECT cron.schedule('tick-travel', '*/2 * * * *', $$ SELECT invoke_edge_function('tick-travel') $$);
