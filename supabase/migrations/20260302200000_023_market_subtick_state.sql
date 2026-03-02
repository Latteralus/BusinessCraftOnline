-- Phase 13: market npc sub-tick execution state + transaction fidelity fields

create table if not exists public.npc_market_subtick_state (
  state_key text primary key,
  tick_window_started_at timestamptz not null,
  sub_tick_index integer not null default 0 check (sub_tick_index >= 0),
  updated_at timestamptz not null default now()
);

insert into public.npc_market_subtick_state (state_key, tick_window_started_at, sub_tick_index)
values ('global', now(), 0)
on conflict (state_key) do nothing;

alter table public.npc_market_subtick_state enable row level security;

create policy "npc_market_subtick_state_select_authenticated"
  on public.npc_market_subtick_state
  for select
  to authenticated
  using (true);

alter table public.market_transactions
  add column if not exists shopper_name text null,
  add column if not exists shopper_tier text null,
  add column if not exists shopper_budget numeric(14, 2) null,
  add column if not exists sub_tick_index integer null,
  add column if not exists tick_window_started_at timestamptz null;

create index if not exists idx_market_transactions_tick_window
  on public.market_transactions(tick_window_started_at desc, sub_tick_index desc)
  where buyer_type = 'npc';

-- Migration complete: npc market sub-tick state + transaction fidelity columns
