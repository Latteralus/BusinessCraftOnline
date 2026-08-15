-- Schedule the new tick-npc-market-purchases edge function and seed its
-- subtick state row. Uses a distinct state_key ('open_market') in the existing
-- npc_market_subtick_state table so it advances independently of the
-- storefront NPC tick's 'global' row.

insert into public.npc_market_subtick_state (state_key, tick_window_started_at, sub_tick_index)
values ('open_market', now(), 0)
on conflict (state_key) do nothing;

DO $$
BEGIN
  PERFORM cron.unschedule('tick-npc-market-purchases');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

-- Same cadence as tick-npc-purchases (60s, pg_cron's minimum granularity) —
-- the "much lower rate" this feature calls for is achieved by shopper volume
-- (NPC_OPEN_MARKET_SHOPPERS_PER_SUBTICK_BASE) and item eligibility, not by
-- running less often.
SELECT cron.schedule(
  'tick-npc-market-purchases',
  '* * * * *',
  $$ SELECT invoke_edge_function('tick-npc-market-purchases') $$
);
