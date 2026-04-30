-- Harden economy RPC authorization and move shelf reservation writes into
-- transactional database functions.

update public.business_inventory
set reserved_quantity = least(greatest(reserved_quantity, 0), quantity),
    updated_at = now()
where reserved_quantity < 0
   or reserved_quantity > quantity;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'business_inventory_reserved_quantity_lte_quantity'
      and conrelid = 'public.business_inventory'::regclass
  ) then
    alter table public.business_inventory
      add constraint business_inventory_reserved_quantity_lte_quantity
      check (reserved_quantity >= 0 and reserved_quantity <= quantity);
  end if;
end
$$;

create or replace function public.get_bank_account_balance(p_account_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.role() = 'service_role'
      or exists (
        select 1
        from public.bank_accounts ba
        where ba.id = p_account_id
          and ba.player_id = auth.uid()
      )
    then (
      select coalesce(sum(case when t.direction = 'credit' then t.amount else -t.amount end), 0)::numeric
      from public.transactions t
      where t.account_id = p_account_id
    )
    else null
  end;
$$;

create or replace function public.get_business_account_balance(p_business_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.role() = 'service_role'
      or exists (
        select 1
        from public.businesses b
        where b.id = p_business_id
          and b.player_id = auth.uid()
      )
    then (
      select coalesce(sum(case when e.entry_type = 'credit' then e.amount else -e.amount end), 0)::numeric
      from public.business_accounts e
      where e.business_id = p_business_id
    )
    else null
  end;
$$;

create or replace function public.get_player_account_balances(p_player_id uuid)
returns table(account_id uuid, balance numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    ba.id as account_id,
    coalesce(
      sum(case when t.direction = 'credit' then t.amount else -t.amount end),
      0
    )::numeric as balance
  from public.bank_accounts ba
  left join public.transactions t on t.account_id = ba.id
  where ba.player_id = p_player_id
    and (
      auth.role() = 'service_role'
      or auth.uid() = p_player_id
    )
  group by ba.id;
$$;

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

  if auth.role() <> 'service_role' and auth.uid() is distinct from p_player_id then
    raise exception 'Unauthorized.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be greater than zero';
  end if;

  if p_direction not in ('credit', 'debit') then
    raise exception 'transaction direction is invalid';
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

  if auth.role() <> 'service_role' and auth.uid() is distinct from p_player_id then
    raise exception 'Unauthorized.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be greater than zero';
  end if;

  if p_entry_type not in ('credit', 'debit') then
    raise exception 'business account entry type is invalid';
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

  if auth.role() <> 'service_role' and auth.uid() is distinct from p_player_id then
    raise exception 'Unauthorized.';
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

create or replace function public.upsert_store_shelf_item_atomic(
  p_player_id uuid,
  p_business_id uuid,
  p_item_key text,
  p_quality integer,
  p_quantity integer,
  p_unit_price numeric
)
returns public.store_shelf_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business public.businesses;
  v_inventory public.business_inventory;
  v_existing public.store_shelf_items;
  v_delta integer;
  v_available integer;
  v_row public.store_shelf_items;
begin
  if p_player_id is null or auth.uid() is distinct from p_player_id then
    raise exception 'Unauthorized.';
  end if;

  if p_item_key is null or char_length(trim(p_item_key)) < 1 or char_length(trim(p_item_key)) > 64 then
    raise exception 'Item key is invalid.';
  end if;

  if p_quality is null or p_quality < 1 or p_quality > 100 then
    raise exception 'Quality is invalid.';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Shelf quantity must be greater than zero.';
  end if;

  if p_unit_price is null or p_unit_price <= 0 then
    raise exception 'Shelf price must be greater than zero.';
  end if;

  select *
  into v_business
  from public.businesses
  where id = p_business_id
    and player_id = p_player_id
    and type in ('general_store', 'specialty_store')
  for update;

  if v_business.id is null then
    raise exception 'Store business not found.';
  end if;

  select *
  into v_inventory
  from public.business_inventory
  where owner_player_id = p_player_id
    and business_id = p_business_id
    and item_key = p_item_key
    and quality = p_quality
  for update;

  if v_inventory.id is null then
    raise exception 'Business inventory item not found for requested shelf item.';
  end if;

  select *
  into v_existing
  from public.store_shelf_items
  where owner_player_id = p_player_id
    and business_id = p_business_id
    and item_key = p_item_key
    and quality = p_quality
  for update;

  v_delta := p_quantity - coalesce(v_existing.quantity, 0);
  v_available := v_inventory.quantity - v_inventory.reserved_quantity;

  if v_delta > v_available then
    raise exception 'Not enough available inventory to stock that many items on the shelf.';
  end if;

  update public.business_inventory
  set reserved_quantity = least(v_inventory.quantity, greatest(0, v_inventory.reserved_quantity + v_delta)),
      updated_at = now()
  where id = v_inventory.id;

  if v_existing.id is not null then
    update public.store_shelf_items
    set quantity = p_quantity,
        unit_price = p_unit_price,
        updated_at = now()
    where id = v_existing.id
    returning * into v_row;
  else
    insert into public.store_shelf_items (
      owner_player_id,
      business_id,
      item_key,
      quality,
      quantity,
      unit_price
    )
    values (
      p_player_id,
      p_business_id,
      p_item_key,
      p_quality,
      p_quantity,
      p_unit_price
    )
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

create or replace function public.remove_store_shelf_item_atomic(
  p_player_id uuid,
  p_shelf_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shelf public.store_shelf_items;
  v_inventory public.business_inventory;
begin
  if p_player_id is null or auth.uid() is distinct from p_player_id then
    raise exception 'Unauthorized.';
  end if;

  select *
  into v_shelf
  from public.store_shelf_items
  where id = p_shelf_item_id
    and owner_player_id = p_player_id
  for update;

  if v_shelf.id is null then
    raise exception 'Shelf item not found.';
  end if;

  select *
  into v_inventory
  from public.business_inventory
  where owner_player_id = p_player_id
    and business_id = v_shelf.business_id
    and item_key = v_shelf.item_key
    and quality = v_shelf.quality
  for update;

  if v_inventory.id is not null then
    update public.business_inventory
    set reserved_quantity = least(
          v_inventory.quantity,
          greatest(0, v_inventory.reserved_quantity - v_shelf.quantity)
        ),
        updated_at = now()
    where id = v_inventory.id;
  end if;

  delete from public.store_shelf_items
  where id = v_shelf.id;
end;
$$;

drop policy if exists "market_transactions_insert_authenticated" on public.market_transactions;

create policy "market_transactions_insert_service"
  on public.market_transactions
  for insert
  to service_role
  with check (true);

create or replace function public.register_player(p_username text, p_password text, p_email text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_player_id uuid;
begin
  insert into public.players (username, password_hash, email)
  values (p_username, crypt(p_password, gen_salt('bf')), p_email)
  returning id into new_player_id;

  return new_player_id;
end;
$$;

create or replace function public.authenticate_player(p_username text, p_password text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  found_player_id uuid;
begin
  select id
  into found_player_id
  from public.players
  where username = p_username
    and password_hash = crypt(p_password, password_hash);

  if found_player_id is null then
    raise exception 'Invalid username or password';
  end if;

  return found_player_id;
end;
$$;

revoke all on function public.register_player(text, text, text) from public;
revoke all on function public.authenticate_player(text, text) from public;
revoke all on function public.get_bank_account_balance(uuid) from public;
revoke all on function public.get_business_account_balance(uuid) from public;
revoke all on function public.get_player_account_balances(uuid) from public;
revoke all on function public.append_personal_transaction(uuid, uuid, numeric, text, text, text, uuid) from public;
revoke all on function public.append_business_account_entry(uuid, uuid, numeric, text, text, text, uuid) from public;
revoke all on function public.append_business_financial_event(uuid, uuid, text, numeric, text, integer, text, text, uuid, timestamptz, jsonb) from public;
revoke all on function public.upsert_store_shelf_item_atomic(uuid, uuid, text, integer, integer, numeric) from public;
revoke all on function public.remove_store_shelf_item_atomic(uuid, uuid) from public;

grant execute on function public.register_player(text, text, text) to anon;
grant execute on function public.authenticate_player(text, text) to anon;
grant execute on function public.get_bank_account_balance(uuid) to authenticated, service_role;
grant execute on function public.get_business_account_balance(uuid) to authenticated, service_role;
grant execute on function public.get_player_account_balances(uuid) to authenticated, service_role;
grant execute on function public.append_personal_transaction(uuid, uuid, numeric, text, text, text, uuid) to authenticated, service_role;
grant execute on function public.append_business_account_entry(uuid, uuid, numeric, text, text, text, uuid) to authenticated, service_role;
grant execute on function public.append_business_financial_event(uuid, uuid, text, numeric, text, integer, text, text, uuid, timestamptz, jsonb) to authenticated, service_role;
grant execute on function public.upsert_store_shelf_item_atomic(uuid, uuid, text, integer, integer, numeric) to authenticated;
grant execute on function public.remove_store_shelf_item_atomic(uuid, uuid) to authenticated;
