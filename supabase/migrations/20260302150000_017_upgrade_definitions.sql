-- Phase 7: upgrades domain
-- Creates upgrade_definitions reference table owned by upgrades.

create table if not exists public.upgrade_definitions (
  upgrade_key text primary key,
  display_name text not null,
  description text not null,
  applies_to_business_types text[] not null default '{}',
  base_cost numeric(14, 2) not null check (base_cost > 0),
  cost_multiplier numeric(8, 4) not null default 1.25 check (cost_multiplier > 1),
  base_effect numeric(14, 4) not null,
  gain_multiplier numeric(8, 4) not null default 1.10 check (gain_multiplier > 1),
  effect_label text not null,
  is_infinite boolean not null default true,
  max_level integer null check (max_level is null or max_level > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_upgrade_definitions_business_types
  on public.upgrade_definitions using gin (applies_to_business_types);

insert into public.upgrade_definitions (
  upgrade_key,
  display_name,
  description,
  applies_to_business_types,
  base_cost,
  cost_multiplier,
  base_effect,
  gain_multiplier,
  effect_label,
  is_infinite,
  max_level
)
values
  (
    'extraction_efficiency',
    'Extraction Efficiency',
    'Improves extraction output per tick.',
    array['mine', 'water_company', 'logging_camp', 'oil_well'],
    500,
    1.25,
    1.10,
    1.10,
    'Output multiplier',
    true,
    null
  ),
  (
    'worker_capacity',
    'Worker Capacity',
    'Adds worker slots for supported businesses.',
    array['mine', 'farm', 'water_company', 'logging_camp', 'oil_well', 'sawmill', 'metalworking_factory', 'food_processing_plant', 'winery_distillery', 'carpentry_workshop'],
    2000,
    1.25,
    1,
    1.10,
    'Additional slots',
    true,
    null
  ),
  (
    'tool_durability',
    'Tool Durability',
    'Increases tool lifetime before breakage.',
    array['mine', 'logging_camp', 'oil_well'],
    1500,
    1.25,
    1.10,
    1.10,
    'Durability multiplier',
    true,
    null
  ),
  (
    'ore_quality',
    'Ore Quality',
    'Raises quality score for ore output.',
    array['mine'],
    1000,
    1.25,
    5,
    1.10,
    'Quality bonus',
    true,
    null
  ),
  (
    'crop_yield',
    'Crop Yield',
    'Improves farm output per extraction cycle.',
    array['farm'],
    400,
    1.25,
    1.10,
    1.10,
    'Output multiplier',
    true,
    null
  ),
  (
    'water_efficiency',
    'Water Efficiency',
    'Reduces water consumption for farms.',
    array['farm'],
    600,
    1.25,
    0.90,
    1.10,
    'Water use multiplier',
    true,
    null
  ),
  (
    'seed_efficiency',
    'Seed Efficiency',
    'Reduces seed consumption for farms.',
    array['farm'],
    800,
    1.25,
    0.90,
    1.10,
    'Seed use multiplier',
    true,
    null
  ),
  (
    'production_efficiency',
    'Production Efficiency',
    'Increases manufacturing output quantity.',
    array['sawmill', 'metalworking_factory', 'food_processing_plant', 'winery_distillery', 'carpentry_workshop'],
    600,
    1.25,
    1.10,
    1.10,
    'Output multiplier',
    true,
    null
  ),
  (
    'equipment_quality',
    'Equipment Quality',
    'Increases item quality produced by manufacturing facilities.',
    array['sawmill', 'metalworking_factory', 'food_processing_plant', 'winery_distillery', 'carpentry_workshop'],
    1200,
    1.25,
    5,
    1.10,
    'Quality bonus',
    true,
    null
  ),
  (
    'input_reduction',
    'Input Reduction',
    'Reduces input consumption in manufacturing recipes.',
    array['sawmill', 'metalworking_factory', 'food_processing_plant', 'winery_distillery', 'carpentry_workshop'],
    1800,
    1.25,
    0.95,
    1.10,
    'Input use multiplier',
    true,
    null
  ),
  (
    'storefront_appeal',
    'Storefront Appeal',
    'Increases NPC traffic to stores.',
    array['general_store', 'specialty_store'],
    800,
    1.25,
    1.10,
    1.10,
    'Traffic multiplier',
    true,
    null
  ),
  (
    'listing_capacity',
    'Listing Capacity',
    'Adds listing slots for stores.',
    array['general_store', 'specialty_store'],
    1000,
    1.25,
    1,
    1.10,
    'Additional listings',
    false,
    10
  ),
  (
    'customer_service',
    'Customer Service',
    'Improves customer conversion and pricing tolerance.',
    array['general_store', 'specialty_store'],
    1500,
    1.25,
    1.05,
    1.10,
    'Conversion multiplier',
    true,
    null
  )
on conflict (upgrade_key) do update
set
  display_name = excluded.display_name,
  description = excluded.description,
  applies_to_business_types = excluded.applies_to_business_types,
  base_cost = excluded.base_cost,
  cost_multiplier = excluded.cost_multiplier,
  base_effect = excluded.base_effect,
  gain_multiplier = excluded.gain_multiplier,
  effect_label = excluded.effect_label,
  is_infinite = excluded.is_infinite,
  max_level = excluded.max_level,
  updated_at = now();

alter table public.upgrade_definitions enable row level security;

create policy "upgrade_definitions_select_authenticated"
  on public.upgrade_definitions
  for select
  to authenticated
  using (true);

-- Migration complete: create and seed upgrade_definitions with read access
