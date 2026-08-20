-- CityPlan Phase 3: Municipal Stockpiles. Per
-- Documents/Plans/CityPlan.md ("Phase 3 - Municipal Stockpiles"). City stock
-- is physical government inventory, separate from NPC retail demand (see
-- the plan's Design Principles). Stock is never decremented by a per-minute
-- write loop -- it's derived from elapsed-time math against a checkpoint
-- (stored_quantity as of last_materialized_at), materialized only on a due
-- reorder check, the daily government maintenance pass (see migration 115),
-- or a future delivery (Phase 4/5, not built yet). See
-- shared/cities/stockpiles.ts for the pure-TS mirror of this math, used for
-- read-time projection without forcing a write on every read.

-- ---------------------------------------------------------------------------
-- 1. city_stockpiles
-- ---------------------------------------------------------------------------

create table if not exists public.city_stockpiles (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.cities(id) on delete cascade,
  item_key text not null,
  stored_quantity numeric not null default 0 check (stored_quantity >= 0),
  target_quantity numeric not null check (target_quantity >= 0),
  reorder_point numeric not null check (reorder_point >= 0),
  critical_point numeric not null check (critical_point >= 0),
  base_consumption_per_hour numeric not null default 0 check (base_consumption_per_hour >= 0),
  minimum_quality integer not null default 30 check (minimum_quality between 1 and 100),
  last_materialized_at timestamptz not null default now(),
  next_reorder_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (city_id, item_key),
  check (critical_point <= reorder_point),
  check (reorder_point <= target_quantity)
);

-- Indexed so the due-reorder sweep (materialize_city_stockpiles_due below)
-- can query only stockpiles that are actually due instead of scanning every
-- city/item row -- the partial predicate keeps the index small and skips
-- inactive rows and rows with no scheduled reorder (next_reorder_at is null
-- whenever effective consumption is currently zero).
create index if not exists idx_city_stockpiles_due
  on public.city_stockpiles(next_reorder_at)
  where is_active and next_reorder_at is not null;

create index if not exists idx_city_stockpiles_city on public.city_stockpiles(city_id);

alter table public.city_stockpiles enable row level security;

drop policy if exists "city_stockpiles_select_authenticated" on public.city_stockpiles;
create policy "city_stockpiles_select_authenticated"
  on public.city_stockpiles
  for select
  using (auth.uid() is not null);

-- ---------------------------------------------------------------------------
-- 2. Seed -- one row per city for each of the same 9 raw-resource keys Phase
--    1 already established (city_resource_modifiers), representing the
--    city's own physical reserve of each (water utility reserve, energy/
--    materials reserve for public works, food-security reserve, etc.) --
--    deliberately the same item taxonomy rather than inventing a new one.
--    Per-capita hourly rates are uniform across cities (no reason a city's
--    per-resident municipal draw would vary thematically the way resource
--    *abundance* does) and scaled by each city's population_baseline;
--    target/reorder/critical are then derived from that rate so the ratios
--    stay consistent without hand-tuning 90 rows individually.
-- ---------------------------------------------------------------------------

with per_capita_rates(item_key, rate) as (
  values
    ('water', 0.05),
    ('coal', 0.01),
    ('iron_ore', 0.004),
    ('copper_ore', 0.002),
    ('raw_wood', 0.006),
    ('crude_oil', 0.008),
    ('wheat', 0.01),
    ('potato', 0.01),
    ('red_grape', 0.001)
),
seed as (
  select
    c.id as city_id,
    r.item_key,
    -- 30-day (720h) target reserve; reorder at 40% of target, critical at 15%.
    (coalesce(c.population_baseline, 0) * r.rate) as base_consumption_per_hour,
    (coalesce(c.population_baseline, 0) * r.rate) * 720 as target_quantity,
    (coalesce(c.population_baseline, 0) * r.rate) * 720 * 0.40 as reorder_point,
    (coalesce(c.population_baseline, 0) * r.rate) * 720 * 0.15 as critical_point
  from public.cities c
  cross join per_capita_rates r
  where c.is_active
)
insert into public.city_stockpiles (
  city_id, item_key, stored_quantity, target_quantity, reorder_point,
  critical_point, base_consumption_per_hour, minimum_quality,
  last_materialized_at, next_reorder_at
)
select
  s.city_id,
  s.item_key,
  s.target_quantity, -- start full: government reserves begin topped off
  s.target_quantity,
  s.reorder_point,
  s.critical_point,
  s.base_consumption_per_hour,
  30,
  now(),
  case
    when s.base_consumption_per_hour > 0
      -- make_interval's hours parameter is integer, so it rejects a
      -- fractional double precision argument outright (SQLSTATE 42883, no
      -- matching overload) -- multiply a numeric hour count by interval '1
      -- hour' instead, which Postgres supports natively for any numeric type.
      then now() + (((s.target_quantity - s.reorder_point) / s.base_consumption_per_hour)) * interval '1 hour'
    else null
  end
from seed s
on conflict (city_id, item_key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Materialization -- elapsed-time consumption math, shared by the due
--    sweep and the daily maintenance pass so the formula lives in exactly
--    one place.
--
--    rate = baseConsumptionPerHour * populationScale
--           * city.municipalConsumptionIndex * world.municipalConsumptionIndex
--           * activeItemEventMultiplier
--    currentStock = max(0, storedQuantity - elapsedHours * rate)
--
--    activeItemEventMultiplier is the compounded product of any active
--    city_events modifier keyed "stockpile_<item_key>" for that city (same
--    per-key-multiplier convention Phase 2 used for its own index keys). No
--    events use this key yet -- it defaults to neutral (1) via coalesce,
--    same "architecture ready, dormant until content exists" pattern as
--    Phase 2's event system.
--
--    A single UPDATE ... FROM statement is one atomic operation, so the
--    rows it targets are locked by the UPDATE itself -- no separate FOR
--    UPDATE read phase is needed here, matching how migration 112's own
--    per-city UPDATE ... FROM needed no extra locking beyond the update
--    statement itself (only its singleton-row idempotency check did).
-- ---------------------------------------------------------------------------

create or replace function public._materialize_city_stockpile_ids(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_processed integer := 0;
begin
  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;

  with computed as (
    select
      cs.id,
      cs.stored_quantity,
      cs.reorder_point,
      cs.base_consumption_per_hour,
      greatest(0, extract(epoch from (v_now - cs.last_materialized_at)) / 3600.0) as elapsed_hours,
      case when coalesce(c.population_baseline, 0) > 0
        then coalesce(ces.population, c.population_baseline)::numeric / c.population_baseline
        else 1
      end as population_scale,
      coalesce(ces.municipal_consumption_index, 1) as city_municipal_index,
      coalesce(wes.municipal_consumption_index, 1) as world_municipal_index,
      coalesce((
        select product_agg((ce.modifiers ->> ('stockpile_' || cs.item_key))::numeric)
        from public.city_events ce
        where ce.city_id = cs.city_id
          and ce.is_active
          and ce.modifiers ? ('stockpile_' || cs.item_key)
      ), 1) as event_mult
    from public.city_stockpiles cs
    join public.cities c on c.id = cs.city_id
    left join public.city_economic_state ces on ces.city_id = cs.city_id
    left join public.world_economic_state wes on wes.id = 1
    where cs.id = any(p_ids)
  ),
  final as (
    select
      id,
      reorder_point,
      base_consumption_per_hour * population_scale * city_municipal_index * world_municipal_index * event_mult as effective_rate,
      greatest(0, stored_quantity - elapsed_hours * (base_consumption_per_hour * population_scale * city_municipal_index * world_municipal_index * event_mult)) as new_stock
    from computed
  )
  update public.city_stockpiles cs
  set
    stored_quantity = f.new_stock,
    last_materialized_at = v_now,
    next_reorder_at = case
      when f.new_stock <= f.reorder_point then v_now
      -- See the seed block above for why this is numeric * interval '1 hour'
      -- rather than make_interval(hours => ...) (integer-only parameter).
      when f.effective_rate > 0 then v_now + ((f.new_stock - f.reorder_point) / f.effective_rate) * interval '1 hour'
      else null
    end,
    updated_at = v_now
  from final f
  where f.id = cs.id;

  get diagnostics v_processed = row_count;
  return v_processed;
end;
$$;

revoke all on function public._materialize_city_stockpile_ids(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public._materialize_city_stockpile_ids(uuid[]) to service_role;

-- Due-reorder check: only stockpiles whose projected next_reorder_at has
-- already passed, via the partial index above -- not a full-table scan.
create or replace function public.materialize_city_stockpiles_due(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_processed integer;
begin
  select array_agg(id) into v_ids
  from (
    select id
    from public.city_stockpiles
    where is_active and next_reorder_at is not null and next_reorder_at <= now()
    order by next_reorder_at
    limit greatest(1, least(coalesce(p_limit, 500), 2000))
  ) due;

  v_processed := public._materialize_city_stockpile_ids(v_ids);

  return jsonb_build_object('ok', true, 'processed', v_processed);
end;
$$;

revoke all on function public.materialize_city_stockpiles_due(integer) from public, anon, authenticated, service_role;
grant execute on function public.materialize_city_stockpiles_due(integer) to service_role;

-- Full sweep of every active stockpile, regardless of due status -- used by
-- the daily government pass (migration 115) since that's the point where
-- city.municipalConsumptionIndex/world.municipalConsumptionIndex can change,
-- which invalidates every already-computed next_reorder_at for that
-- reason alone (see Phase 3's own "recompute next_reorder_at whenever...
-- relevant demand modifiers change").
create or replace function public.materialize_all_active_city_stockpiles()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_processed integer;
begin
  select array_agg(id) into v_ids from public.city_stockpiles where is_active;
  v_processed := public._materialize_city_stockpile_ids(v_ids);
  return jsonb_build_object('ok', true, 'processed', v_processed);
end;
$$;

revoke all on function public.materialize_all_active_city_stockpiles() from public, anon, authenticated, service_role;
grant execute on function public.materialize_all_active_city_stockpiles() to service_role;

-- Migration complete: city_stockpiles (seeded), and the materialization RPCs.
