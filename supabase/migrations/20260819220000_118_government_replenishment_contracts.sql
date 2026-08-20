-- CityPlan Phase 4: Government Procurement Contracts, part 2 -- automatic
-- municipal replenishment. Per Documents/Plans/CityPlan.md ("Phase 4"):
--
--   if (currentStock <= reorderPoint && !equivalentActiveContract) {
--     requestedQuantity = targetQuantity - currentStock;
--     createReplenishmentContract();
--   }
--
-- "Run this from an indexed due-threshold process using next_reorder_at, and
-- also re-check immediately after relevant stock delivery/materialization.
-- The check must be transactional/idempotent so concurrent workers cannot
-- create duplicate contracts." The idempotency half is enforced structurally
-- by migration 117's partial unique index on (stockpile_id) -- every insert
-- below goes through that same ON CONFLICT ... DO NOTHING target, so this is
-- safe under concurrent callers without any extra locking.
--
-- Three entry points, one shared creation function:
--   1. create_replenishment_contracts_for_due_stockpiles() -- the core,
--      reusable set-based sweep. Only considers stockpiles whose
--      next_reorder_at has already passed (via the same partial index
--      city_stockpiles already has for its own due sweep, migration 114).
--   2. materialize_and_replenish_city_stockpiles_due() -- the tick wrapper:
--      materialize first (so stored_quantity/quantity_requested reflect
--      current elapsed-time depletion, not a stale checkpoint), then create
--      contracts for whatever is still due. tick-city-stockpiles is updated
--      to call this instead of materialize_city_stockpiles_due directly, so
--      the due-index sweep (every 5 minutes) is the primary automation path.
--   3. run_government_daily_update() -- re-check ("daily maintenance pass"
--      is explicitly one of Phase 3's four valid materialization triggers)
--      after its own full materialize_all_active_city_stockpiles() sweep,
--      since that's the point where municipal consumption indices can move
--      and push additional stockpiles below their reorder point.
--
-- Pricing note: government_contracts.unit_price for auto-created
-- replenishment contracts uses a small hand-mirrored copy of
-- shared/economy.ts's NPC_PRICE_CEILINGS below (_government_item_base_price)
-- -- plpgsql can't import the TS module, and city_stockpiles is permanently
-- fixed to Phase 1/3's 9 raw-resource keys, so this is the same
-- "kept in sync by hand" tradeoff shared/cities/stockpiles.ts already
-- documents for its own SQL mirror. Keep the two in sync if NPC_PRICE_CEILINGS
-- changes for any of these 9 keys.

-- ---------------------------------------------------------------------------
-- 1. _government_item_base_price
-- ---------------------------------------------------------------------------

create or replace function public._government_item_base_price(p_item_key text)
returns numeric
language sql
immutable
as $$
  select case p_item_key
    when 'water' then 5.0
    when 'iron_ore' then 10.0
    when 'coal' then 10.0
    when 'copper_ore' then 10.0
    when 'raw_wood' then 10.0
    when 'crude_oil' then 35.0
    when 'wheat' then 12.5
    when 'potato' then 12.5
    when 'red_grape' then 15.0
    else 10.0
  end;
$$;

-- Not SECURITY DEFINER and never called directly -- only nested inside
-- create_replenishment_contracts_for_due_stockpiles below, which (like every
-- other SECURITY DEFINER function calling compute_inventory_cost_relief/
-- addition, migration 099) runs as its owning role (postgres), so it needs
-- no explicit grant of its own -- revoking from PUBLIC is enough to block
-- direct anon/authenticated calls, matching 099's exact pattern for its two
-- similarly pure, nested-only SQL helpers.
revoke all on function public._government_item_base_price(text) from public;

-- ---------------------------------------------------------------------------
-- 2. create_replenishment_contracts_for_due_stockpiles
-- ---------------------------------------------------------------------------

create or replace function public.create_replenishment_contracts_for_due_stockpiles(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created integer;
begin
  with due as (
    select *
    from public.city_stockpiles
    where is_active and next_reorder_at is not null and next_reorder_at <= now()
    order by next_reorder_at
    limit greatest(1, least(coalesce(p_limit, 500), 2000))
  ),
  candidates as (
    select
      gp.id as provider_id,
      due.city_id,
      due.id as stockpile_id,
      due.item_key,
      greatest(due.target_quantity - due.stored_quantity, 0) as quantity_requested,
      due.minimum_quality,
      public._government_item_base_price(due.item_key) as unit_price,
      case
        when due.stored_quantity <= due.critical_point then 'critical'
        when due.stored_quantity <= due.reorder_point then 'low'
        else 'normal'
      end as urgency
    from due
    join public.government_contract_providers gp
      on gp.city_id = due.city_id and gp.provider_type = 'city' and gp.is_active
    where greatest(due.target_quantity - due.stored_quantity, 0) > 0
  )
  insert into public.government_contracts (
    provider_id, city_id, stockpile_id, contract_type, item_key,
    quantity_requested, quantity_delivered, minimum_quality, unit_price, total_value,
    status, urgency, posted_at
  )
  select
    provider_id, city_id, stockpile_id, 'replenishment', item_key,
    quantity_requested, 0, minimum_quality, unit_price, quantity_requested * unit_price,
    'available', urgency, now()
  from candidates
  on conflict (stockpile_id) where stockpile_id is not null and status in ('available', 'awarded', 'in_progress') do nothing;

  get diagnostics v_created = row_count;

  return jsonb_build_object('ok', true, 'contractsCreated', v_created);
end;
$$;

revoke all on function public.create_replenishment_contracts_for_due_stockpiles(integer) from public, anon, authenticated, service_role;
grant execute on function public.create_replenishment_contracts_for_due_stockpiles(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3. materialize_and_replenish_city_stockpiles_due -- tick-city-stockpiles'
--    new single RPC call (materialize, then replenish what's still due),
--    keeping the edge function's existing one-RPC-call shape.
-- ---------------------------------------------------------------------------

create or replace function public.materialize_and_replenish_city_stockpiles_due(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_processed integer;
  v_created integer;
begin
  select coalesce((public.materialize_city_stockpiles_due(p_limit) ->> 'processed')::integer, 0)
  into v_processed;

  select coalesce((public.create_replenishment_contracts_for_due_stockpiles(p_limit) ->> 'contractsCreated')::integer, 0)
  into v_created;

  return jsonb_build_object('ok', true, 'processed', v_processed, 'contractsCreated', v_created);
end;
$$;

revoke all on function public.materialize_and_replenish_city_stockpiles_due(integer) from public, anon, authenticated, service_role;
grant execute on function public.materialize_and_replenish_city_stockpiles_due(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 4. run_government_daily_update() -- re-check replenishment after the daily
--    full stockpile sweep. Full create-or-replace (unchanged from migration
--    115 except the final block), same evolutionary pattern already used
--    across 112/115 for this function.
-- ---------------------------------------------------------------------------

create or replace function public.run_government_daily_update()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_day bigint := floor(extract(epoch from now()) / 86400)::bigint;
  v_world_day bigint;
  v_world_events_ended integer := 0;
  v_city_events_ended integer := 0;
  v_world_events_started integer := 0;
  v_city_events_started integer := 0;
  v_cities_processed integer := 0;
  v_stockpiles_materialized integer := 0;
  v_contracts_created integer := 0;
  v_world_labor_mult numeric;
  v_world_consumer_mult numeric;
  v_world_municipal_mult numeric;
  v_world_transport_mult numeric;
  v_world_inflation_mult numeric;
begin
  -- Lock the singleton row so a second concurrent call blocks here and then
  -- sees the already-advanced economic_day once this transaction commits.
  select economic_day into v_world_day
  from public.world_economic_state
  where id = 1
  for update;

  if v_world_day is not null and v_world_day >= v_current_day then
    return jsonb_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'already_updated_today',
      'economicDay', v_world_day
    );
  end if;

  -- End expired events first, then start due-and-not-yet-expired ones, so an
  -- event that both ends and a replacement that starts on the same day are
  -- both reflected before indices are recomputed below.
  update public.world_events
  set is_active = false
  where is_active = true and ends_at <= now();
  get diagnostics v_world_events_ended = row_count;

  update public.city_events
  set is_active = false
  where is_active = true and ends_at <= now();
  get diagnostics v_city_events_ended = row_count;

  update public.world_events
  set is_active = true
  where is_active = false and starts_at <= now() and ends_at > now();
  get diagnostics v_world_events_started = row_count;

  update public.city_events
  set is_active = true
  where is_active = false and starts_at <= now() and ends_at > now();
  get diagnostics v_city_events_started = row_count;

  -- World indices: neutral baseline (1.0) compounded by every currently
  -- active world event's multiplier for that key, clamped to a sane range.
  -- No cross-city aggregation feeds into these yet (Phase 2 has no
  -- production/employment signal wired in) -- see CityPlan.md Phase 2 notes.
  select
    coalesce(product_agg((modifiers->>'labor_index')::numeric) filter (where modifiers ? 'labor_index'), 1),
    coalesce(product_agg((modifiers->>'consumer_demand_index')::numeric) filter (where modifiers ? 'consumer_demand_index'), 1),
    coalesce(product_agg((modifiers->>'municipal_consumption_index')::numeric) filter (where modifiers ? 'municipal_consumption_index'), 1),
    coalesce(product_agg((modifiers->>'transport_cost_index')::numeric) filter (where modifiers ? 'transport_cost_index'), 1),
    coalesce(product_agg((modifiers->>'inflation_index')::numeric) filter (where modifiers ? 'inflation_index'), 1)
  into
    v_world_labor_mult, v_world_consumer_mult, v_world_municipal_mult,
    v_world_transport_mult, v_world_inflation_mult
  from public.world_events
  where is_active = true;

  update public.world_economic_state
  set
    labor_index = greatest(0.5, least(2.0, v_world_labor_mult)),
    consumer_demand_index = greatest(0.5, least(2.0, v_world_consumer_mult)),
    municipal_consumption_index = greatest(0.5, least(2.0, v_world_municipal_mult)),
    transport_cost_index = greatest(0.5, least(2.0, v_world_transport_mult)),
    inflation_index = greatest(0.5, least(2.0, v_world_inflation_mult)),
    economic_day = v_current_day,
    last_government_update_at = now(),
    updated_at = now()
  where id = 1;

  -- City indices, set-based across every active city in one UPDATE ... FROM.
  -- Population drifts by the city's own stored population_growth_index
  -- (default 1.0 = flat) further compounded by any active "population"
  -- event multiplier for that city (not persisted into the stored growth
  -- index, so it reverts automatically once the event ends). Labor supply
  -- and consumer/municipal demand track the resulting population ratio
  -- against the city's static population_baseline (Phase 1); labor demand
  -- and economic activity fold in the freshly recomputed world.labor_index
  -- since there is no per-city employment/production demand signal yet.
  with city_event_mults as (
    select
      city_id,
      coalesce(product_agg((modifiers->>'population')::numeric) filter (where modifiers ? 'population'), 1) as population_mult,
      coalesce(product_agg((modifiers->>'labor_supply')::numeric) filter (where modifiers ? 'labor_supply'), 1) as labor_supply_mult,
      coalesce(product_agg((modifiers->>'labor_demand')::numeric) filter (where modifiers ? 'labor_demand'), 1) as labor_demand_mult,
      coalesce(product_agg((modifiers->>'consumer_demand')::numeric) filter (where modifiers ? 'consumer_demand'), 1) as consumer_demand_mult,
      coalesce(product_agg((modifiers->>'municipal_consumption')::numeric) filter (where modifiers ? 'municipal_consumption'), 1) as municipal_consumption_mult,
      coalesce(product_agg((modifiers->>'economic_activity')::numeric) filter (where modifiers ? 'economic_activity'), 1) as economic_activity_mult
    from public.city_events
    where is_active = true
    group by city_id
  ),
  computed as (
    select
      c.id as city_id,
      greatest(0, round(ces.population * ces.population_growth_index * coalesce(cem.population_mult, 1)))::bigint as new_population,
      c.population_baseline,
      coalesce(cem.labor_supply_mult, 1) as labor_supply_mult,
      coalesce(cem.labor_demand_mult, 1) as labor_demand_mult,
      coalesce(cem.consumer_demand_mult, 1) as consumer_demand_mult,
      coalesce(cem.municipal_consumption_mult, 1) as municipal_consumption_mult,
      coalesce(cem.economic_activity_mult, 1) as economic_activity_mult
    from public.cities c
    join public.city_economic_state ces on ces.city_id = c.id
    left join city_event_mults cem on cem.city_id = c.id
    where c.is_active
  )
  update public.city_economic_state ces
  set
    population = computed.new_population,
    labor_supply_index = greatest(0.25, least(3.0,
      case when coalesce(computed.population_baseline, 0) > 0
        then (computed.new_population::numeric / computed.population_baseline) * computed.labor_supply_mult
        else computed.labor_supply_mult
      end
    )),
    labor_demand_index = greatest(0.25, least(3.0,
      coalesce((select labor_index from public.world_economic_state where id = 1), 1) * computed.labor_demand_mult
    )),
    consumer_demand_index = greatest(0.25, least(3.0,
      case when coalesce(computed.population_baseline, 0) > 0
        then (computed.new_population::numeric / computed.population_baseline) * computed.consumer_demand_mult
        else computed.consumer_demand_mult
      end
    )),
    municipal_consumption_index = greatest(0.25, least(3.0,
      case when coalesce(computed.population_baseline, 0) > 0
        then (computed.new_population::numeric / computed.population_baseline) * computed.municipal_consumption_mult
        else computed.municipal_consumption_mult
      end
    )),
    economic_activity_index = greatest(0.25, least(3.0,
      ((
        case when coalesce(computed.population_baseline, 0) > 0
          then (computed.new_population::numeric / computed.population_baseline)
          else 1
        end
      ) * 0.5 + coalesce((select labor_index from public.world_economic_state where id = 1), 1) * 0.5)
      * computed.economic_activity_mult
    )),
    economic_day = v_current_day,
    last_government_update_at = now(),
    updated_at = now()
  from computed
  where computed.city_id = ces.city_id;

  get diagnostics v_cities_processed = row_count;

  -- Force-materialize every active stockpile now that municipal consumption
  -- indices may have just changed above (Phase 3).
  select coalesce((public.materialize_all_active_city_stockpiles() ->> 'processed')::integer, 0)
  into v_stockpiles_materialized;

  -- New in Phase 4: re-check replenishment now that the full sweep above may
  -- have pushed additional stockpiles below their reorder point (indices
  -- moved, not just elapsed time) -- a large limit since this only runs
  -- once/day against the whole active set, not the 5-minute due-index sweep.
  select coalesce((public.create_replenishment_contracts_for_due_stockpiles(2000) ->> 'contractsCreated')::integer, 0)
  into v_contracts_created;

  return jsonb_build_object(
    'ok', true,
    'skipped', false,
    'economicDay', v_current_day,
    'citiesProcessed', v_cities_processed,
    'eventsStarted', v_world_events_started + v_city_events_started,
    'eventsEnded', v_world_events_ended + v_city_events_ended,
    'stockpilesMaterialized', v_stockpiles_materialized,
    'contractsCreated', v_contracts_created
  );
end;
$$;

revoke all on function public.run_government_daily_update() from public, anon, authenticated, service_role;
grant execute on function public.run_government_daily_update() to service_role;

-- Migration complete: automatic municipal replenishment contract creation,
-- wired into both the 5-minute due-index sweep (via tick-city-stockpiles,
-- updated separately) and the daily government maintenance pass.
