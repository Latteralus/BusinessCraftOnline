-- Harden authoritative simulation writes and close inventory integrity gaps.

create index if not exists idx_business_accounts_business_category_created
  on public.business_accounts(business_id, category, created_at desc);

create index if not exists idx_transactions_account_type_created
  on public.transactions(account_id, transaction_type, created_at desc);

create index if not exists idx_market_transactions_seller_business_buyer_created
  on public.market_transactions(seller_business_id, buyer_type, created_at desc);

create index if not exists idx_business_financial_events_business_reference
  on public.business_financial_events(business_id, reference_type, effective_at desc)
  where reference_type is not null;

delete from public.business_inventory bi
where not exists (
  select 1
  from public.businesses b
  where b.id = bi.business_id
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'business_inventory_business_id_fkey'
      and conrelid = 'public.business_inventory'::regclass
  ) then
    alter table public.business_inventory
      add constraint business_inventory_business_id_fkey
      foreign key (business_id)
      references public.businesses(id)
      on delete cascade;
  end if;
end
$$;

drop policy if exists "business_inventory_select_own" on public.business_inventory;
drop policy if exists "business_inventory_insert_own" on public.business_inventory;
drop policy if exists "business_inventory_update_own" on public.business_inventory;
drop policy if exists "business_inventory_delete_own" on public.business_inventory;

create policy "business_inventory_select_own"
  on public.business_inventory
  for select
  using (
    owner_player_id = auth.uid()
    and exists (
      select 1
      from public.businesses b
      where b.id = business_inventory.business_id
        and b.player_id = business_inventory.owner_player_id
    )
  );

create policy "business_inventory_insert_own"
  on public.business_inventory
  for insert
  with check (
    owner_player_id = auth.uid()
    and exists (
      select 1
      from public.businesses b
      where b.id = business_inventory.business_id
        and b.player_id = business_inventory.owner_player_id
    )
  );

create policy "business_inventory_update_own"
  on public.business_inventory
  for update
  using (
    owner_player_id = auth.uid()
    and exists (
      select 1
      from public.businesses b
      where b.id = business_inventory.business_id
        and b.player_id = business_inventory.owner_player_id
    )
  )
  with check (
    owner_player_id = auth.uid()
    and exists (
      select 1
      from public.businesses b
      where b.id = business_inventory.business_id
        and b.player_id = business_inventory.owner_player_id
    )
  );

create policy "business_inventory_delete_own"
  on public.business_inventory
  for delete
  using (
    owner_player_id = auth.uid()
    and exists (
      select 1
      from public.businesses b
      where b.id = business_inventory.business_id
        and b.player_id = business_inventory.owner_player_id
    )
  );

create or replace function public.append_personal_transaction(
  p_player_id uuid,
  p_account_id uuid,
  p_amount numeric,
  p_direction text,
  p_transaction_type text,
  p_description text,
  p_reference_id uuid default null
)
returns public.transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.transactions;
begin
  if p_player_id is null then
    raise exception 'player id is required';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be greater than zero';
  end if;

  if not exists (
    select 1
    from public.bank_accounts ba
    where ba.id = p_account_id
      and ba.player_id = p_player_id
  ) then
    raise exception 'bank account not owned by player';
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
    p_account_id,
    p_amount,
    p_direction,
    p_transaction_type,
    p_reference_id,
    p_description
  )
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.append_business_account_entry(
  p_player_id uuid,
  p_business_id uuid,
  p_amount numeric,
  p_entry_type text,
  p_category text,
  p_description text,
  p_reference_id uuid default null
)
returns public.business_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.business_accounts;
begin
  if p_player_id is null then
    raise exception 'player id is required';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be greater than zero';
  end if;

  if not exists (
    select 1
    from public.businesses b
    where b.id = p_business_id
      and b.player_id = p_player_id
  ) then
    raise exception 'business not owned by player';
  end if;

  insert into public.business_accounts (
    business_id,
    amount,
    entry_type,
    category,
    reference_id,
    description
  )
  values (
    p_business_id,
    p_amount,
    p_entry_type,
    p_category,
    p_reference_id,
    p_description
  )
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.append_business_financial_event(
  p_player_id uuid,
  p_business_id uuid,
  p_account_code text,
  p_amount numeric,
  p_description text,
  p_quantity integer default null,
  p_item_key text default null,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_effective_at timestamptz default now(),
  p_metadata jsonb default '{}'::jsonb
)
returns public.business_financial_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.business_financial_events;
begin
  if p_player_id is null then
    raise exception 'player id is required';
  end if;

  if p_amount is null or p_amount < 0 then
    raise exception 'amount must be zero or greater';
  end if;

  if not exists (
    select 1
    from public.businesses b
    where b.id = p_business_id
      and b.player_id = p_player_id
  ) then
    raise exception 'business not owned by player';
  end if;

  insert into public.business_financial_events (
    business_id,
    account_code,
    amount,
    quantity,
    item_key,
    reference_type,
    reference_id,
    description,
    effective_at,
    metadata
  )
  values (
    p_business_id,
    p_account_code,
    p_amount,
    p_quantity,
    p_item_key,
    p_reference_type,
    p_reference_id,
    p_description,
    coalesce(p_effective_at, now()),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.append_personal_transaction(uuid, uuid, numeric, text, text, text, uuid) from public;
revoke all on function public.append_business_account_entry(uuid, uuid, numeric, text, text, text, uuid) from public;
revoke all on function public.append_business_financial_event(uuid, uuid, text, numeric, text, integer, text, text, uuid, timestamptz, jsonb) from public;

grant execute on function public.append_personal_transaction(uuid, uuid, numeric, text, text, text, uuid) to authenticated;
grant execute on function public.append_business_account_entry(uuid, uuid, numeric, text, text, text, uuid) to authenticated;
grant execute on function public.append_business_financial_event(uuid, uuid, text, numeric, text, integer, text, text, uuid, timestamptz, jsonb) to authenticated;

drop policy if exists "transactions_insert_own" on public.transactions;
drop policy if exists "business_accounts_insert_own" on public.business_accounts;
drop policy if exists "business_financial_events_insert_own" on public.business_financial_events;

-- Service-role insert policy remains on business_financial_events for edge tick functions.
