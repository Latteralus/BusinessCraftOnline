-- Phase 13 patch: allow player-owned business-to-business fund transfers.

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

grant execute on function public.transfer_between_own_businesses(uuid, uuid, uuid, numeric, text) to authenticated;

-- Migration complete: add atomic business-to-business ledger transfer RPC.
