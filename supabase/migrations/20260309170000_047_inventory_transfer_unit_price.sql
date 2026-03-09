-- Phase 21 patch: require sale pricing for business-to-business inventory transfers.

alter table public.shipping_queue
  add column if not exists quality integer not null default 40,
  add column if not exists declared_unit_price numeric(14,2);

alter table public.shipping_queue
  drop constraint if exists shipping_queue_quality_check;

alter table public.shipping_queue
  add constraint shipping_queue_quality_check
  check (quality >= 1 and quality <= 100);

alter table public.shipping_queue
  drop constraint if exists shipping_queue_declared_unit_price_check;

alter table public.shipping_queue
  add constraint shipping_queue_declared_unit_price_check
  check (declared_unit_price is null or declared_unit_price >= 1);

drop function if exists public.execute_inventory_transfer(
  text,
  uuid,
  uuid,
  text,
  uuid,
  uuid,
  text,
  integer,
  integer,
  numeric,
  integer,
  uuid
);

create or replace function public.execute_inventory_transfer(
  p_source_type text,
  p_source_business_id uuid,
  p_source_city_id uuid,
  p_destination_type text,
  p_destination_business_id uuid,
  p_destination_city_id uuid,
  p_item_key text,
  p_quality integer,
  p_quantity integer,
  p_shipping_cost numeric,
  p_shipping_minutes integer,
  p_funding_account_id uuid,
  p_unit_price numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid := auth.uid();
  v_now timestamptz := now();
  v_source_city_id uuid;
  v_destination_city_id uuid;
  v_source_business public.businesses%rowtype;
  v_destination_business public.businesses%rowtype;
  v_source_personal public.personal_inventory%rowtype;
  v_source_business_inventory public.business_inventory%rowtype;
  v_destination_personal public.personal_inventory%rowtype;
  v_destination_business_inventory public.business_inventory%rowtype;
  v_shipment public.shipping_queue%rowtype;
  v_transfer_type text;
  v_funding_account public.bank_accounts%rowtype;
  v_funding_balance numeric;
begin
  if v_player_id is null then
    raise exception 'Unauthorized.';
  end if;

  if p_source_type not in ('personal', 'business') then
    raise exception 'Invalid source type.';
  end if;

  if p_destination_type not in ('personal', 'business') then
    raise exception 'Invalid destination type.';
  end if;

  if p_quantity is null or p_quantity < 1 then
    raise exception 'Quantity must be at least 1.';
  end if;

  if p_quality is null or p_quality < 1 or p_quality > 100 then
    raise exception 'Quality must be between 1 and 100.';
  end if;

  if p_item_key is null or char_length(trim(p_item_key)) = 0 then
    raise exception 'Item key is required.';
  end if;

  if p_source_type = 'business' and p_destination_type = 'business' and (p_unit_price is null or p_unit_price < 1) then
    raise exception 'Unit price is required for business-to-business transfers and must be at least $1.';
  end if;

  if p_source_type = 'business' then
    if p_source_business_id is null then
      raise exception 'Source business id is required for business source.';
    end if;

    select * into v_source_business
    from public.businesses
    where id = p_source_business_id
    for update;

    if not found or v_source_business.player_id <> v_player_id then
      raise exception 'Source business not found.';
    end if;

    v_source_city_id := v_source_business.city_id;
  else
    if p_source_city_id is null then
      raise exception 'Source city id is required for personal source.';
    end if;
    v_source_city_id := p_source_city_id;
  end if;

  if p_destination_type = 'business' then
    if p_destination_business_id is null then
      raise exception 'Destination business id is required for business destination.';
    end if;

    select * into v_destination_business
    from public.businesses
    where id = p_destination_business_id
    for update;

    if not found or v_destination_business.player_id <> v_player_id then
      raise exception 'Destination business not found.';
    end if;

    v_destination_city_id := v_destination_business.city_id;
  else
    if p_destination_city_id is null then
      raise exception 'Destination city id is required for personal destination.';
    end if;
    v_destination_city_id := p_destination_city_id;
  end if;

  if v_source_city_id = v_destination_city_id then
    v_transfer_type := 'same_city';
  else
    v_transfer_type := 'shipping';
  end if;

  if p_source_type = 'personal' then
    select * into v_source_personal
    from public.personal_inventory
    where player_id = v_player_id
      and item_key = p_item_key
      and quality = p_quality
    for update;

    if not found then
      raise exception 'Source personal inventory item not found.';
    end if;

    if v_source_personal.quantity < p_quantity then
      raise exception 'Insufficient quantity in personal inventory.';
    end if;

    if (v_source_personal.quantity - p_quantity) <= 0 then
      delete from public.personal_inventory where id = v_source_personal.id;
    else
      update public.personal_inventory
      set quantity = v_source_personal.quantity - p_quantity, updated_at = v_now
      where id = v_source_personal.id;
    end if;
  else
    select * into v_source_business_inventory
    from public.business_inventory
    where owner_player_id = v_player_id
      and business_id = p_source_business_id
      and item_key = p_item_key
      and quality = p_quality
    for update;

    if not found then
      raise exception 'Source business inventory item not found.';
    end if;

    if (v_source_business_inventory.quantity - v_source_business_inventory.reserved_quantity) < p_quantity then
      raise exception 'Insufficient available quantity in business inventory.';
    end if;

    if (v_source_business_inventory.quantity - p_quantity) <= 0 then
      delete from public.business_inventory where id = v_source_business_inventory.id;
    else
      update public.business_inventory
      set
        quantity = v_source_business_inventory.quantity - p_quantity,
        reserved_quantity = least(
          v_source_business_inventory.reserved_quantity,
          v_source_business_inventory.quantity - p_quantity
        ),
        updated_at = v_now
      where id = v_source_business_inventory.id;
    end if;
  end if;

  if v_transfer_type = 'same_city' then
    if p_destination_type = 'personal' then
      select * into v_destination_personal
      from public.personal_inventory
      where player_id = v_player_id
        and item_key = p_item_key
        and quality = p_quality
      for update;

      if not found then
        insert into public.personal_inventory (player_id, item_key, quantity, quality)
        values (v_player_id, p_item_key, p_quantity, p_quality);
      else
        update public.personal_inventory
        set quantity = v_destination_personal.quantity + p_quantity, updated_at = v_now
        where id = v_destination_personal.id;
      end if;
    else
      select * into v_destination_business_inventory
      from public.business_inventory
      where owner_player_id = v_player_id
        and business_id = p_destination_business_id
        and item_key = p_item_key
        and quality = p_quality
      for update;

      if not found then
        insert into public.business_inventory (
          owner_player_id,
          business_id,
          city_id,
          item_key,
          quantity,
          quality,
          reserved_quantity
        )
        values (
          v_player_id,
          p_destination_business_id,
          v_destination_city_id,
          p_item_key,
          p_quantity,
          p_quality,
          0
        );
      else
        update public.business_inventory
        set quantity = v_destination_business_inventory.quantity + p_quantity, updated_at = v_now
        where id = v_destination_business_inventory.id;
      end if;
    end if;

    return jsonb_build_object(
      'transferType', 'same_city',
      'shippingQueueItem', null,
      'shippingCost', 0,
      'shippingMinutes', 0
    );
  end if;

  if p_shipping_minutes is null or p_shipping_minutes < 1 then
    raise exception 'Shipping minutes must be at least 1 for cross-city transfers.';
  end if;

  if p_shipping_cost is null or p_shipping_cost < 0 then
    raise exception 'Shipping cost must be non-negative for cross-city transfers.';
  end if;

  if p_funding_account_id is null then
    raise exception 'fundingAccountId is required for cross-city shipping.';
  end if;

  select * into v_funding_account
  from public.bank_accounts
  where id = p_funding_account_id
  for update;

  if not found or v_funding_account.player_id <> v_player_id then
    raise exception 'Funding account not found.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_funding_account.id::text, 0));

  select public.get_bank_account_balance(v_funding_account.id)
  into v_funding_balance;

  if coalesce(v_funding_balance, 0) < p_shipping_cost then
    raise exception 'Insufficient funds in selected funding account for shipping cost.';
  end if;

  insert into public.shipping_queue (
    owner_player_id,
    from_city_id,
    to_city_id,
    item_key,
    quality,
    quantity,
    cost,
    declared_unit_price,
    dispatched_at,
    arrives_at,
    destination_type,
    destination_id,
    status
  )
  values (
    v_player_id,
    v_source_city_id,
    v_destination_city_id,
    p_item_key,
    p_quality,
    p_quantity,
    round(p_shipping_cost::numeric, 2),
    case when p_source_type = 'business' and p_destination_type = 'business' then round(p_unit_price::numeric, 2) else null end,
    v_now,
    v_now + make_interval(mins => p_shipping_minutes),
    p_destination_type,
    case when p_destination_type = 'personal' then v_player_id else p_destination_business_id end,
    'in_transit'
  )
  returning * into v_shipment;

  if p_shipping_cost > 0 then
    insert into public.transactions (
      account_id,
      amount,
      direction,
      transaction_type,
      reference_id,
      description
    )
    values (
      v_funding_account.id,
      round(p_shipping_cost::numeric, 2),
      'debit',
      'shipping_fee',
      v_shipment.id,
      'Cross-city inventory shipping: ' || p_quantity::text || 'x ' || p_item_key
    );
  end if;

  return jsonb_build_object(
    'transferType', 'shipping',
    'shippingQueueItem', to_jsonb(v_shipment),
    'shippingCost', round(p_shipping_cost::numeric, 2),
    'shippingMinutes', p_shipping_minutes
  );
end;
$$;

grant execute on function public.execute_inventory_transfer(
  text,
  uuid,
  uuid,
  text,
  uuid,
  uuid,
  text,
  integer,
  integer,
  numeric,
  integer,
  uuid,
  numeric
) to authenticated;

create or replace function public.execute_due_shipping_deliveries(
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_row public.shipping_queue%rowtype;
  v_existing_personal public.personal_inventory%rowtype;
  v_existing_business public.business_inventory%rowtype;
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 2000));
  v_processed integer := 0;
  v_delivered_personal integer := 0;
  v_delivered_business integer := 0;
  v_added_total_cost numeric := 0;
  v_existing_quantity integer := 0;
  v_existing_total_cost numeric := 0;
  v_next_total_cost numeric := 0;
  v_next_unit_cost numeric := 0;
begin
  for v_row in
    select *
    from public.shipping_queue
    where status = 'in_transit'
      and arrives_at <= v_now
    order by arrives_at asc
    for update skip locked
    limit v_limit
  loop
    if v_row.destination_type = 'personal' then
      select * into v_existing_personal
      from public.personal_inventory
      where player_id = v_row.owner_player_id
        and item_key = v_row.item_key
        and quality = v_row.quality
      for update;

      if not found then
        insert into public.personal_inventory (player_id, item_key, quantity, quality)
        values (v_row.owner_player_id, v_row.item_key, v_row.quantity, v_row.quality);
      else
        update public.personal_inventory
        set quantity = v_existing_personal.quantity + v_row.quantity, updated_at = v_now
        where id = v_existing_personal.id;
      end if;

      v_delivered_personal := v_delivered_personal + 1;
    else
      select * into v_existing_business
      from public.business_inventory
      where owner_player_id = v_row.owner_player_id
        and business_id = v_row.destination_id
        and item_key = v_row.item_key
        and quality = v_row.quality
      for update;

      if not found then
        insert into public.business_inventory (
          owner_player_id,
          business_id,
          city_id,
          item_key,
          quantity,
          quality,
          reserved_quantity,
          unit_cost,
          total_cost
        )
        values (
          v_row.owner_player_id,
          v_row.destination_id,
          v_row.to_city_id,
          v_row.item_key,
          v_row.quantity,
          v_row.quality,
          0,
          v_row.declared_unit_price,
          case when v_row.declared_unit_price is null then null else round(v_row.quantity * v_row.declared_unit_price, 2) end
        );
      else
        v_existing_quantity := greatest(0, v_existing_business.quantity);
        v_existing_total_cost := coalesce(v_existing_business.total_cost, v_existing_quantity * coalesce(v_existing_business.unit_cost, 0));
        v_added_total_cost := case when v_row.declared_unit_price is null then 0 else round(v_row.quantity * v_row.declared_unit_price, 2) end;
        v_next_total_cost := round(v_existing_total_cost + v_added_total_cost, 2);
        v_next_unit_cost := case
          when (v_existing_quantity + v_row.quantity) > 0 and v_row.declared_unit_price is not null
            then round(v_next_total_cost / (v_existing_quantity + v_row.quantity), 2)
          else v_existing_business.unit_cost
        end;

        update public.business_inventory
        set
          quantity = v_existing_business.quantity + v_row.quantity,
          unit_cost = v_next_unit_cost,
          total_cost = case when v_row.declared_unit_price is null then v_existing_business.total_cost else v_next_total_cost end,
          updated_at = v_now
        where id = v_existing_business.id;
      end if;

      if v_row.declared_unit_price is not null then
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
          v_row.destination_id,
          'inventory',
          round(v_row.quantity * v_row.declared_unit_price, 2),
          v_row.quantity,
          v_row.item_key,
          'inventory_transfer',
          v_row.id,
          'Inventory acquired by transfer: ' || v_row.quantity::text || 'x ' || v_row.item_key,
          v_now,
          jsonb_build_object('direction', 'in', 'delivered_from_shipping', true)
        );
      end if;

      v_delivered_business := v_delivered_business + 1;
    end if;

    update public.shipping_queue
    set status = 'delivered'
    where id = v_row.id and status = 'in_transit';

    v_processed := v_processed + 1;
  end loop;

  return jsonb_build_object(
    'processed', v_processed,
    'deliveredPersonal', v_delivered_personal,
    'deliveredBusiness', v_delivered_business
  );
end;
$$;
