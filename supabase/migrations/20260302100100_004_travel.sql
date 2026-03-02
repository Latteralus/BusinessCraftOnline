-- Phase 2: cities-travel domain
-- Creates the travel_log table owned by cities-travel.

create table if not exists public.travel_log (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  from_city_id uuid not null references public.cities(id) on delete restrict,
  to_city_id uuid not null references public.cities(id) on delete restrict,
  departs_at timestamptz not null default now(),
  arrives_at timestamptz not null,
  cost numeric(12, 2) not null check (cost >= 0),
  status text not null default 'traveling' check (status in ('traveling', 'arrived', 'cancelled')),
  created_at timestamptz not null default now(),
  check (from_city_id <> to_city_id),
  check (arrives_at >= departs_at)
);

create unique index if not exists idx_travel_log_one_active_per_player
  on public.travel_log(player_id)
  where status = 'traveling';

create index if not exists idx_travel_log_player_status
  on public.travel_log(player_id, status);

create index if not exists idx_travel_log_arrives_at
  on public.travel_log(arrives_at);

alter table public.travel_log enable row level security;

create policy "travel_log_select_own"
  on public.travel_log
  for select
  using (player_id = auth.uid());

create policy "travel_log_insert_own"
  on public.travel_log
  for insert
  with check (player_id = auth.uid());

create policy "travel_log_update_own"
  on public.travel_log
  for update
  using (player_id = auth.uid())
  with check (player_id = auth.uid());

-- Migration complete: create travel_log table with RLS and active-travel constraints
