-- pay_loan_from_checking checked the checking balance against the raw requested
-- amount (p_amount) before clamping to what's actually owed (v_balance_remaining).
-- A "pay off the remainder" flow that sends a large placeholder amount could be
-- rejected as insufficient funds even though the actual (clamped) charge would be
-- affordable. Compute the clamp first, then check the balance against the clamped
-- amount that will actually be charged.

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

  -- Lock the loan row first, then the checking account (stable order across
  -- every call), so concurrent payments against the same loan serialize
  -- instead of racing on the balance checks below.
  select l.balance_remaining, l.minimum_weekly_payment, l.next_payment_due, l.status
  into v_balance_remaining, v_minimum_weekly_payment, v_next_payment_due, v_status
  from public.loans l
  where l.id = p_loan_id
    and l.player_id = p_player_id
  for update;

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

  perform 1 from public.bank_accounts where id = v_checking_account_id for update;

  select public.get_bank_account_balance(v_checking_account_id)
  into v_checking_balance;

  -- Clamp to what's actually owed before checking affordability, so a
  -- "pay off the rest" request larger than the remaining balance isn't
  -- rejected for exceeding funds that were never going to be charged.
  v_payment_amount := least(round(p_amount::numeric, 2), v_balance_remaining);

  if v_checking_balance < v_payment_amount then
    raise exception 'Insufficient checking balance for payment.';
  end if;

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
