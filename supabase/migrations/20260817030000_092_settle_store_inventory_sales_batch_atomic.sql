-- Resolves audit finding H7 (Documents/SBAudit.md): tick-npc-purchases called
-- settle_store_inventory_sale_atomic once per individual shopper purchase --
-- write-call volume of O(stores x shoppers x basket size) every minute, each
-- one its own network round trip from the edge function to Postgres.
--
-- The purchase *decisions* (which shelf row, how many units, at what price)
-- already happen entirely in-memory in the edge function before any RPC call
-- -- the RPC call only persists a decision that was already made. So a batch
-- of decided sales for a whole store's subtick can be persisted in one round
-- trip instead of one per sale, with each sale still processed and locked
-- individually inside the same transaction (same per-sale logic as
-- settle_store_inventory_sale_atomic, just looped server-side).
--
-- Unlike the single-sale RPC, a sale in the batch that no longer has enough
-- backing inventory by settlement time (e.g. another concurrent write landed
-- between decision and settlement) is skipped with ok:false instead of
-- aborting the whole batch -- one shopper's stale decision must not cost
-- every other shopper in the same store their purchase this subtick.

create or replace function public.settle_store_inventory_sales_atomic(p_sales jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale jsonb;
  v_shelf_item_id uuid;
  v_owner_player_id uuid;
  v_business_id uuid;
  v_item_key text;
  v_quality numeric;
  v_city_id uuid;
  v_business_name text;
  v_sold_qty integer;
  v_unit_price numeric;
  v_baseline_unit_cost numeric;
  v_shopper_name text;
  v_shopper_tier text;
  v_shopper_budget numeric;
  v_sub_tick_index integer;
  v_tick_window_started_at timestamptz;

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
  v_results jsonb := '[]'::jsonb;
begin
  -- Stable lock order across the whole batch (by shelf_item_id) so two
  -- concurrent batches touching overlapping rows serialize instead of
  -- deadlocking.
  for v_sale in
    select value from jsonb_array_elements(coalesce(p_sales, '[]'::jsonb)) order by (value ->> 'shelfItemId')
  loop
    v_shelf_item_id := (v_sale ->> 'shelfItemId')::uuid;
    v_owner_player_id := (v_sale ->> 'ownerPlayerId')::uuid;
    v_business_id := (v_sale ->> 'businessId')::uuid;
    v_item_key := v_sale ->> 'itemKey';
    v_quality := (v_sale ->> 'quality')::numeric;
    v_city_id := (v_sale ->> 'cityId')::uuid;
    v_business_name := v_sale ->> 'businessName';
    v_sold_qty := (v_sale ->> 'soldQty')::integer;
    v_unit_price := (v_sale ->> 'unitPrice')::numeric;
    v_baseline_unit_cost := nullif(v_sale ->> 'baselineUnitCost', '')::numeric;
    v_shopper_name := v_sale ->> 'shopperName';
    v_shopper_tier := v_sale ->> 'shopperTier';
    v_shopper_budget := nullif(v_sale ->> 'shopperBudget', '')::numeric;
    v_sub_tick_index := nullif(v_sale ->> 'subTickIndex', '')::integer;
    v_tick_window_started_at := nullif(v_sale ->> 'tickWindowStartedAt', '')::timestamptz;

    if v_sold_qty is null or v_sold_qty < 1 then
      v_results := v_results || jsonb_build_object('ok', false, 'soldQty', 0);
      continue;
    end if;

    select * into v_inventory
    from public.business_inventory
    where owner_player_id = v_owner_player_id
      and business_id = v_business_id
      and item_key = v_item_key
      and quality = v_quality
    for update;

    select * into v_shelf
    from public.store_shelf_items
    where id = v_shelf_item_id
    for update;

    if v_inventory.id is null or v_shelf.id is null then
      v_results := v_results || jsonb_build_object('ok', false, 'soldQty', 0);
      continue;
    end if;

    v_inventory_qty := v_inventory.quantity;
    v_inventory_reserved := v_inventory.reserved_quantity;
    v_shelf_qty := v_shelf.quantity;
    v_available_backed_qty := greatest(0, least(v_shelf_qty, v_inventory_qty, v_inventory_reserved));

    -- Clamp instead of aborting: a concurrent write since this sale was
    -- decided in-memory may have shrunk the available backing quantity.
    if v_available_backed_qty <= 0 then
      v_results := v_results || jsonb_build_object('ok', false, 'soldQty', 0);
      continue;
    end if;
    v_sold_qty := least(v_sold_qty, floor(v_available_backed_qty)::integer);

    v_explicit_unit_cost := v_inventory.unit_cost;
    v_explicit_total_cost := v_inventory.total_cost;
    v_inventory_unit_cost := case
      when v_explicit_total_cost is not null and v_inventory_qty > 0
        then round((v_explicit_total_cost / v_inventory_qty)::numeric, 2)
      else coalesce(v_explicit_unit_cost, v_baseline_unit_cost, 0)
    end;
    v_sold_inventory_cost := round(greatest(0, v_inventory_unit_cost * v_sold_qty)::numeric, 2);

    v_listing_price := greatest(0.01, v_unit_price);
    v_gross := round((v_listing_price * v_sold_qty)::numeric, 2);
    v_fee := round((v_gross * v_fee_rate)::numeric, 2);
    v_net := round((v_gross - v_fee)::numeric, 2);

    v_next_qty := v_inventory_qty - v_sold_qty;
    v_next_reserved := greatest(0, least(v_next_qty, v_inventory_reserved - v_sold_qty));
    v_next_shelf_qty := v_shelf_qty - v_sold_qty;
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
      null, v_owner_player_id, null, 'npc',
      v_business_id, coalesce(v_business_name, 'Unknown Business'),
      null, null,
      v_city_id, v_item_key, greatest(0, least(100, v_quality)), v_sold_qty, v_listing_price, v_gross, v_fee, v_net,
      v_shopper_name, v_shopper_tier, v_shopper_budget, v_sub_tick_index, v_tick_window_started_at
    )
    returning * into v_tx;

    insert into public.business_accounts (business_id, amount, entry_type, category, reference_id, description)
    values (
      v_business_id, v_gross, 'credit', 'npc_sale', v_tx.id,
      'Storefront sale: ' || v_sold_qty::text || 'x ' || v_item_key
    );

    if v_fee > 0 then
      insert into public.business_accounts (business_id, amount, entry_type, category, reference_id, description)
      values (
        v_business_id, v_fee, 'debit', 'market_fee', v_tx.id,
        'Storefront fee: ' || v_sold_qty::text || 'x ' || v_item_key
      );
    end if;

    insert into public.business_financial_events (business_id, account_code, amount, quantity, item_key, reference_type, reference_id, description, metadata)
    values
      (
        v_business_id, 'revenue', v_gross, v_sold_qty, v_item_key, 'storefront_sale', v_tx.id,
        'Storefront sale revenue: ' || v_sold_qty::text || 'x ' || v_item_key,
        jsonb_build_object('buyerType', 'npc')
      ),
      (
        v_business_id, 'cogs', v_sold_inventory_cost, v_sold_qty, v_item_key, 'storefront_sale', v_tx.id,
        'Storefront COGS: ' || v_sold_qty::text || 'x ' || v_item_key,
        jsonb_build_object('estimatedCost', v_explicit_unit_cost is null and v_explicit_total_cost is null, 'unitCost', v_inventory_unit_cost)
      ),
      (
        v_business_id, 'inventory', v_sold_inventory_cost, v_sold_qty, v_item_key, 'storefront_sale', v_tx.id,
        'Storefront inventory relief: ' || v_sold_qty::text || 'x ' || v_item_key,
        jsonb_build_object('direction', 'out', 'estimatedCost', v_explicit_unit_cost is null and v_explicit_total_cost is null, 'unitCost', v_inventory_unit_cost)
      );

    if v_fee > 0 then
      insert into public.business_financial_events (business_id, account_code, amount, quantity, item_key, reference_type, reference_id, description)
      values (
        v_business_id, 'operating_expense', v_fee, v_sold_qty, v_item_key, 'storefront_sale', v_tx.id,
        'Storefront fee expense: ' || v_sold_qty::text || 'x ' || v_item_key
      );
    end if;

    v_results := v_results || jsonb_build_object('ok', true, 'soldQty', v_sold_qty, 'gross', v_gross, 'fee', v_fee, 'net', v_net);
  end loop;

  return v_results;
end;
$$;

revoke all on function public.settle_store_inventory_sales_atomic(jsonb) from public;
grant execute on function public.settle_store_inventory_sales_atomic(jsonb) to service_role;
