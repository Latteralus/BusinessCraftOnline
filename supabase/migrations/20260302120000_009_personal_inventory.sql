-- Phase 4: inventory domain
-- Creates personal_inventory table owned by inventory.

create table if not exists public.personal_inventory (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  item_key text not null check (char_length(item_key) between 1 and 64),
  quantity integer not null check (quantity > 0),
  quality integer not null default 40 check (quality between 1 and 100),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (player_id, item_key, quality)
);

create index if not exists idx_personal_inventory_player
  on public.personal_inventory(player_id);

create index if not exists idx_personal_inventory_player_item
  on public.personal_inventory(player_id, item_key);

alter table public.personal_inventory enable row level security;

create policy "personal_inventory_select_own"
  on public.personal_inventory
  for select
  using (player_id = auth.uid());

create policy "personal_inventory_insert_own"
  on public.personal_inventory
  for insert
  with check (player_id = auth.uid());

create policy "personal_inventory_update_own"
  on public.personal_inventory
  for update
  using (player_id = auth.uid())
  with check (player_id = auth.uid());

create policy "personal_inventory_delete_own"
  on public.personal_inventory
  for delete
  using (player_id = auth.uid());

-- Migration complete: create personal_inventory table with RLS and ownership indexes
