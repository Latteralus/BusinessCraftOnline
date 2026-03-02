-- Phase 5: businesses domain
-- Creates businesses table owned by businesses.

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 3 and 80),
  type text not null check (
    type in (
      'mine',
      'farm',
      'water_company',
      'logging_camp',
      'oil_well',
      'sawmill',
      'metalworking_factory',
      'food_processing_plant',
      'winery_distillery',
      'carpentry_workshop',
      'general_store',
      'specialty_store'
    )
  ),
  city_id uuid not null references public.cities(id) on delete restrict,
  entity_type text not null default 'sole_proprietorship' check (
    entity_type in ('sole_proprietorship', 'llc')
  ),
  value numeric(14, 2) not null default 0 check (value >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (player_id, name)
);

create index if not exists idx_businesses_player
  on public.businesses(player_id);

create index if not exists idx_businesses_player_created
  on public.businesses(player_id, created_at desc);

create index if not exists idx_businesses_city
  on public.businesses(city_id);

alter table public.businesses enable row level security;

create policy "businesses_select_own"
  on public.businesses
  for select
  using (player_id = auth.uid());

create policy "businesses_insert_own"
  on public.businesses
  for insert
  with check (player_id = auth.uid());

create policy "businesses_update_own"
  on public.businesses
  for update
  using (player_id = auth.uid())
  with check (player_id = auth.uid());

create policy "businesses_delete_own"
  on public.businesses
  for delete
  using (player_id = auth.uid());

-- Migration complete: create businesses table with ownership constraints and RLS
