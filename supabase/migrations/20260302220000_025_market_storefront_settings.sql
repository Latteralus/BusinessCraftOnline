-- Phase 15: storefront management
-- Adds per-store storefront settings used by NPC market traffic simulation.

create table if not exists public.market_storefront_settings (
  id uuid primary key default gen_random_uuid(),
  owner_player_id uuid not null references public.players(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  ad_budget_per_tick numeric(12, 2) not null default 0 check (ad_budget_per_tick >= 0),
  traffic_multiplier numeric(6, 3) not null default 1 check (traffic_multiplier >= 0.5 and traffic_multiplier <= 3),
  is_ad_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id)
);

create index if not exists idx_market_storefront_settings_owner
  on public.market_storefront_settings(owner_player_id);

create index if not exists idx_market_storefront_settings_owner_business
  on public.market_storefront_settings(owner_player_id, business_id);

alter table public.market_storefront_settings enable row level security;

create policy "market_storefront_settings_select_own"
  on public.market_storefront_settings
  for select
  using (owner_player_id = auth.uid());

create policy "market_storefront_settings_insert_own"
  on public.market_storefront_settings
  for insert
  with check (
    owner_player_id = auth.uid()
    and exists (
      select 1
      from public.businesses b
      where b.id = business_id
        and b.player_id = auth.uid()
    )
  );

create policy "market_storefront_settings_update_own"
  on public.market_storefront_settings
  for update
  using (owner_player_id = auth.uid())
  with check (
    owner_player_id = auth.uid()
    and exists (
      select 1
      from public.businesses b
      where b.id = business_id
        and b.player_id = auth.uid()
    )
  );

create policy "market_storefront_settings_delete_own"
  on public.market_storefront_settings
  for delete
  using (owner_player_id = auth.uid());

-- Migration complete: create market_storefront_settings table with ownership constraints and RLS

