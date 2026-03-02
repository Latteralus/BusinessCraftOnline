-- Phase 11: contracts domain
-- Creates contracts table for NPC-style buyer requests fulfilled by player businesses.

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  owner_player_id uuid not null references public.players(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 3 and 120),
  item_key text not null check (char_length(trim(item_key)) between 1 and 64),
  required_quantity integer not null check (required_quantity > 0),
  delivered_quantity integer not null default 0 check (delivered_quantity >= 0),
  unit_price numeric(14, 2) not null check (unit_price > 0),
  status text not null check (status in ('open', 'accepted', 'in_progress', 'fulfilled', 'cancelled', 'expired')),
  notes text null check (notes is null or char_length(trim(notes)) <= 280),
  accepted_at timestamptz null,
  due_at timestamptz null,
  expires_at timestamptz null,
  completed_at timestamptz null,
  cancelled_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (delivered_quantity <= required_quantity)
);

create index if not exists idx_contracts_owner_status_created
  on public.contracts(owner_player_id, status, created_at desc);

create index if not exists idx_contracts_business_status_due
  on public.contracts(business_id, status, due_at asc);

create index if not exists idx_contracts_item_status
  on public.contracts(item_key, status);

alter table public.contracts enable row level security;

create policy "contracts_select_own"
  on public.contracts
  for select
  using (owner_player_id = auth.uid());

create policy "contracts_insert_own"
  on public.contracts
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

create policy "contracts_update_own"
  on public.contracts
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

create policy "contracts_delete_own"
  on public.contracts
  for delete
  using (owner_player_id = auth.uid());

-- Migration complete: contracts table, ownership policies, and query indexes
