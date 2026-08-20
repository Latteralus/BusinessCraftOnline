-- CityPlan Phase 3: wire "the daily government maintenance pass" into
-- run_government_daily_update() as a valid stockpile-materialization
-- trigger point (see Documents/Plans/CityPlan.md, Phase 3: "Materialize
-- on... the daily government maintenance pass" and "Whenever stock,
-- consumption rate, population scaling, or relevant demand modifiers
-- change, recompute next_reorder_at"). This function's own daily pass is
-- exactly where city_economic_state.municipal_consumption_index and
-- world_economic_state.municipal_consumption_index can change -- without
-- this, every already-computed next_reorder_at would silently go stale the
-- moment those indices move, since a stockpile only otherwise recomputes
-- when its own due check fires. city_stockpiles didn't exist when migration
-- 112 first defined this function, so this is a full create-or-replace with
-- one addition (the final materialize_all_active_city_stockpiles() call and
-- its count in the return payload) -- same pattern this repo already uses
-- for evolving invoke_edge_function across several migrations.

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

  -- New in Phase 3: force-materialize every active stockpile now that
  -- municipal consumption indices may have just changed above.
  select coalesce((public.materialize_all_active_city_stockpiles() ->> 'processed')::integer, 0)
  into v_stockpiles_materialized;

  return jsonb_build_object(
    'ok', true,
    'skipped', false,
    'economicDay', v_current_day,
    'citiesProcessed', v_cities_processed,
    'eventsStarted', v_world_events_started + v_city_events_started,
    'eventsEnded', v_world_events_ended + v_city_events_ended,
    'stockpilesMaterialized', v_stockpiles_materialized
  );
end;
$$;

revoke all on function public.run_government_daily_update() from public, anon, authenticated, service_role;
grant execute on function public.run_government_daily_update() to service_role;

-- Migration complete: run_government_daily_update() now also force-
-- materializes every active city_stockpiles row as part of its daily pass.
