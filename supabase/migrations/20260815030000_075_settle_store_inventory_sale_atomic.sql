-- settleStoreInventorySale (supabase/functions/tick-npc-purchases/index.ts) did a
-- plain read-then-write against business_inventory/store_shelf_items with no lock
-- and no optimistic-concurrency guard, unlike the player-facing execute_market_purchase
-- RPC. A player creating/cancelling a shelf listing, or a second concurrent NPC sale,
-- at the same instant could produce a lost update. Port the settlement into a single
-- locked transaction, mirroring execute_market_purchase's FOR UPDATE pattern.
--
-- NPC_PRICE_CEILINGS (used for the baseline-cost fallback) stays in shared/economy.ts
-- as the source of truth — the edge function still computes p_baseline_unit_cost in
-- TS exactly as before and passes it in, rather than duplicating that table here.
--
-- NPC storefront fee rate: keep in sync with NPC_STOREFRONT_FEE in shared/economy.ts.

create or replace function public.settle_store_inventory_sale_atomic(
  p_shelf_item_id uuid,
  p_owner_player_id uuid,
  p_business_id uuid,
  p_item_key text,
  p_quality numeric,
  p_city_id uuid,
  p_business_name text,
  p_sold_qty integer,
  p_unit_price numeric,
  p_baseline_unit_cost numeric,
  p_shopper_name text default null,
  p_shopper_tier text default null,
  p_shopper_budget numeric default null,
  p_sub_tick_index integer default null,
  p_tick_window_started_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inventory public.business_inventory%rowtype;
  v_shelf public.store_shelf_items%rowtype;
  v_now timestamptz := now();
  -- NPC storefront fee rate: keep in sync with NPC_STOREFRONT_FEE in shared/economy.ts
  v_fee_rate constant numeric := 0.05;
  v_inventory_qty numeric;
  v_inventory_reserved numeric;
  v_shelf_qty numeric;
  v_available_backed_qty numeric;
  v_explicit_unit_cost numeric;
  v_explicit_total_cost numeric;
  v_inventory_unit_cost numeric;
  v_sold_inventory_cost numeric;
  v_listing_price numeric;
  v_gross numeric(14, 2);
  v_fee numeric(14, 2);
  v_net numeric(14, 2);
  v_next_qty numeric;
  v_next_reserved numeric;
  v_next_shelf_qty numeric;
  v_next_total_cost numeric;
  v_next_unit_cost numeric;
  v_tx public.market_transactions%rowtype;
begin
  if p_sold_qty is null or p_sold_qty < 1 then
    raise exception 'Sold quantity must be at least 1.';
  end if;

  select *
  into v_inventory
  from public.business_inventory
  where owner_player_id = p_owner_player_id
    and business_id = p_business_id
    and item_key = p_item_key
    and quality = p_quality
  for update;

  if v_inventory.id is null then
    raise exception 'Shelf inventory backing row not found.';
  end if;

  select *
  into v_shelf
  from public.store_shelf_items
  where id = p_shelf_item_id
  for update;

  if v_shelf.id is null then
    raise exception 'Shelf item not found.';
  end if;

  v_inventory_qty := v_inventory.quantity;
  v_inventory_reserved := v_inventory.reserved_quantity;
  v_shelf_qty := v_shelf.quantity;
  v_available_backed_qty := greatest(0, least(v_shelf_qty, v_inventory_qty, v_inventory_reserved));

  if p_sold_qty > v_available_backed_qty then
    raise exception 'Shelf sale exceeds reserved inventory backing.';
  end if;

  v_explicit_unit_cost := v_inventory.unit_cost;
  v_explicit_total_cost := v_inventory.total_cost;
  v_inventory_unit_cost := case
    when v_explicit_total_cost is not null and v_inventory_qty > 0
      then round((v_explicit_total_cost / v_inventory_qty)::numeric, 2)
    else coalesce(v_explicit_unit_cost, p_baseline_unit_cost, 0)
  end;
  v_sold_inventory_cost := round(greatest(0, v_inventory_unit_cost * p_sold_qty)::numeric, 2);

  v_listing_price := greatest(0.01, p_unit_price);
  v_gross := round((v_listing_price * p_sold_qty)::numeric, 2);
  v_fee := round((v_gross * v_fee_rate)::numeric, 2);
  v_net := round((v_gross - v_fee)::numeric, 2);

  v_next_qty := v_inventory_qty - p_sold_qty;
  v_next_reserved := greatest(0, least(v_next_qty, v_inventory_reserved - p_sold_qty));
  v_next_shelf_qty := v_shelf_qty - p_sold_qty;
  v_next_total_cost := case
    when v_explicit_total_cost is not null then round(greatest(0, v_explicit_total_cost - v_sold_inventory_cost)::numeric, 2)
    else round(greatest(0, v_inventory_unit_cost * v_next_qty)::numeric, 2)
  end;
  v_next_unit_cost := v_inventory_unit_cost;

  if v_next_qty <= 0 then
    delete from public.business_inventory where id = v_inventory.id;
  else
    update public.business_inventory
    set
      quantity = greatest(0, v_next_qty),
      reserved_quantity = greatest(0, v_next_reserved),
      unit_cost = v_next_unit_cost,
      total_cost = v_next_total_cost,
      updated_at = v_now
    where id = v_inventory.id;
  end if;

  if v_next_shelf_qty <= 0 then
    delete from public.store_shelf_items where id = v_shelf.id;
  else
    update public.store_shelf_items
    set quantity = v_next_shelf_qty,
        updated_at = v_now
    where id = v_shelf.id;
  end if;

  insert into public.market_transactions (
    listing_id, seller_player_id, buyer_player_id, buyer_type,
    seller_business_id, seller_business_name,
    buyer_business_id, buyer_business_name,
    city_id, item_key, quality, quantity, unit_price, gross_total, market_fee, net_total,
    shopper_name, shopper_tier, shopper_budget, sub_tick_index, tick_window_started_at
  ) values (
    null, p_owner_player_id, null, 'npc',
    p_business_id, coalesce(p_business_name, 'Unknown Business'),
    null, null,
    p_city_id, p_item_key, greatest(0, least(100, p_quality)), p_sold_qty, v_listing_price, v_gross, v_fee, v_net,
    p_shopper_name, p_shopper_tier, p_shopper_budget, p_sub_tick_index, p_tick_window_started_at
  )
  returning * into v_tx;

  insert into public.business_accounts (business_id, amount, entry_type, category, reference_id, description)
  values (
    p_business_id, v_gross, 'credit', 'npc_sale', v_tx.id,
    'Storefront sale: ' || p_sold_qty::text || 'x ' || p_item_key
  );

  if v_fee > 0 then
    insert into public.business_accounts (business_id, amount, entry_type, category, reference_id, description)
    values (
      p_business_id, v_fee, 'debit', 'market_fee', v_tx.id,
      'Storefront fee: ' || p_sold_qty::text || 'x ' || p_item_key
    );
  end if;

  insert into public.business_financial_events (business_id, account_code, amount, quantity, item_key, reference_type, reference_id, description, metadata)
  values
    (
      p_business_id, 'revenue', v_gross, p_sold_qty, p_item_key, 'storefront_sale', v_tx.id,
      'Storefront sale revenue: ' || p_sold_qty::text || 'x ' || p_item_key,
      jsonb_build_object('buyerType', 'npc')
    ),
    (
      p_business_id, 'cogs', v_sold_inventory_cost, p_sold_qty, p_item_key, 'storefront_sale', v_tx.id,
      'Storefront COGS: ' || p_sold_qty::text || 'x ' || p_item_key,
      jsonb_build_object('estimatedCost', v_explicit_unit_cost is null and v_explicit_total_cost is null, 'unitCost', v_inventory_unit_cost)
    ),
    (
      p_business_id, 'inventory', v_sold_inventory_cost, p_sold_qty, p_item_key, 'storefront_sale', v_tx.id,
      'Storefront inventory relief: ' || p_sold_qty::text || 'x ' || p_item_key,
      jsonb_build_object('direction', 'out', 'estimatedCost', v_explicit_unit_cost is null and v_explicit_total_cost is null, 'unitCost', v_inventory_unit_cost)
    );

  if v_fee > 0 then
    insert into public.business_financial_events (business_id, account_code, amount, quantity, item_key, reference_type, reference_id, description)
    values (
      p_business_id, 'operating_expense', v_fee, p_sold_qty, p_item_key, 'storefront_sale', v_tx.id,
      'Storefront fee expense: ' || p_sold_qty::text || 'x ' || p_item_key
    );
  end if;

  return jsonb_build_object('gross', v_gross, 'fee', v_fee, 'net', v_net);
end;
$$;

revoke all on function public.settle_store_inventory_sale_atomic(
  uuid, uuid, uuid, text, numeric, uuid, text, integer, numeric, numeric, text, text, numeric, integer, timestamptz
) from public;
grant execute on function public.settle_store_inventory_sale_atomic(
  uuid, uuid, uuid, text, numeric, uuid, text, integer, numeric, numeric, text, text, numeric, integer, timestamptz
) to service_role;
