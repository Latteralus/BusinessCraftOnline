-- Phase 13: banking/business integration
-- Adds RPC for player-owned transfers between personal bank accounts and business ledgers.

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

grant execute on function public.transfer_between_personal_and_business(uuid, uuid, uuid, numeric, text, text) to authenticated;

-- Migration complete: add transactional bridge for personal<->business funds movement.
