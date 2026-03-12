-- Phase 23 patch: allow open-market listings from personal inventory as well as businesses.
-- This separates listing source selection from purchase routing and supports personal seller settlement.

alter table public.transactions
  drop constraint if exists transactions_transaction_type_check;

alter table public.transactions
  add constraint transactions_transaction_type_check
  check (
    transaction_type in (
      'account_opening',
      'transfer_in',
      'transfer_out',
      'loan_disbursement',
      'loan_payment',
      'interest_credit',
      'manual_adjustment',
      'market_purchase',
      'market_sale',
      'shipping_fee'
    )
  );

alter table public.market_listings
  add column if not exists source_type text not null default 'business',
  add column if not exists source_personal_inventory_id uuid null references public.personal_inventory(id) on delete set null;

alter table public.market_listings
  alter column source_business_id drop not null;

update public.market_listings
set source_type = 'business'
where source_type is distinct from 'business';

alter table public.market_listings
  drop constraint if exists market_listings_source_type_check;

alter table public.market_listings
  add constraint market_listings_source_type_check
  check (source_type in ('business', 'personal'));

alter table public.market_listings
  drop constraint if exists market_listings_source_owner_check;

alter table public.market_listings
  add constraint market_listings_source_owner_check
  check (
    (source_type = 'business' and source_business_id is not null and source_personal_inventory_id is null)
    or
    (source_type = 'personal' and source_business_id is null)
  );

alter table public.market_transactions
  add column if not exists seller_source_type text not null default 'business';

alter table public.market_transactions
  alter column seller_business_id drop not null;

update public.market_transactions
set seller_source_type = 'business'
where seller_source_type is distinct from 'business';

alter table public.market_transactions
  drop constraint if exists market_transactions_seller_source_type_check;

alter table public.market_transactions
  add constraint market_transactions_seller_source_type_check
  check (seller_source_type in ('business', 'personal'));

drop policy if exists "market_listings_insert_own" on public.market_listings;

create policy "market_listings_insert_own"
  on public.market_listings
  for insert
  with check (
    owner_player_id = auth.uid()
    and (
      (
        source_type = 'business'
        and exists (
          select 1
          from public.businesses b
          where b.id = source_business_id
            and b.player_id = auth.uid()
        )
      )
      or
      (
        source_type = 'personal'
        and owner_player_id = auth.uid()
      )
    )
  );

drop policy if exists "market_listings_update_own" on public.market_listings;

create policy "market_listings_update_own"
  on public.market_listings
  for update
  using (owner_player_id = auth.uid())
  with check (
    owner_player_id = auth.uid()
    and (
      (
        source_type = 'business'
        and exists (
          select 1
          from public.businesses b
          where b.id = source_business_id
            and b.player_id = auth.uid()
        )
      )
      or
      source_type = 'personal'
    )
  );

create or replace function public.execute_market_purchase(
  p_listing_id uuid,
  p_quantity integer,
  p_buyer_business_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_player_id uuid := auth.uid();
  v_listing public.market_listings%rowtype;
  v_updated_listing public.market_listings%rowtype;
  v_buyer_business public.businesses%rowtype;
  v_source_inventory public.business_inventory%rowtype;
  v_target_inventory public.business_inventory%rowtype;
  v_now timestamptz := now();
  v_next_qty integer;
  v_next_reserved integer;
  v_next_status text;
  v_gross numeric(14, 2);
  v_fee numeric(14, 2);
  v_net numeric(14, 2);
  v_buyer_balance numeric;
  v_seller_business_name text;
  v_seller_checking_account_id uuid;
  v_tx public.market_transactions%rowtype;
begin
  if v_buyer_player_id is null then
    raise exception 'Unauthorized.';
  end if;

  if p_quantity is null or p_quantity < 1 then
    raise exception 'Quantity must be at least 1.';
  end if;

  if p_buyer_business_id is null then
    raise exception 'Buyer business id is required.';
  end if;

  select *
  into v_listing
  from public.market_listings
  where id = p_listing_id
  for update;

  if not found then
    raise exception 'Listing not found.';
  end if;

  if v_listing.status <> 'active' then
    raise exception 'Listing is not active.';
  end if;

  if p_quantity > v_listing.quantity then
    raise exception 'Requested quantity exceeds listing availability.';
  end if;

  if v_listing.owner_player_id = v_buyer_player_id then
    raise exception 'Cannot buy your own listing.';
  end if;

  select *
  into v_buyer_business
  from public.businesses
  where id = p_buyer_business_id
  for update;

  if not found or v_buyer_business.player_id <> v_buyer_player_id then
    raise exception 'Business not found.';
  end if;

  v_gross := round((v_listing.unit_price * p_quantity)::numeric, 2);
  v_fee := round((v_gross * 0.03)::numeric, 2);
  v_net := round((v_gross - v_fee)::numeric, 2);
  v_seller_business_name := case
    when v_listing.source_type = 'personal' then 'Personal Inventory'
    else null
  end;

  if v_listing.source_business_id is not null then
    select name
    into v_seller_business_name
    from public.businesses
    where id = v_listing.source_business_id;
  end if;

  select public.get_business_account_balance(p_buyer_business_id)
  into v_buyer_balance;

  if coalesce(v_buyer_balance, 0) < v_gross then
    raise exception 'Insufficient business funds.';
  end if;

  if v_listing.source_type = 'business' and v_listing.source_inventory_id is not null then
    select *
    into v_source_inventory
    from public.business_inventory
    where id = v_listing.source_inventory_id
    for update;

    if not found then
      raise exception 'Source inventory not found for listing.';
    end if;

    if v_source_inventory.quantity < p_quantity then
      raise exception 'Source inventory quantity is insufficient.';
    end if;

    if v_source_inventory.reserved_quantity < p_quantity then
      raise exception 'Source inventory reservation is insufficient.';
    end if;

    if (v_source_inventory.quantity - p_quantity) <= 0 then
      delete from public.business_inventory
      where id = v_source_inventory.id;
    else
      update public.business_inventory
      set
        quantity = v_source_inventory.quantity - p_quantity,
        reserved_quantity = greatest(
          0,
          least(v_source_inventory.quantity - p_quantity, v_source_inventory.reserved_quantity - p_quantity)
        ),
        updated_at = v_now
      where id = v_source_inventory.id;
    end if;
  end if;

  v_next_qty := v_listing.quantity - p_quantity;
  v_next_reserved := greatest(0, v_listing.reserved_quantity - p_quantity);
  v_next_status := case when v_next_qty <= 0 then 'filled' else 'active' end;

  update public.market_listings
  set
    quantity = greatest(0, v_next_qty),
    reserved_quantity = greatest(0, v_next_reserved),
    status = v_next_status,
    filled_at = case when v_next_status = 'filled' then v_now else null end,
    updated_at = v_now
  where id = v_listing.id
  returning * into v_updated_listing;

  select *
  into v_target_inventory
  from public.business_inventory
  where owner_player_id = v_buyer_player_id
    and business_id = p_buyer_business_id
    and item_key = v_listing.item_key
    and quality = v_listing.quality
  for update;

  if not found then
    insert into public.business_inventory (
      owner_player_id,
      business_id,
      city_id,
      item_key,
      quality,
      quantity,
      reserved_quantity
    )
    values (
      v_buyer_player_id,
      p_buyer_business_id,
      v_buyer_business.city_id,
      v_listing.item_key,
      v_listing.quality,
      p_quantity,
      0
    );
  else
    update public.business_inventory
    set
      quantity = v_target_inventory.quantity + p_quantity,
      updated_at = v_now
    where id = v_target_inventory.id;
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
    p_buyer_business_id,
    v_gross,
    'debit',
    'market_purchase',
    v_listing.id,
    'Market purchase: ' || p_quantity::text || 'x ' || v_listing.item_key
  );

  if v_listing.source_type = 'business' and v_listing.source_business_id is not null then
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
        v_listing.source_business_id,
        v_gross,
        'credit',
        'market_sale',
        v_listing.id,
        'PLAYER market sale: ' || p_quantity::text || 'x ' || v_listing.item_key
      ),
      (
        v_listing.source_business_id,
        v_fee,
        'debit',
        'market_fee',
        v_listing.id,
        'Market fee: ' || p_quantity::text || 'x ' || v_listing.item_key
      );
  else
    select ba.id
    into v_seller_checking_account_id
    from public.bank_accounts ba
    where ba.player_id = v_listing.owner_player_id
      and ba.account_type = 'checking'
    limit 1;

    if v_seller_checking_account_id is null then
      raise exception 'Seller checking account not found.';
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
      v_seller_checking_account_id,
      v_net,
      'credit',
      'market_sale',
      v_listing.id,
      'Market sale: ' || p_quantity::text || 'x ' || v_listing.item_key
    );
  end if;

  insert into public.market_transactions (
    listing_id,
    seller_player_id,
    buyer_player_id,
    buyer_type,
    seller_source_type,
    seller_business_id,
    seller_business_name,
    buyer_business_id,
    buyer_business_name,
    city_id,
    item_key,
    quality,
    quantity,
    unit_price,
    gross_total,
    market_fee,
    net_total
  )
  values (
    v_listing.id,
    v_listing.owner_player_id,
    v_buyer_player_id,
    'player',
    v_listing.source_type,
    v_listing.source_business_id,
    coalesce(v_seller_business_name, 'Unknown Seller'),
    p_buyer_business_id,
    coalesce(v_buyer_business.name, 'Unknown Business'),
    v_listing.city_id,
    v_listing.item_key,
    v_listing.quality,
    p_quantity,
    v_listing.unit_price,
    v_gross,
    v_fee,
    v_net
  )
  returning * into v_tx;

  return jsonb_build_object(
    'listing', to_jsonb(v_updated_listing),
    'transaction', to_jsonb(v_tx)
  );
end;
$$;

grant execute on function public.execute_market_purchase(uuid, integer, uuid) to authenticated;
