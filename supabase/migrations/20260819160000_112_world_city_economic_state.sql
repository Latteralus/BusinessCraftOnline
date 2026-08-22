-- CityPlan Phase 2: World and City Economic State. Per
-- Documents/Plans/CityPlan.md ("Phase 2 - World and City Economic State").
-- Adds dynamic per-city and world-wide economic indices, time-bounded
-- world/city events with typed modifier payloads, and a single
-- once-per-24h idempotent government update RPC (`run_government_daily_update`)
-- driven by a new `tick-government-daily` edge function/cron job. Phase 1's
-- `cities`/`city_resource_modifiers`/`city_routes` are static reference data
-- that only change via migration; everything in this migration is dynamic
-- state that only changes via the daily job (or event start/end sweeps
-- inside that same job) -- players never write these tables directly.

-- ---------------------------------------------------------------------------
-- 1. world_economic_state -- singleton row (id is always 1)
-- ---------------------------------------------------------------------------

create table if not exists public.world_economic_state (
  id smallint primary key default 1,
  labor_index numeric not null default 1 check (labor_index > 0),
  consumer_demand_index numeric not null default 1 check (consumer_demand_index > 0),
  municipal_consumption_index numeric not null default 1 check (municipal_consumption_index > 0),
  transport_cost_index numeric not null default 1 check (transport_cost_index > 0),
  inflation_index numeric not null default 1 check (inflation_index > 0),
  economic_day bigint not null default 0,
  last_government_update_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint world_economic_state_singleton check (id = 1)
);

alter table public.world_economic_state enable row level security;

drop policy if exists "world_economic_state_select_authenticated" on public.world_economic_state;
create policy "world_economic_state_select_authenticated"
  on public.world_economic_state
  for select
  using (auth.uid() is not null);

insert into public.world_economic_state (id)
values (1)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. city_economic_state -- one row per city
-- ---------------------------------------------------------------------------

create table if not exists public.city_economic_state (
  city_id uuid primary key references public.cities(id) on delete cascade,
  population bigint not null default 0 check (population >= 0),
  population_growth_index numeric not null default 1 check (population_growth_index > 0),
  labor_supply_index numeric not null default 1 check (labor_supply_index > 0),
  labor_demand_index numeric not null default 1 check (labor_demand_index > 0),
  consumer_demand_index numeric not null default 1 check (consumer_demand_index > 0),
  municipal_consumption_index numeric not null default 1 check (municipal_consumption_index > 0),
  economic_activity_index numeric not null default 1 check (economic_activity_index > 0),
  economic_day bigint not null default 0,
  last_government_update_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.city_economic_state enable row level security;

drop policy if exists "city_economic_state_select_authenticated" on public.city_economic_state;
create policy "city_economic_state_select_authenticated"
  on public.city_economic_state
  for select
  using (auth.uid() is not null);

-- Seed one row per existing city, population starting at population_baseline
-- (falls back to 0 if a city somehow has no baseline set).
insert into public.city_economic_state (city_id, population)
select c.id, coalesce(c.population_baseline, 0)
from public.cities c
on conflict (city_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. world_events / city_events -- time-bounded, typed modifier payloads.
--    `modifiers` keys are index names (e.g. "labor_supply", "labor_demand",
--    "consumer_demand", "municipal_consumption", "economic_activity",
--    "population" for city events; "labor_index", "consumer_demand_index",
--    "municipal_consumption_index", "transport_cost_index", "inflation_index"
--    for world events) mapped to a multiplier applied on top of that index's
--    neutral baseline for each day the event is active -- see
--    run_government_daily_update below. Multiple simultaneous events on the
--    same city/world compound multiplicatively.
-- ---------------------------------------------------------------------------

create table if not exists public.world_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in (
    'population_boom', 'labor_shortage', 'recession', 'construction_surge',
    'drought', 'energy_shock', 'migration_inflow'
  )),
  display_name text not null,
  modifiers jsonb not null default '{}'::jsonb,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists idx_world_events_active_ends on public.world_events(is_active, ends_at);
create index if not exists idx_world_events_starts on public.world_events(starts_at) where not is_active;

alter table public.world_events enable row level security;

drop policy if exists "world_events_select_authenticated" on public.world_events;
create policy "world_events_select_authenticated"
  on public.world_events
  for select
  using (auth.uid() is not null);

create table if not exists public.city_events (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.cities(id) on delete cascade,
  event_type text not null check (event_type in (
    'population_boom', 'labor_shortage', 'recession', 'construction_surge',
    'drought', 'energy_shock', 'migration_inflow'
  )),
  display_name text not null,
  modifiers jsonb not null default '{}'::jsonb,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists idx_city_events_city_active on public.city_events(city_id, is_active);
create index if not exists idx_city_events_active_ends on public.city_events(is_active, ends_at);
create index if not exists idx_city_events_starts on public.city_events(starts_at) where not is_active;

alter table public.city_events enable row level security;

drop policy if exists "city_events_select_authenticated" on public.city_events;
create policy "city_events_select_authenticated"
  on public.city_events
  for select
  using (auth.uid() is not null);

-- No events are seeded -- the event system is architecture, not live content,
-- for this phase (matches the deliberate "static placeholder" pattern Phase 1
-- used for city_routes-as-reference-data). A future admin/game-master path or
-- scripted scenario can insert rows into these tables later.

-- ---------------------------------------------------------------------------
-- 4. product_agg -- small custom aggregate used to compound multiple active
--    event multipliers on the same index (e.g. two simultaneous city events
--    both touching labor_supply). Postgres has no built-in PRODUCT aggregate.
--
--    strict is deliberate: a malformed event row whose modifiers JSON has an
--    explicit null for the matching key (e.g. {"labor_index": null}) must not
--    poison the whole product to null -- with a strict transition function,
--    Postgres skips the transition entirely on a null input and leaves the
--    running state (and therefore every other event's real contribution)
--    untouched, instead of the outer coalesce(..., 1) silently resetting the
--    index to neutral because product_agg itself returned null.
-- ---------------------------------------------------------------------------

create or replace function public._multiply_numeric_state(state numeric, value numeric)
returns numeric
language sql
immutable
strict
as $$
  select state * value;
$$;

drop aggregate if exists public.product_agg(numeric);
create aggregate public.product_agg(numeric) (
  sfunc = public._multiply_numeric_state,
  stype = numeric,
  initcond = '1'
);

-- ---------------------------------------------------------------------------
-- 5. run_government_daily_update -- the one authoritative daily job.
--    Idempotent per economic day (a day-number key, not a wall-clock
--    timestamp comparison, so it can't be fooled by clock skew across
--    repeated scheduler calls within the same UTC day): if the singleton
--    world row's economic_day already matches today's, the call is a no-op.
--    Locks the singleton world row first so concurrent invocations serialize
--    instead of double-advancing. Set-based throughout -- one UPDATE ... FROM
--    for all cities, not a per-city loop -- per the plan's performance
--    guidance to avoid per-city round trips from the daily job.
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

  return jsonb_build_object(
    'ok', true,
    'skipped', false,
    'economicDay', v_current_day,
    'citiesProcessed', v_cities_processed,
    'eventsStarted', v_world_events_started + v_city_events_started,
    'eventsEnded', v_world_events_ended + v_city_events_ended
  );
end;
$$;

revoke all on function public.run_government_daily_update() from public, anon, authenticated, service_role;
grant execute on function public.run_government_daily_update() to service_role;

-- Migration complete: world_economic_state, city_economic_state, world_events,
-- city_events, and the idempotent run_government_daily_update RPC.
