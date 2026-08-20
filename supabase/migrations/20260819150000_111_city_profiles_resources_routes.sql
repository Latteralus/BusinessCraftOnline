-- CityPlan Phase 1: static city profiles, resource abundance modifiers, and
-- an inter-city route matrix. Per Documents/Plans/CityPlan.md ("Phase 1 -
-- City Profiles, Resources and Routes"). Extends the existing public.cities
-- table (migration 003) rather than replacing it, and adds two new tables
-- owned by the cities-travel domain.

-- ---------------------------------------------------------------------------
-- 1. Extend cities with static economic/geographic profile fields
-- ---------------------------------------------------------------------------

alter table public.cities
  add column if not exists population_baseline bigint,
  add column if not exists business_tax_rate numeric,
  add column if not exists property_cost_index numeric not null default 1,
  add column if not exists utility_cost_index numeric not null default 1,
  add column if not exists base_labor_index numeric not null default 1,
  add column if not exists latitude numeric,
  add column if not exists longitude numeric,
  add column if not exists is_active boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cities_population_baseline_check'
  ) then
    alter table public.cities
      add constraint cities_population_baseline_check check (population_baseline is null or population_baseline >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'cities_business_tax_rate_check'
  ) then
    alter table public.cities
      add constraint cities_business_tax_rate_check check (business_tax_rate is null or (business_tax_rate >= 0 and business_tax_rate <= 1));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'cities_property_cost_index_check'
  ) then
    alter table public.cities
      add constraint cities_property_cost_index_check check (property_cost_index >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'cities_utility_cost_index_check'
  ) then
    alter table public.cities
      add constraint cities_utility_cost_index_check check (utility_cost_index >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'cities_base_labor_index_check'
  ) then
    alter table public.cities
      add constraint cities_base_labor_index_check check (base_labor_index >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'cities_latitude_check'
  ) then
    alter table public.cities
      add constraint cities_latitude_check check (latitude is null or (latitude >= -90 and latitude <= 90));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'cities_longitude_check'
  ) then
    alter table public.cities
      add constraint cities_longitude_check check (longitude is null or (longitude >= -180 and longitude <= 180));
  end if;
end $$;

create index if not exists idx_cities_is_active on public.cities(is_active);

update public.cities set
  population_baseline = v.population_baseline,
  business_tax_rate = v.business_tax_rate,
  property_cost_index = v.property_cost_index,
  utility_cost_index = v.utility_cost_index,
  base_labor_index = v.base_labor_index,
  latitude = v.latitude,
  longitude = v.longitude
from (
  values
    ('new-york-city', 8400000::bigint, 0.085, 2.40, 1.50, 1.30, 40.7128, -74.0060),
    ('los-angeles',   3900000::bigint, 0.075, 2.00, 1.30, 1.20, 34.0522, -118.2437),
    ('chicago',       2700000::bigint, 0.065, 1.30, 1.10, 1.05, 41.8781, -87.6298),
    ('houston',       2300000::bigint, 0.045, 0.90, 0.85, 0.95, 29.7604, -95.3698),
    ('dallas',        1300000::bigint, 0.045, 0.90, 0.85, 0.95, 32.7767, -96.7970),
    ('philadelphia',  1600000::bigint, 0.060, 1.10, 1.10, 1.00, 39.9526, -75.1652),
    ('phoenix',       1700000::bigint, 0.050, 0.85, 0.90, 0.90, 33.4484, -112.0740),
    ('san-diego',     1400000::bigint, 0.070, 1.80, 1.20, 1.10, 32.7157, -117.1611),
    ('denver',         720000::bigint, 0.055, 1.20, 1.00, 1.00, 39.7392, -104.9903),
    ('atlanta',        500000::bigint, 0.050, 0.95, 0.90, 0.90, 33.7490, -84.3880)
) as v(slug, population_baseline, business_tax_rate, property_cost_index, utility_cost_index, base_labor_index, latitude, longitude)
where public.cities.slug = v.slug;

-- ---------------------------------------------------------------------------
-- 2. city_resource_modifiers -- per-city raw-resource abundance (quantity
--    only, never quality -- see shared/cities/resources.ts)
-- ---------------------------------------------------------------------------

create table if not exists public.city_resource_modifiers (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.cities(id) on delete cascade,
  resource_key text not null,
  abundance_multiplier numeric not null check (abundance_multiplier >= 0 and abundance_multiplier <= 2),
  notes text,
  updated_at timestamptz not null default now(),
  unique (city_id, resource_key)
);

create index if not exists idx_city_resource_modifiers_city on public.city_resource_modifiers(city_id);

alter table public.city_resource_modifiers enable row level security;

drop policy if exists "city_resource_modifiers_select_authenticated" on public.city_resource_modifiers;
create policy "city_resource_modifiers_select_authenticated"
  on public.city_resource_modifiers
  for select
  using (auth.uid() is not null);

insert into public.city_resource_modifiers (city_id, resource_key, abundance_multiplier)
select c.id, r.resource_key, r.abundance_multiplier
from (
  values
    ('new-york-city', 'water', 0.6), ('new-york-city', 'iron_ore', 0.2), ('new-york-city', 'coal', 0.1),
    ('new-york-city', 'copper_ore', 0.1), ('new-york-city', 'raw_wood', 0.3), ('new-york-city', 'crude_oil', 0.0),
    ('new-york-city', 'wheat', 0.1), ('new-york-city', 'potato', 0.3), ('new-york-city', 'red_grape', 0.1),

    ('los-angeles', 'water', 0.5), ('los-angeles', 'iron_ore', 0.3), ('los-angeles', 'coal', 0.0),
    ('los-angeles', 'copper_ore', 0.4), ('los-angeles', 'raw_wood', 0.3), ('los-angeles', 'crude_oil', 0.8),
    ('los-angeles', 'wheat', 0.2), ('los-angeles', 'potato', 0.4), ('los-angeles', 'red_grape', 1.6),

    ('chicago', 'water', 1.0), ('chicago', 'iron_ore', 1.4), ('chicago', 'coal', 1.2),
    ('chicago', 'copper_ore', 0.3), ('chicago', 'raw_wood', 0.5), ('chicago', 'crude_oil', 0.1),
    ('chicago', 'wheat', 1.6), ('chicago', 'potato', 0.9), ('chicago', 'red_grape', 0.0),

    ('houston', 'water', 0.7), ('houston', 'iron_ore', 0.2), ('houston', 'coal', 0.3),
    ('houston', 'copper_ore', 0.2), ('houston', 'raw_wood', 0.4), ('houston', 'crude_oil', 2.0),
    ('houston', 'wheat', 0.5), ('houston', 'potato', 0.4), ('houston', 'red_grape', 0.0),

    ('dallas', 'water', 0.6), ('dallas', 'iron_ore', 1.0), ('dallas', 'coal', 0.4),
    ('dallas', 'copper_ore', 0.5), ('dallas', 'raw_wood', 0.3), ('dallas', 'crude_oil', 1.2),
    ('dallas', 'wheat', 1.5), ('dallas', 'potato', 0.6), ('dallas', 'red_grape', 0.1),

    ('philadelphia', 'water', 1.0), ('philadelphia', 'iron_ore', 0.8), ('philadelphia', 'coal', 1.6),
    ('philadelphia', 'copper_ore', 0.3), ('philadelphia', 'raw_wood', 0.6), ('philadelphia', 'crude_oil', 0.1),
    ('philadelphia', 'wheat', 0.6), ('philadelphia', 'potato', 0.7), ('philadelphia', 'red_grape', 0.1),

    ('phoenix', 'water', 0.3), ('phoenix', 'iron_ore', 0.4), ('phoenix', 'coal', 0.2),
    ('phoenix', 'copper_ore', 2.0), ('phoenix', 'raw_wood', 0.1), ('phoenix', 'crude_oil', 0.0),
    ('phoenix', 'wheat', 0.2), ('phoenix', 'potato', 0.2), ('phoenix', 'red_grape', 0.3),

    ('san-diego', 'water', 0.5), ('san-diego', 'iron_ore', 0.1), ('san-diego', 'coal', 0.0),
    ('san-diego', 'copper_ore', 0.1), ('san-diego', 'raw_wood', 0.3), ('san-diego', 'crude_oil', 0.1),
    ('san-diego', 'wheat', 0.2), ('san-diego', 'potato', 0.3), ('san-diego', 'red_grape', 1.2),

    ('denver', 'water', 0.9), ('denver', 'iron_ore', 1.5), ('denver', 'coal', 1.4),
    ('denver', 'copper_ore', 1.2), ('denver', 'raw_wood', 1.3), ('denver', 'crude_oil', 0.3),
    ('denver', 'wheat', 0.7), ('denver', 'potato', 0.9), ('denver', 'red_grape', 0.2),

    ('atlanta', 'water', 1.1), ('atlanta', 'iron_ore', 0.3), ('atlanta', 'coal', 0.6),
    ('atlanta', 'copper_ore', 0.2), ('atlanta', 'raw_wood', 1.4), ('atlanta', 'crude_oil', 0.0),
    ('atlanta', 'wheat', 0.8), ('atlanta', 'potato', 1.0), ('atlanta', 'red_grape', 0.1)
) as r(slug, resource_key, abundance_multiplier)
join public.cities c on c.slug = r.slug
on conflict (city_id, resource_key) do update
set abundance_multiplier = excluded.abundance_multiplier;

-- ---------------------------------------------------------------------------
-- 3. city_routes -- inter-city road distance/time matrix, seeded curated
--    (no external maps API), symmetric in both directions
-- ---------------------------------------------------------------------------

create table if not exists public.city_routes (
  id uuid primary key default gen_random_uuid(),
  from_city_id uuid not null references public.cities(id) on delete cascade,
  to_city_id uuid not null references public.cities(id) on delete cascade,
  road_distance_miles numeric not null check (road_distance_miles > 0),
  baseline_drive_minutes integer not null check (baseline_drive_minutes > 0),
  base_freight_cost_per_lb_mile numeric,
  toll_cost numeric not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (from_city_id, to_city_id),
  check (from_city_id <> to_city_id)
);

create index if not exists idx_city_routes_from on public.city_routes(from_city_id);
create index if not exists idx_city_routes_to on public.city_routes(to_city_id);

alter table public.city_routes enable row level security;

drop policy if exists "city_routes_select_authenticated" on public.city_routes;
create policy "city_routes_select_authenticated"
  on public.city_routes
  for select
  using (auth.uid() is not null);

with route_miles(from_slug, to_slug, miles) as (
  values
    ('new-york-city', 'los-angeles', 2790.0), ('new-york-city', 'chicago', 790.0),
    ('new-york-city', 'houston', 1630.0), ('new-york-city', 'dallas', 1550.0),
    ('new-york-city', 'philadelphia', 95.0), ('new-york-city', 'phoenix', 2440.0),
    ('new-york-city', 'san-diego', 2810.0), ('new-york-city', 'denver', 1780.0),
    ('new-york-city', 'atlanta', 875.0),

    ('los-angeles', 'chicago', 2015.0), ('los-angeles', 'houston', 1550.0),
    ('los-angeles', 'dallas', 1435.0), ('los-angeles', 'philadelphia', 2695.0),
    ('los-angeles', 'phoenix', 375.0), ('los-angeles', 'san-diego', 120.0),
    ('los-angeles', 'denver', 1015.0), ('los-angeles', 'atlanta', 2180.0),

    ('chicago', 'houston', 1085.0), ('chicago', 'dallas', 925.0),
    ('chicago', 'philadelphia', 760.0), ('chicago', 'phoenix', 1730.0),
    ('chicago', 'san-diego', 2065.0), ('chicago', 'denver', 1000.0),
    ('chicago', 'atlanta', 715.0),

    ('houston', 'dallas', 240.0), ('houston', 'philadelphia', 1500.0),
    ('houston', 'phoenix', 1180.0), ('houston', 'san-diego', 1500.0),
    ('houston', 'denver', 1020.0), ('houston', 'atlanta', 790.0),

    ('dallas', 'philadelphia', 1440.0), ('dallas', 'phoenix', 1070.0),
    ('dallas', 'san-diego', 1360.0), ('dallas', 'denver', 780.0),
    ('dallas', 'atlanta', 780.0),

    ('philadelphia', 'phoenix', 2360.0), ('philadelphia', 'san-diego', 2725.0),
    ('philadelphia', 'denver', 1670.0), ('philadelphia', 'atlanta', 745.0),

    ('phoenix', 'san-diego', 355.0), ('phoenix', 'denver', 815.0),
    ('phoenix', 'atlanta', 1790.0),

    ('san-diego', 'denver', 1015.0), ('san-diego', 'atlanta', 2140.0),

    ('denver', 'atlanta', 1400.0)
),
route_pairs as (
  select from_slug, to_slug, miles from route_miles
  union all
  select to_slug, from_slug, miles from route_miles
)
insert into public.city_routes (
  from_city_id, to_city_id, road_distance_miles, baseline_drive_minutes,
  base_freight_cost_per_lb_mile, toll_cost
)
select
  fc.id,
  tc.id,
  rp.miles,
  round(rp.miles * 60.0 / 55.0)::int,
  0.015,
  0
from route_pairs rp
join public.cities fc on fc.slug = rp.from_slug
join public.cities tc on tc.slug = rp.to_slug
on conflict (from_city_id, to_city_id) do update
set
  road_distance_miles = excluded.road_distance_miles,
  baseline_drive_minutes = excluded.baseline_drive_minutes,
  base_freight_cost_per_lb_mile = excluded.base_freight_cost_per_lb_mile,
  toll_cost = excluded.toll_cost;

-- Migration complete: city static profile fields, city_resource_modifiers,
-- city_routes, all seeded for the 10 existing cities.
