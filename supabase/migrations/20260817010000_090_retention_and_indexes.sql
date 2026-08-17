-- Resolves audit findings H8, M9 (Documents/SBAudit.md) and architectural
-- recommendation #5.

-- ---------------------------------------------------------------------------
-- M9: manufacturing_lines has no index on the columns tick-manufacturing's
-- retool pass filters every minute (pending_recipe_key is not null and
-- retool_complete_at <= now()).
-- ---------------------------------------------------------------------------

create index if not exists idx_manufacturing_lines_retool_ready
  on public.manufacturing_lines (retool_complete_at)
  where pending_recipe_key is not null and retool_complete_at is not null;

-- ---------------------------------------------------------------------------
-- H4 support: tick-wages now filters employees to status <> 'fired'
-- (fired employees can never be charged again). A partial index matching
-- that filter + the existing created_at ordering keeps the scan cheap as
-- the fired-but-retained employee history grows.
-- ---------------------------------------------------------------------------

create index if not exists idx_employees_active_created
  on public.employees (created_at)
  where status <> 'fired';

-- ---------------------------------------------------------------------------
-- H8: no retention job existed anywhere for the append-only/per-tick-write
-- tables, so tick_run_logs and market_storefront_performance_snapshots grow
-- forever toward the Free-tier storage cap.
--
-- tick_run_logs is operational/debug data only -- 14 days is generous for
-- diagnosing a stuck tick. market_storefront_performance_snapshots backs the
-- finance dashboard's period views, whose longest window is "30d"
-- (src/domains/businesses/finance.ts getPeriodRanges) -- 35 days keeps a
-- safety margin so the oldest days of that view are never mid-deletion.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  PERFORM cron.unschedule('retention-tick-run-logs');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

DO $$
BEGIN
  PERFORM cron.unschedule('retention-storefront-performance-snapshots');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

SELECT cron.schedule(
  'retention-tick-run-logs',
  '17 3 * * *',
  $$ DELETE FROM public.tick_run_logs WHERE started_at < now() - interval '14 days' $$
);

SELECT cron.schedule(
  'retention-storefront-performance-snapshots',
  '23 3 * * *',
  $$ DELETE FROM public.market_storefront_performance_snapshots WHERE captured_at < now() - interval '35 days' $$
);
