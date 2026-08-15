-- Critical security hardening.
--
-- 1. append_personal_transaction / append_business_account_entry were granted
--    EXECUTE to `authenticated` and only checked account ownership, never who
--    was allowed to call them or what transaction_type/category was used.
--    Any player could POST straight to PostgREST with their own JWT + the
--    anon key and credit themselves arbitrary amounts (e.g.
--    transaction_type: 'manual_adjustment'). These are internal helpers the
--    app itself calls with a service-role client; restrict EXECUTE to
--    service_role only.
--
-- 2. players_update_own allowed a player to PATCH their own `role` column to
--    'admin' via PostgREST, which requireAdminUser() trusted blindly. Add a
--    trigger that reverts any change to `role` unless the actor is
--    service_role.
--
-- 3. transfer_between_own_accounts, transfer_between_personal_and_business,
--    transfer_between_own_businesses, and pay_loan_from_checking all read a
--    balance and then wrote a debit in a separate statement with no lock,
--    allowing two concurrent requests to both pass the balance check before
--    either commits (double-spend). Lock the underlying account/loan rows
--    with SELECT ... FOR UPDATE before checking balances.

-- ---------------------------------------------------------------------------
-- 1. Restrict the internal ledger-append RPCs to service_role only.
-- ---------------------------------------------------------------------------

revoke execute on function public.append_personal_transaction(uuid, uuid, numeric, text, text, text, uuid) from authenticated;
revoke execute on function public.append_business_account_entry(uuid, uuid, numeric, text, text, text, uuid) from authenticated;

grant execute on function public.append_personal_transaction(uuid, uuid, numeric, text, text, text, uuid) to service_role;
grant execute on function public.append_business_account_entry(uuid, uuid, numeric, text, text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Block self-promotion to admin via direct PostgREST updates.
-- ---------------------------------------------------------------------------

create or replace function public.prevent_player_role_self_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and new.role is distinct from old.role then
    new.role := old.role;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_players_prevent_role_escalation on public.players;

create trigger trg_players_prevent_role_escalation
  before update on public.players
  for each row
  execute function public.prevent_player_role_self_escalation();

-- ---------------------------------------------------------------------------
-- 3. Lock account/loan rows before checking balances to close the
--    double-spend race in the transfer and loan-payment RPCs.
-- ---------------------------------------------------------------------------

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

  -- Lock both accounts in a stable order so concurrent transfers touching
  -- the same pair of accounts serialize instead of racing on the balance
  -- check below.
  perform 1
  from public.bank_accounts
  where id in (p_from_account_id, p_to_account_id)
  order by id
  for update;

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

create or replace function public.transfer_between_personal_and_business(
  p_player_id uuid,
  p_personal_account_id uuid,
  p_business_id uuid,
  p_amount numeric,
  p_direction text,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transfer_id uuid := gen_random_uuid();
  v_personal_balance numeric;
  v_business_balance numeric;
  v_description text;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Transfer amount must be greater than zero.';
  end if;

  if p_direction not in ('to_business', 'from_business') then
    raise exception 'Transfer direction must be to_business or from_business.';
  end if;

  -- Always lock the personal account before the business row (consistent
  -- order across every call) so concurrent transfers touching the same pair
  -- serialize instead of racing on the balance checks below.
  perform 1 from public.bank_accounts where id = p_personal_account_id for update;
  perform 1 from public.businesses where id = p_business_id for update;

  if not exists (
    select 1
    from public.bank_accounts ba
    where ba.id = p_personal_account_id
      and ba.player_id = p_player_id
  ) then
    raise exception 'Personal account not owned by player.';
  end if;

  if not exists (
    select 1
    from public.businesses b
    where b.id = p_business_id
      and b.player_id = p_player_id
  ) then
    raise exception 'Business not owned by player.';
  end if;

  v_description := coalesce(nullif(trim(p_description), ''), 'Owner transfer');

  if p_direction = 'to_business' then
    select public.get_bank_account_balance(p_personal_account_id) into v_personal_balance;
    if v_personal_balance < p_amount then
      raise exception 'Insufficient personal funds.';
    end if;

    insert into public.transactions (
      account_id,
      amount,
      direction,
      transaction_type,
      reference_id,
      description
    ) values (
      p_personal_account_id,
      p_amount,
      'debit',
      'transfer_out',
      v_transfer_id,
      v_description
    );

    insert into public.business_accounts (
      business_id,
      amount,
      entry_type,
      category,
      reference_id,
      description
    ) values (
      p_business_id,
      p_amount,
      'credit',
      'owner_transfer_in',
      v_transfer_id,
      v_description
    );
  else
    select public.get_business_account_balance(p_business_id) into v_business_balance;
    if v_business_balance < p_amount then
      raise exception 'Insufficient business funds.';
    end if;

    insert into public.business_accounts (
      business_id,
      amount,
      entry_type,
      category,
      reference_id,
      description
    ) values (
      p_business_id,
      p_amount,
      'debit',
      'owner_transfer_out',
      v_transfer_id,
      v_description
    );

    insert into public.transactions (
      account_id,
      amount,
      direction,
      transaction_type,
      reference_id,
      description
    ) values (
      p_personal_account_id,
      p_amount,
      'credit',
      'transfer_in',
      v_transfer_id,
      v_description
    );
  end if;

  return v_transfer_id;
end;
$$;

create or replace function public.transfer_between_own_businesses(
  p_player_id uuid,
  p_from_business_id uuid,
  p_to_business_id uuid,
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
  v_description text;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Transfer amount must be greater than zero.';
  end if;

  if p_from_business_id = p_to_business_id then
    raise exception 'Origin and destination businesses must be different.';
  end if;

  -- Lock both businesses in a stable order so concurrent transfers touching
  -- the same pair serialize instead of racing on the balance check below.
  perform 1
  from public.businesses
  where id in (p_from_business_id, p_to_business_id)
  order by id
  for update;

  if not exists (
    select 1
    from public.businesses b
    where b.id = p_from_business_id
      and b.player_id = p_player_id
  ) then
    raise exception 'Origin business not owned by player.';
  end if;

  if not exists (
    select 1
    from public.businesses b
    where b.id = p_to_business_id
      and b.player_id = p_player_id
  ) then
    raise exception 'Destination business not owned by player.';
  end if;

  select public.get_business_account_balance(p_from_business_id) into v_from_balance;

  if v_from_balance < p_amount then
    raise exception 'Insufficient business funds.';
  end if;

  v_description := coalesce(nullif(trim(p_description), ''), 'Business transfer');

  insert into public.business_accounts (
    business_id,
    amount,
    entry_type,
    category,
    reference_id,
    description
  )
  values
    (
      p_from_business_id,
      p_amount,
      'debit',
      'business_transfer_out',
      v_transfer_id,
      v_description
    ),
    (
      p_to_business_id,
      p_amount,
      'credit',
      'business_transfer_in',
      v_transfer_id,
      v_description
    );

  return v_transfer_id;
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
