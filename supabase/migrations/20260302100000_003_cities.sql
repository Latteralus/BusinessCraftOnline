-- Phase 2: cities-travel domain
-- Creates the cities table owned by cities-travel and links characters.current_city_id.

create table if not exists public.cities (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  state text not null,
  region text not null,
  slug text not null unique,
  available_resources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(available_resources) = 'array')
);

create index if not exists idx_cities_slug on public.cities(slug);
create index if not exists idx_cities_region on public.cities(region);

insert into public.cities (name, state, region, slug, available_resources)
values
  ('New York City', 'New York', 'Northeast', 'new-york-city', '["general_goods", "textiles", "finance_services"]'::jsonb),
  ('Los Angeles', 'California', 'West', 'los-angeles', '["red_grape", "electronics", "entertainment_goods"]'::jsonb),
  ('Chicago', 'Illinois', 'Midwest', 'chicago', '["steel", "manufacturing", "grain", "corn"]'::jsonb),
  ('Houston', 'Texas', 'South', 'houston', '["crude_oil", "natural_gas", "petrochemicals"]'::jsonb),
  ('Dallas', 'Texas', 'South', 'dallas', '["wheat", "cattle", "cotton", "iron_ore"]'::jsonb),
  ('Philadelphia', 'Pennsylvania', 'Northeast', 'philadelphia', '["coal", "textiles", "food_processing"]'::jsonb),
  ('Phoenix', 'Arizona', 'Southwest', 'phoenix', '["copper_ore", "gravel", "solar_components"]'::jsonb),
  ('San Diego', 'California', 'West', 'san-diego', '["seafood", "red_grape", "biotech_materials"]'::jsonb),
  ('Denver', 'Colorado', 'Mountain', 'denver', '["iron_ore", "coal", "raw_wood", "copper_ore"]'::jsonb),
  ('Atlanta', 'Georgia', 'Southeast', 'atlanta', '["wheat", "cotton", "poultry", "peaches"]'::jsonb)
on conflict (slug) do update
set
  name = excluded.name,
  state = excluded.state,
  region = excluded.region,
  available_resources = excluded.available_resources;

update public.characters
set current_city_id = (
  select id from public.cities where slug = 'denver' limit 1
)
where current_city_id is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'characters_current_city_id_fkey'
      and conrelid = 'public.characters'::regclass
  ) then
    alter table public.characters
      add constraint characters_current_city_id_fkey
      foreign key (current_city_id)
      references public.cities(id)
      on delete set null;
  end if;
end $$;

alter table public.cities enable row level security;

create policy "cities_select_authenticated"
  on public.cities
  for select
  using (auth.uid() is not null);

-- Migration complete: create cities table, seed MVP cities, and link characters.current_city_id
