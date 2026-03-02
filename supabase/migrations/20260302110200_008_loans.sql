-- Phase 3: banking domain
-- Creates loans table and atomic RPCs for loan disbursement and repayment.

create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  principal numeric(14, 2) not null check (principal > 0),
  interest_rate numeric(5, 2) not null default 8.00 check (interest_rate >= 0),
  balance_remaining numeric(14, 2) not null check (balance_remaining >= 0),
  minimum_weekly_payment numeric(14, 2) not null check (minimum_weekly_payment > 0),
  next_payment_due timestamptz null,
  last_payment_at timestamptz null,
  missed_payment_count integer not null default 0 check (missed_payment_count >= 0),
  status text not null default 'active' check (status in ('active', 'paid', 'defaulted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_loans_player_status
  on public.loans(player_id, status);

create index if not exists idx_loans_due_active
  on public.loans(next_payment_due)
  where status = 'active';

alter table public.loans enable row level security;

create policy "loans_select_own"
  on public.loans
  for select
  using (player_id = auth.uid());

create policy "loans_insert_own"
  on public.loans
  for insert
  with check (player_id = auth.uid());

create policy "loans_update_own"
  on public.loans
  for update
  using (player_id = auth.uid())
  with check (player_id = auth.uid());

create or replace function public.create_loan_for_player(
  p_player_id uuid,
  p_principal numeric,
  p_interest_rate numeric,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan_id uuid := gen_random_uuid();
  v_checking_account_id uuid;
  v_minimum_payment numeric(14, 2);
begin
  if p_principal is null or p_principal < 1000 or p_principal > 50000 then
    raise exception 'Loan principal must be between 1000 and 50000.';
  end if;

  if exists (
    select 1
    from public.loans l
    where l.player_id = p_player_id
      and l.status = 'active'
  ) then
    raise exception 'Player already has an active loan.';
  end if;

  select ba.id
  into v_checking_account_id
  from public.bank_accounts ba
  where ba.player_id = p_player_id
    and ba.account_type = 'checking'
  limit 1;

  if v_checking_account_id is null then
    raise exception 'Checking account not found for player.';
  end if;

  v_minimum_payment := round((p_principal * 0.10)::numeric, 2);

  insert into public.loans (
    id,
    player_id,
    principal,
    interest_rate,
    balance_remaining,
    minimum_weekly_payment,
    next_payment_due,
    status
  )
  values (
    v_loan_id,
    p_player_id,
    round(p_principal::numeric, 2),
    coalesce(p_interest_rate, 8.00),
    round(p_principal::numeric, 2),
    v_minimum_payment,
    now() + interval '7 days',
    'active'
  );

  insert into public.transactions (
    account_id,
    amount,
    direction,
    transaction_type,
    reference_id,
    description
  )
  values (
    v_checking_account_id,
    round(p_principal::numeric, 2),
    'credit',
    'loan_disbursement',
    v_loan_id,
    coalesce(nullif(trim(p_description), ''), 'Loan disbursement')
  );

  return v_loan_id;
end;
$$;

create or replace function public.pay_loan_from_checking(
  p_player_id uuid,
  p_loan_id uuid,
  p_amount numeric,
  p_description text default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checking_account_id uuid;
  v_balance_remaining numeric;
  v_minimum_weekly_payment numeric;
  v_next_payment_due timestamptz;
  v_status text;
  v_checking_balance numeric;
  v_payment_amount numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;

  select l.balance_remaining, l.minimum_weekly_payment, l.next_payment_due, l.status
  into v_balance_remaining, v_minimum_weekly_payment, v_next_payment_due, v_status
  from public.loans l
  where l.id = p_loan_id
    and l.player_id = p_player_id
  limit 1;

  if v_balance_remaining is null then
    raise exception 'Loan not found for player.';
  end if;

  if v_status <> 'active' then
    raise exception 'Only active loans can be paid.';
  end if;

  select ba.id
  into v_checking_account_id
  from public.bank_accounts ba
  where ba.player_id = p_player_id
    and ba.account_type = 'checking'
  limit 1;

  if v_checking_account_id is null then
    raise exception 'Checking account not found for player.';
  end if;

  select public.get_bank_account_balance(v_checking_account_id)
  into v_checking_balance;

  if v_checking_balance < p_amount then
    raise exception 'Insufficient checking balance for payment.';
  end if;

  v_payment_amount := least(round(p_amount::numeric, 2), v_balance_remaining);

  insert into public.transactions (
    account_id,
    amount,
    direction,
    transaction_type,
    reference_id,
    description
  )
  values (
    v_checking_account_id,
    v_payment_amount,
    'debit',
    'loan_payment',
    p_loan_id,
    coalesce(nullif(trim(p_description), ''), 'Loan repayment')
  );

  update public.loans
  set
    balance_remaining = round(greatest(v_balance_remaining - v_payment_amount, 0)::numeric, 2),
    last_payment_at = now(),
    next_payment_due = case
      when (v_balance_remaining - v_payment_amount) <= 0 then null
      when v_payment_amount >= v_minimum_weekly_payment then greatest(coalesce(v_next_payment_due, now()), now()) + interval '7 days'
      else v_next_payment_due
    end,
    missed_payment_count = case
      when v_payment_amount >= v_minimum_weekly_payment then 0
      else missed_payment_count
    end,
    status = case
      when (v_balance_remaining - v_payment_amount) <= 0 then 'paid'
      else 'active'
    end,
    updated_at = now()
  where id = p_loan_id
    and player_id = p_player_id;

  return v_payment_amount;
end;
$$;

grant execute on function public.create_loan_for_player(uuid, numeric, numeric, text) to authenticated;
grant execute on function public.pay_loan_from_checking(uuid, uuid, numeric, text) to authenticated;

-- Migration complete: create loans table and atomic loan disbursement/payment RPCs
