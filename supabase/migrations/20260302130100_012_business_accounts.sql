-- Phase 5: businesses domain
-- Creates business_accounts ledger table and balance RPC owned by businesses.

create table if not exists public.business_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),
  entry_type text not null check (entry_type in ('credit', 'debit')),
  category text not null check (char_length(trim(category)) between 1 and 64),
  reference_id uuid null,
  description text not null check (char_length(trim(description)) between 1 and 220),
  created_at timestamptz not null default now()
);

create index if not exists idx_business_accounts_business_created
  on public.business_accounts(business_id, created_at desc);

create index if not exists idx_business_accounts_reference
  on public.business_accounts(reference_id)
  where reference_id is not null;

alter table public.business_accounts enable row level security;

create policy "business_accounts_select_own"
  on public.business_accounts
  for select
  using (
    exists (
      select 1
      from public.businesses b
      where b.id = business_id
        and b.player_id = auth.uid()
    )
  );

create policy "business_accounts_insert_own"
  on public.business_accounts
  for insert
  with check (
    exists (
      select 1
      from public.businesses b
      where b.id = business_id
        and b.player_id = auth.uid()
    )
  );

create policy "business_accounts_update_none"
  on public.business_accounts
  for update
  using (false)
  with check (false);

create or replace function public.get_business_account_balance(p_business_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(case when e.entry_type = 'credit' then e.amount else -e.amount end), 0)::numeric
  from public.business_accounts e
  where e.business_id = p_business_id;
$$;

grant execute on function public.get_business_account_balance(uuid) to authenticated;

-- Migration complete: create business_accounts ledger table with RLS and balance RPC
