create table if not exists public.business_upgrade_projects (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  upgrade_key text not null check (char_length(trim(upgrade_key)) between 1 and 64),
  target_level integer not null check (target_level > 0),
  project_status text not null check (project_status in ('queued', 'installing', 'completed', 'cancelled')),
  quoted_cost numeric(14, 2) not null check (quoted_cost >= 0),
  started_at timestamptz null,
  completes_at timestamptz null,
  applied_at timestamptz null,
  downtime_policy text not null check (downtime_policy in ('none', 'partial', 'full')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_business_upgrade_projects_business
  on public.business_upgrade_projects(business_id, created_at desc);

create unique index if not exists idx_business_upgrade_projects_one_active
  on public.business_upgrade_projects(business_id)
  where project_status in ('queued', 'installing');

alter table public.business_upgrade_projects enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'business_upgrade_projects'
      and policyname = 'business_upgrade_projects_select_own'
  ) then
    create policy "business_upgrade_projects_select_own"
      on public.business_upgrade_projects
      for select
      using (
        exists (
          select 1
          from public.businesses b
          where b.id = business_id
            and b.player_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'business_upgrade_projects'
      and policyname = 'business_upgrade_projects_insert_own'
  ) then
    create policy "business_upgrade_projects_insert_own"
      on public.business_upgrade_projects
      for insert
      with check (
        exists (
          select 1
          from public.businesses b
          where b.id = business_id
            and b.player_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'business_upgrade_projects'
      and policyname = 'business_upgrade_projects_update_own'
  ) then
    create policy "business_upgrade_projects_update_own"
      on public.business_upgrade_projects
      for update
      using (
        exists (
          select 1
          from public.businesses b
          where b.id = business_id
            and b.player_id = auth.uid()
        )
      )
      with check (
        exists (
          select 1
          from public.businesses b
          where b.id = business_id
            and b.player_id = auth.uid()
        )
      );
  end if;
end;
$$;

delete from public.upgrade_definitions
where upgrade_key = 'seed_efficiency';

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
  ('extraction_efficiency', 'Extraction Efficiency', 'Improves extraction output per tick.', array['mine', 'water_company', 'logging_camp', 'oil_well'], 900, 1.35, 1.08, 1.05, 'Output multiplier', true, null),
  ('worker_capacity', 'Worker Capacity', 'Adds production positions and floor capacity.', array['mine', 'farm', 'water_company', 'logging_camp', 'oil_well', 'sawmill', 'metalworking_factory', 'food_processing_plant', 'winery_distillery', 'carpentry_workshop'], 2200, 1.40, 1, 1, 'Additional worker slots', false, 6),
  ('tool_durability', 'Tool Durability', 'Extends tool lifetime before breakage.', array['mine', 'logging_camp', 'oil_well'], 1650, 1.35, 1.10, 1.04, 'Tool durability multiplier', true, null),
  ('ore_quality', 'Ore Quality', 'Improves mined material quality.', array['mine'], 1300, 1.35, 4, 1, 'Quality bonus', true, null),
  ('crop_yield', 'Crop Yield', 'Improves farm output per cycle.', array['farm'], 700, 1.32, 1.08, 1.05, 'Output multiplier', true, null),
  ('water_efficiency', 'Water Efficiency', 'Reduces water consumed by the farm.', array['farm'], 900, 1.35, 0.92, 1.08, 'Water use multiplier', true, null),
  ('production_efficiency', 'Production Efficiency', 'Increases manufacturing output quantity.', array['sawmill', 'metalworking_factory', 'food_processing_plant', 'winery_distillery', 'carpentry_workshop'], 1000, 1.35, 1.08, 1.05, 'Output multiplier', true, null),
  ('equipment_quality', 'Equipment Quality', 'Raises output quality for manufacturing.', array['sawmill', 'metalworking_factory', 'food_processing_plant', 'winery_distillery', 'carpentry_workshop'], 1500, 1.35, 4, 1, 'Quality bonus', true, null),
  ('input_reduction', 'Input Reduction', 'Reduces material wasted in recipes.', array['sawmill', 'metalworking_factory', 'food_processing_plant', 'winery_distillery', 'carpentry_workshop'], 1900, 1.40, 0.96, 1.08, 'Input use multiplier', true, null),
  ('storefront_appeal', 'Storefront Appeal', 'Increases NPC traffic to the store.', array['general_store', 'specialty_store'], 950, 1.35, 1.05, 1.03, 'Traffic multiplier', true, null),
  ('listing_capacity', 'Listing Capacity', 'Adds more shelf and listing capacity.', array['general_store', 'specialty_store'], 1200, 1.35, 1, 1, 'Additional listings', false, 10),
  ('customer_service', 'Customer Service', 'Improves conversion and pricing resilience.', array['general_store', 'specialty_store'], 1700, 1.35, 1.03, 1.02, 'Conversion multiplier', true, null)
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
