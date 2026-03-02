-- Phase 5: businesses domain
-- Creates business_upgrades table owned by businesses.

create table if not exists public.business_upgrades (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  upgrade_key text not null check (char_length(trim(upgrade_key)) between 1 and 64),
  level integer not null check (level > 0),
  purchased_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, upgrade_key)
);

create index if not exists idx_business_upgrades_business
  on public.business_upgrades(business_id);

alter table public.business_upgrades enable row level security;

create policy "business_upgrades_select_own"
  on public.business_upgrades
  for select
  using (
    exists (
      select 1
      from public.businesses b
      where b.id = business_id
        and b.player_id = auth.uid()
    )
  );

create policy "business_upgrades_insert_own"
  on public.business_upgrades
  for insert
  with check (
    exists (
      select 1
      from public.businesses b
      where b.id = business_id
        and b.player_id = auth.uid()
    )
  );

create policy "business_upgrades_update_own"
  on public.business_upgrades
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

-- Migration complete: create business_upgrades table with ownership constraints and RLS
