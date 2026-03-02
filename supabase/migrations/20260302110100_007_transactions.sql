-- Phase 3: banking domain
-- Creates immutable personal transactions ledger and transfer RPC.

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.bank_accounts(id) on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),
  direction text not null check (direction in ('credit', 'debit')),
  transaction_type text not null check (
    transaction_type in (
      'account_opening',
      'transfer_in',
      'transfer_out',
      'loan_disbursement',
      'loan_payment',
      'interest_credit',
      'manual_adjustment'
    )
  ),
  reference_id uuid null,
  description text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_transactions_account_created_at
  on public.transactions(account_id, created_at desc);

create index if not exists idx_transactions_reference_id
  on public.transactions(reference_id)
  where reference_id is not null;

alter table public.transactions enable row level security;

create policy "transactions_select_own"
  on public.transactions
  for select
  using (
    exists (
      select 1
      from public.bank_accounts ba
      where ba.id = account_id
        and ba.player_id = auth.uid()
    )
  );

create policy "transactions_insert_own"
  on public.transactions
  for insert
  with check (
    exists (
      select 1
      from public.bank_accounts ba
      where ba.id = account_id
        and ba.player_id = auth.uid()
    )
  );

create policy "transactions_update_none"
  on public.transactions
  for update
  using (false)
  with check (false);

create or replace function public.get_bank_account_balance(p_account_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(case when t.direction = 'credit' then t.amount else -t.amount end), 0)::numeric
  from public.transactions t
  where t.account_id = p_account_id;
$$;

create or replace function public.transfer_between_own_accounts(
  p_player_id uuid,
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount numeric,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transfer_id uuid := gen_random_uuid();
  v_from_balance numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Transfer amount must be greater than zero.';
  end if;

  if p_from_account_id = p_to_account_id then
    raise exception 'Origin and destination accounts must be different.';
  end if;

  if not exists (
    select 1 from public.bank_accounts
    where id = p_from_account_id and player_id = p_player_id
  ) then
    raise exception 'Origin account not owned by player.';
  end if;

  if not exists (
    select 1 from public.bank_accounts
    where id = p_to_account_id and player_id = p_player_id
  ) then
    raise exception 'Destination account not owned by player.';
  end if;

  select public.get_bank_account_balance(p_from_account_id)
  into v_from_balance;

  if v_from_balance < p_amount then
    raise exception 'Insufficient funds.';
  end if;

  insert into public.transactions (
    account_id,
    amount,
    direction,
    transaction_type,
    reference_id,
    description
  )
  values
    (
      p_from_account_id,
      p_amount,
      'debit',
      'transfer_out',
      v_transfer_id,
      coalesce(nullif(trim(p_description), ''), 'Transfer out')
    ),
    (
      p_to_account_id,
      p_amount,
      'credit',
      'transfer_in',
      v_transfer_id,
      coalesce(nullif(trim(p_description), ''), 'Transfer in')
    );

  return v_transfer_id;
end;
$$;

grant execute on function public.get_bank_account_balance(uuid) to authenticated;
grant execute on function public.transfer_between_own_accounts(uuid, uuid, uuid, numeric, text) to authenticated;

-- Migration complete: create transactions ledger with immutable rows and transfer RPC
