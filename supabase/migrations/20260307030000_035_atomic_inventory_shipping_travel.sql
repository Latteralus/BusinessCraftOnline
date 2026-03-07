-- Phase 18 patch: make inventory transfer, shipping delivery, and travel arrival atomic.
-- Keeps state transitions in SQL transactions to avoid partial writes across tables.

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
  p_shipping_minutes integer
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

  if p_source_type = 'business' then
    if p_source_business_id is null then
      raise exception 'Source business id is required for business source.';
    end if;

    select *
    into v_source_business
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

    select *
    into v_destination_business
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
    select *
    into v_source_personal
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
    select *
    into v_source_business_inventory
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
      select *
      into v_destination_personal
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
      select *
      into v_destination_business_inventory
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

  insert into public.shipping_queue (
    owner_player_id,
    from_city_id,
    to_city_id,
    item_key,
    quantity,
    cost,
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
    p_quantity,
    round(p_shipping_cost::numeric, 2),
    v_now,
    v_now + make_interval(mins => p_shipping_minutes),
    p_destination_type,
    case when p_destination_type = 'personal' then v_player_id else p_destination_business_id end,
    'in_transit'
  )
  returning * into v_shipment;

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
  integer
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
  v_quality integer := 40;
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 2000));
  v_processed integer := 0;
  v_delivered_personal integer := 0;
  v_delivered_business integer := 0;
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
      select *
      into v_existing_personal
      from public.personal_inventory
      where player_id = v_row.owner_player_id
        and item_key = v_row.item_key
        and quality = v_quality
      for update;

      if not found then
        insert into public.personal_inventory (player_id, item_key, quantity, quality)
        values (v_row.owner_player_id, v_row.item_key, v_row.quantity, v_quality);
      else
        update public.personal_inventory
        set quantity = v_existing_personal.quantity + v_row.quantity, updated_at = v_now
        where id = v_existing_personal.id;
      end if;

      v_delivered_personal := v_delivered_personal + 1;
    else
      select *
      into v_existing_business
      from public.business_inventory
      where owner_player_id = v_row.owner_player_id
        and business_id = v_row.destination_id
        and item_key = v_row.item_key
        and quality = v_quality
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
          v_row.owner_player_id,
          v_row.destination_id,
          v_row.to_city_id,
          v_row.item_key,
          v_row.quantity,
          v_quality,
          0
        );
      else
        update public.business_inventory
        set quantity = v_existing_business.quantity + v_row.quantity, updated_at = v_now
        where id = v_existing_business.id;
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

grant execute on function public.execute_due_shipping_deliveries(integer) to service_role;

create or replace function public.execute_due_travel_arrivals(
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 2000));
  v_processed integer := 0;
  v_row public.travel_log%rowtype;
begin
  for v_row in
    select *
    from public.travel_log
    where status = 'traveling'
      and arrives_at <= v_now
    order by arrives_at asc
    for update skip locked
    limit v_limit
  loop
    update public.travel_log
    set status = 'arrived'
    where id = v_row.id and status = 'traveling';

    update public.characters
    set current_city_id = v_row.to_city_id
    where player_id = v_row.player_id;

    v_processed := v_processed + 1;
  end loop;

  return jsonb_build_object('processed', v_processed);
end;
$$;

grant execute on function public.execute_due_travel_arrivals(integer) to service_role;

create or replace function public.execute_complete_active_travel_if_due()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid := auth.uid();
  v_now timestamptz := now();
  v_travel public.travel_log%rowtype;
begin
  if v_player_id is null then
    raise exception 'Unauthorized.';
  end if;

  select *
  into v_travel
  from public.travel_log
  where player_id = v_player_id
    and status = 'traveling'
  for update;

  if not found then
    return jsonb_build_object('travel', null);
  end if;

  if v_travel.arrives_at > v_now then
    return jsonb_build_object('travel', null);
  end if;

  update public.travel_log
  set status = 'arrived'
  where id = v_travel.id and status = 'traveling'
  returning * into v_travel;

  update public.characters
  set current_city_id = v_travel.to_city_id
  where player_id = v_player_id;

  return jsonb_build_object('travel', to_jsonb(v_travel));
end;
$$;

grant execute on function public.execute_complete_active_travel_if_due() to authenticated;

