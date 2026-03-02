-- Phase 4: inventory domain
-- Creates business_inventory table owned by inventory.

create table if not exists public.business_inventory (
  id uuid primary key default gen_random_uuid(),
  owner_player_id uuid not null references public.players(id) on delete cascade,
  business_id uuid not null,
  city_id uuid not null references public.cities(id) on delete restrict,
  item_key text not null check (char_length(item_key) between 1 and 64),
  quantity integer not null check (quantity > 0),
  quality integer not null default 40 check (quality between 1 and 100),
  reserved_quantity integer not null default 0 check (reserved_quantity >= 0),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (business_id, item_key, quality)
);

create index if not exists idx_business_inventory_owner
  on public.business_inventory(owner_player_id);

create index if not exists idx_business_inventory_business
  on public.business_inventory(business_id);

create index if not exists idx_business_inventory_owner_business
  on public.business_inventory(owner_player_id, business_id);

alter table public.business_inventory enable row level security;

create policy "business_inventory_select_own"
  on public.business_inventory
  for select
  using (owner_player_id = auth.uid());

create policy "business_inventory_insert_own"
  on public.business_inventory
  for insert
  with check (owner_player_id = auth.uid());

create policy "business_inventory_update_own"
  on public.business_inventory
  for update
  using (owner_player_id = auth.uid())
  with check (owner_player_id = auth.uid());

create policy "business_inventory_delete_own"
  on public.business_inventory
  for delete
  using (owner_player_id = auth.uid());

-- Migration complete: create business_inventory table with RLS and ownership indexes
