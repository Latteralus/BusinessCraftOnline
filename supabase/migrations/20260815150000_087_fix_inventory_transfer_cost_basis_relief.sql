-- Phase 87: fix execute_inventory_transfer never relieving the source
-- business_inventory row's total_cost when quantity is decremented.
--
-- Every other place that decrements business_inventory.quantity (execute_market_purchase,
-- settle_market_listing_npc_sale_atomic, settle_store_inventory_sale_atomic, and the buy-order
-- settlement functions in 086) shrinks total_cost proportionally using the row's own
-- weighted-average unit cost. execute_inventory_transfer was the one outlier: it decremented
-- quantity/reserved_quantity on the source row but left total_cost untouched, so a business
-- that transferred out part of a stack and later sold the remainder would have its COGS
-- computed against total_cost/quantity using a cost basis that never shrank — permanently
-- overstating that business's COGS (and its Balance Sheet inventory value in the meantime).
--
-- This only touches the source-side relief. The destination side already gets its cost basis
-- corrected in src/domains/inventory/service.ts after this RPC returns, which is unaffected.

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
  v_destination_business_balance numeric;
  v_inventory_sale_amount numeric := 0;
  v_total_destination_charge numeric := 0;
  v_transfer_reference_id uuid := gen_random_uuid();
  v_source_unit_cost numeric;
  v_source_next_total_cost numeric;
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

  if p_quality is null or p_quality < 0 or p_quality > 100 then
    raise exception 'Quality must be between 0 and 100.';
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

  if p_source_type = 'business' and p_destination_type = 'business' then
    v_inventory_sale_amount := round((p_quantity::numeric * p_unit_price::numeric), 2);
    v_total_destination_charge := round(v_inventory_sale_amount + greatest(coalesce(p_shipping_cost, 0), 0), 2);

    select public.get_business_account_balance(p_destination_business_id)
    into v_destination_business_balance;

    if coalesce(v_destination_business_balance, 0) < v_total_destination_charge then
      raise exception 'Destination business cannot afford this transfer. Required: $%, available: $%.',
        to_char(v_total_destination_charge, 'FM9999999990.00'),
        to_char(coalesce(v_destination_business_balance, 0), 'FM9999999990.00');
    end if;
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

    -- Weighted-average cost basis, read before relief (same formula used by
    -- execute_market_purchase / settle_store_inventory_sale_atomic / 086).
    v_source_unit_cost := case
      when v_source_business_inventory.total_cost is not null and v_source_business_inventory.quantity > 0
        then round((v_source_business_inventory.total_cost / v_source_business_inventory.quantity)::numeric, 2)
      else v_source_business_inventory.unit_cost
    end;

    if (v_source_business_inventory.quantity - p_quantity) <= 0 then
      delete from public.business_inventory where id = v_source_business_inventory.id;
    else
      v_source_next_total_cost := case
        when v_source_business_inventory.total_cost is not null
          then round(greatest(0, v_source_business_inventory.total_cost - coalesce(v_source_unit_cost, 0) * p_quantity)::numeric, 2)
        else null
      end;

      update public.business_inventory
      set
        quantity = v_source_business_inventory.quantity - p_quantity,
        reserved_quantity = least(
          v_source_business_inventory.reserved_quantity,
          v_source_business_inventory.quantity - p_quantity
        ),
        total_cost = v_source_next_total_cost,
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

    if p_source_type = 'business' and p_destination_type = 'business' then
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
        p_source_business_id,
        v_inventory_sale_amount,
        'credit',
        'business_transfer_in',
        v_transfer_reference_id,
        'Inventory transfer sale: ' || p_quantity::text || 'x ' || p_item_key || ' @ ' || to_char(p_unit_price, 'FM9999999990.00')
      ),
      (
        p_destination_business_id,
        v_inventory_sale_amount,
        'debit',
        'business_transfer_out',
        v_transfer_reference_id,
        'Inventory transfer purchase: ' || p_quantity::text || 'x ' || p_item_key || ' @ ' || to_char(p_unit_price, 'FM9999999990.00')
      );
    end if;

    return jsonb_build_object(
      'transferType', 'same_city',
      'shippingQueueItem', null,
      'shippingCost', 0,
      'shippingMinutes', 0,
      'referenceId', v_transfer_reference_id
    );
  end if;

  if p_shipping_minutes is null or p_shipping_minutes < 1 then
    raise exception 'Shipping minutes must be at least 1 for cross-city transfers.';
  end if;

  if p_shipping_cost is null or p_shipping_cost < 0 then
    raise exception 'Shipping cost must be non-negative for cross-city transfers.';
  end if;

  if p_source_type = 'business' and p_destination_type = 'business' then
    if coalesce(v_destination_business_balance, 0) < p_shipping_cost then
      raise exception 'Insufficient business funds for shipping cost.';
    end if;
  else
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

  if p_source_type = 'business' and p_destination_type = 'business' then
    v_transfer_reference_id := v_shipment.id;

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
      p_source_business_id,
      v_inventory_sale_amount,
      'credit',
      'business_transfer_in',
      v_transfer_reference_id,
      'Inventory transfer sale: ' || p_quantity::text || 'x ' || p_item_key || ' @ ' || to_char(p_unit_price, 'FM9999999990.00')
    ),
    (
      p_destination_business_id,
      v_inventory_sale_amount,
      'debit',
      'business_transfer_out',
      v_transfer_reference_id,
      'Inventory transfer purchase: ' || p_quantity::text || 'x ' || p_item_key || ' @ ' || to_char(p_unit_price, 'FM9999999990.00')
    );
  end if;

  if p_shipping_cost > 0 then
    if p_source_type = 'business' and p_destination_type = 'business' then
      insert into public.business_accounts (
        business_id,
        amount,
        entry_type,
        category,
        reference_id,
        description
      )
      values (
        p_destination_business_id,
        round(p_shipping_cost::numeric, 2),
        'debit',
        'shipping_fee',
        v_shipment.id,
        'Cross-city inventory shipping: ' || p_quantity::text || 'x ' || p_item_key
      );
    else
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
  end if;

  return jsonb_build_object(
    'transferType', 'shipping',
    'shippingQueueItem', to_jsonb(v_shipment),
    'shippingCost', round(p_shipping_cost::numeric, 2),
    'shippingMinutes', p_shipping_minutes,
    'referenceId', v_transfer_reference_id
  );
end;
$$;

-- Migration complete: execute_inventory_transfer now relieves the source's weighted-average
-- cost basis (total_cost) proportionally, matching every other inventory-relieving RPC.
