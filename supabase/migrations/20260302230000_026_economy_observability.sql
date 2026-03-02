-- Phase 16: economy observability + admin-safe analytics

alter table public.players
  add column if not exists role text not null default 'player'
  check (role in ('player', 'admin'));

create index if not exists idx_players_role on public.players(role);

create table if not exists public.tick_run_logs (
  id uuid primary key default gen_random_uuid(),
  tick_name text not null,
  status text not null check (status in ('ok', 'error')),
  started_at timestamptz not null,
  finished_at timestamptz not null,
  duration_ms integer not null default 0,
  processed_count integer not null default 0,
  metrics jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_tick_run_logs_tick_created
  on public.tick_run_logs(tick_name, created_at desc);

create index if not exists idx_tick_run_logs_created
  on public.tick_run_logs(created_at desc);

alter table public.tick_run_logs enable row level security;

create policy "tick_run_logs_select_authenticated"
  on public.tick_run_logs
  for select
  using (auth.uid() is not null);

create table if not exists public.market_storefront_performance_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_player_id uuid not null references public.players(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  city_id uuid not null references public.cities(id),
  tick_window_started_at timestamptz,
  sub_tick_index integer,
  shoppers_generated integer not null default 0,
  sales_count integer not null default 0,
  units_sold integer not null default 0,
  gross_revenue numeric(14,2) not null default 0,
  fee_total numeric(14,2) not null default 0,
  ad_spend numeric(14,2) not null default 0,
  traffic_multiplier numeric(8,3) not null default 1,
  demand_multiplier numeric(8,3) not null default 1,
  captured_at timestamptz not null default now()
);

create index if not exists idx_market_snapshots_owner_captured
  on public.market_storefront_performance_snapshots(owner_player_id, captured_at desc);

create index if not exists idx_market_snapshots_business_captured
  on public.market_storefront_performance_snapshots(business_id, captured_at desc);

create index if not exists idx_market_snapshots_captured
  on public.market_storefront_performance_snapshots(captured_at desc);

alter table public.market_storefront_performance_snapshots enable row level security;

create policy "market_storefront_snapshots_select_owner"
  on public.market_storefront_performance_snapshots
  for select
  using (owner_player_id = auth.uid());

create policy "market_storefront_snapshots_select_admin"
  on public.market_storefront_performance_snapshots
  for select
  using (
    exists (
      select 1
      from public.players p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  );

-- No insert/update/delete policies for observability tables. Writes are performed by service role only.
