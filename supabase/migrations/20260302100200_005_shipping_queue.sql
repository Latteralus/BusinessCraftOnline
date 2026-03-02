-- Phase 2: cities-travel domain
-- Creates the shipping_queue table owned by cities-travel.

create table if not exists public.shipping_queue (
  id uuid primary key default gen_random_uuid(),
  owner_player_id uuid not null references public.players(id) on delete cascade,
  from_city_id uuid not null references public.cities(id) on delete restrict,
  to_city_id uuid not null references public.cities(id) on delete restrict,
  item_key text not null,
  quantity integer not null check (quantity > 0),
  cost numeric(12, 2) not null check (cost >= 0),
  dispatched_at timestamptz not null default now(),
  arrives_at timestamptz not null,
  destination_type text not null check (destination_type in ('personal', 'business')),
  destination_id uuid not null,
  status text not null default 'in_transit' check (status in ('in_transit', 'delivered', 'cancelled')),
  created_at timestamptz not null default now(),
  check (from_city_id <> to_city_id),
  check (arrives_at >= dispatched_at)
);

create index if not exists idx_shipping_queue_owner_status
  on public.shipping_queue(owner_player_id, status);

create index if not exists idx_shipping_queue_arrives_at
  on public.shipping_queue(arrives_at);

alter table public.shipping_queue enable row level security;

create policy "shipping_queue_select_own"
  on public.shipping_queue
  for select
  using (owner_player_id = auth.uid());

create policy "shipping_queue_insert_own"
  on public.shipping_queue
  for insert
  with check (owner_player_id = auth.uid());

create policy "shipping_queue_update_own"
  on public.shipping_queue
  for update
  using (owner_player_id = auth.uid())
  with check (owner_player_id = auth.uid());

-- Migration complete: create shipping_queue table with RLS and delivery timer indexes
