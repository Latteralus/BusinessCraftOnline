-- Phase 3: banking domain
-- Creates personal bank accounts owned by banking.

create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  account_type text not null check (account_type in ('pocket_cash', 'checking', 'savings', 'investment')),
  opened_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (player_id, account_type)
);

create index if not exists idx_bank_accounts_player
  on public.bank_accounts(player_id);

alter table public.bank_accounts enable row level security;

create policy "bank_accounts_select_own"
  on public.bank_accounts
  for select
  using (player_id = auth.uid());

create policy "bank_accounts_insert_own"
  on public.bank_accounts
  for insert
  with check (player_id = auth.uid());

create policy "bank_accounts_update_own"
  on public.bank_accounts
  for update
  using (player_id = auth.uid())
  with check (player_id = auth.uid());

-- Migration complete: create bank_accounts table with ownership constraints and RLS
