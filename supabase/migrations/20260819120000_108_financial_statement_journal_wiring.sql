-- AccountingFixPlan Phase G: financial statements (items 47-49), journal wiring.
--
-- Per Phase E/F's own notes ("full journal coverage reads as Phase G's job...
-- done once, consistently, across every posting path"), this migration wires
-- post_business_journal_entry into every remaining revenue/expense/asset path
-- that (a) is a single atomic RPC and (b) fully owns both legs of its cash
-- movement within that same transaction:
--   - settle_store_inventory_sale_atomic / settle_store_inventory_sales_atomic
--   - settle_market_listing_npc_sale_atomic
--   - execute_market_purchase (buyer + seller, when seller is business)
--   - execute_inventory_transfer (B2B same-city: both sides; B2B shipping:
--     source side only, matching dispatch-time revenue recognition)
--   - fulfill_contract_atomic
--   - purchase_business_upgrade_atomic
-- Each function keeps its exact existing signature/behavior; the only change
-- is an additive journal entry alongside the business_accounts/
-- business_financial_events rows it already wrote, linked via
-- business_accounts.journal_entry_id (same pattern as migration 098's
-- payroll RPCs). Every journal line list omits any debit/credit pair whose
-- amount is exactly 0 (a $0-cost-basis item, e.g. a mined good with no
-- consumed inputs) since business_journal_lines' own CHECK constraint
-- requires a line to have a strictly positive debit or credit, never both
-- zero.
--
-- Deliberately NOT wired this migration, with reasons (documented here
-- rather than silently skipped, per this plan's own standard):
--   - Buy-order fills (_settle_buy_order_fill and its three callers:
--     place_market_buy_order's own sweep loop, sweep_buy_orders_for_new_listing,
--     fulfill_market_buy_order). The buyer's cash was already fully debited
--     at ORDER PLACEMENT time via a buy_order_escrow entry sized at the
--     order's worst-case price (quantity * max_unit_price); a later fill at
--     the listing's real (lower-or-equal) price moves inventory and pays the
--     seller but never re-touches the buyer's cash in this codebase's
--     existing design, and no "escrow release" entry exists for the
--     difference between the escrowed worst case and the real fill price
--     outside of full-order cancellation (buy_order_release). Posting a
--     balanced buyer-side journal entry here would require either inventing
--     a new escrow/prepaid-asset chart-of-accounts line (a real design
--     change to buy-order economics, out of this phase's "build the
--     statements" scope) or fabricating a cash leg that doesn't exist in
--     this transaction. Left as a flagged gap for a future phase rather than
--     forced. This does not affect statement correctness: buy-order fills
--     already write correct business_financial_events rows (revenue/cogs/
--     inventory/operating_expense), which is what src/domains/businesses/
--     statements.ts (added this phase) actually sources the Income Statement
--     and Balance Sheet from -- see that file's header comment for why.
--   - execute_due_shipping_deliveries' landed-cost capitalization at
--     delivery. The freight dollar amount was already paid (cash left the
--     destination business) at DISPATCH time in execute_inventory_transfer,
--     with no offsetting asset recognized then (this game has no "goods in
--     transit" balance-sheet line -- a pre-existing gap, not introduced by
--     this phase). At delivery there is no new cash movement, only a
--     reclassification into business_inventory.total_cost; the only
--     accounting-correct balanced entry would require a "goods in transit"
--     account this plan's minimal chart of accounts doesn't define. Flagged
--     here rather than inventing one. Every in-transit B2B shipment is
--     therefore a real, temporary Balance Sheet imbalance for the destination
--     business until it lands -- Phase G's balance sheet reports this
--     truthfully rather than papering over it (per item 53's own rule: never
--     silently repair/hide a discrepancy).

-- ---------------------------------------------------------------------------
-- settle_store_inventory_sale_atomic
-- ---------------------------------------------------------------------------

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
  v_journal_lines jsonb;
  v_journal_entry_id uuid;
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

  select r.unit_cost, r.relieved_cost, r.next_total_cost
  into v_inventory_unit_cost, v_sold_inventory_cost, v_next_total_cost
  from public.compute_inventory_cost_relief(
    v_inventory_qty, v_explicit_total_cost, v_explicit_unit_cost, p_sold_qty, p_baseline_unit_cost
  ) r;

  v_listing_price := greatest(0.01, p_unit_price);
  v_gross := round((v_listing_price * p_sold_qty)::numeric, 2);
  v_fee := round((v_gross * v_fee_rate)::numeric, 2);
  v_net := round((v_gross - v_fee)::numeric, 2);

  v_next_qty := v_inventory_qty - p_sold_qty;
  v_next_reserved := greatest(0, least(v_next_qty, v_inventory_reserved - p_sold_qty));
  v_next_shelf_qty := v_shelf_qty - p_sold_qty;
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

  -- AccountingFixPlan Phase G: balanced double-entry journal for this sale.
  -- v_gross > 0 is guaranteed (price floor 0.01, qty >= 1), so this entry
  -- always has at least the cash/revenue pair.
  v_journal_lines := jsonb_build_array(
    jsonb_build_object('account_code', 'cash', 'debit', v_gross),
    jsonb_build_object('account_code', 'revenue', 'credit', v_gross)
  )
  || case when v_sold_inventory_cost > 0 then jsonb_build_array(
       jsonb_build_object('account_code', 'cogs', 'debit', v_sold_inventory_cost),
       jsonb_build_object('account_code', 'inventory', 'credit', v_sold_inventory_cost)
     ) else '[]'::jsonb end
  || case when v_fee > 0 then jsonb_build_array(
       jsonb_build_object('account_code', 'market_fees', 'debit', v_fee),
       jsonb_build_object('account_code', 'cash', 'credit', v_fee)
     ) else '[]'::jsonb end;

  v_journal_entry_id := public.post_business_journal_entry(
    p_business_id,
    v_journal_lines,
    'storefront_sale',
    v_tx.id,
    'Storefront sale: ' || p_sold_qty::text || 'x ' || p_item_key,
    v_now
  );

  insert into public.business_accounts (business_id, amount, entry_type, category, reference_id, description, journal_entry_id)
  values (
    p_business_id, v_gross, 'credit', 'npc_sale', v_tx.id,
    'Storefront sale: ' || p_sold_qty::text || 'x ' || p_item_key,
    v_journal_entry_id
  );

  if v_fee > 0 then
    insert into public.business_accounts (business_id, amount, entry_type, category, reference_id, description, journal_entry_id)
    values (
      p_business_id, v_fee, 'debit', 'market_fee', v_tx.id,
      'Storefront fee: ' || p_sold_qty::text || 'x ' || p_item_key,
      v_journal_entry_id
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

-- ---------------------------------------------------------------------------
-- settle_store_inventory_sales_atomic (batch) -- same journal pattern, once
-- per sale inside the loop.
-- ---------------------------------------------------------------------------

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
  v_journal_lines jsonb;
  v_journal_entry_id uuid;
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

    select r.unit_cost, r.relieved_cost, r.next_total_cost
    into v_inventory_unit_cost, v_sold_inventory_cost, v_next_total_cost
    from public.compute_inventory_cost_relief(
      v_inventory_qty, v_explicit_total_cost, v_explicit_unit_cost, v_sold_qty, v_baseline_unit_cost
    ) r;

    v_listing_price := greatest(0.01, v_unit_price);
    v_gross := round((v_listing_price * v_sold_qty)::numeric, 2);
    v_fee := round((v_gross * v_fee_rate)::numeric, 2);
    v_net := round((v_gross - v_fee)::numeric, 2);

    v_next_qty := v_inventory_qty - v_sold_qty;
    v_next_reserved := greatest(0, least(v_next_qty, v_inventory_reserved - v_sold_qty));
    v_next_shelf_qty := v_shelf_qty - v_sold_qty;
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

    v_journal_lines := jsonb_build_array(
      jsonb_build_object('account_code', 'cash', 'debit', v_gross),
      jsonb_build_object('account_code', 'revenue', 'credit', v_gross)
    )
    || case when v_sold_inventory_cost > 0 then jsonb_build_array(
         jsonb_build_object('account_code', 'cogs', 'debit', v_sold_inventory_cost),
         jsonb_build_object('account_code', 'inventory', 'credit', v_sold_inventory_cost)
       ) else '[]'::jsonb end
    || case when v_fee > 0 then jsonb_build_array(
         jsonb_build_object('account_code', 'market_fees', 'debit', v_fee),
         jsonb_build_object('account_code', 'cash', 'credit', v_fee)
       ) else '[]'::jsonb end;

    v_journal_entry_id := public.post_business_journal_entry(
      v_business_id,
      v_journal_lines,
      'storefront_sale',
      v_tx.id,
      'Storefront sale: ' || v_sold_qty::text || 'x ' || v_item_key,
      v_now
    );

    insert into public.business_accounts (business_id, amount, entry_type, category, reference_id, description, journal_entry_id)
    values (
      v_business_id, v_gross, 'credit', 'npc_sale', v_tx.id,
      'Storefront sale: ' || v_sold_qty::text || 'x ' || v_item_key,
      v_journal_entry_id
    );

    if v_fee > 0 then
      insert into public.business_accounts (business_id, amount, entry_type, category, reference_id, description, journal_entry_id)
      values (
        v_business_id, v_fee, 'debit', 'market_fee', v_tx.id,
        'Storefront fee: ' || v_sold_qty::text || 'x ' || v_item_key,
        v_journal_entry_id
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

-- ---------------------------------------------------------------------------
-- settle_market_listing_npc_sale_atomic
-- ---------------------------------------------------------------------------

create or replace function public.settle_market_listing_npc_sale_atomic(
  p_listing_id uuid,
  p_sold_qty integer,
  p_baseline_unit_cost numeric default 0,
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
  v_listing public.market_listings%rowtype;
  v_updated_listing public.market_listings%rowtype;
  v_source_inventory public.business_inventory%rowtype;
  v_now timestamptz := now();
  -- Market transaction fee rate: keep in sync with MARKET_TRANSACTION_FEE in shared/economy.ts
  v_fee_rate constant numeric := 0.03;
  v_gross numeric(14, 2);
  v_fee numeric(14, 2);
  v_net numeric(14, 2);
  v_next_qty integer;
  v_next_reserved integer;
  v_next_status text;
  v_seller_business_name text;
  v_seller_checking_account_id uuid;
  v_inventory_unit_cost numeric;
  v_sold_inventory_cost numeric;
  v_next_total_cost numeric;
  v_tx public.market_transactions%rowtype;
  v_journal_lines jsonb;
  v_journal_entry_id uuid;
begin
  if p_sold_qty is null or p_sold_qty < 1 then
    raise exception 'Sold quantity must be at least 1.';
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

  if p_sold_qty > v_listing.quantity then
    raise exception 'Requested quantity exceeds listing availability.';
  end if;

  v_gross := round((v_listing.unit_price * p_sold_qty)::numeric, 2);
  v_fee   := round((v_gross * v_fee_rate)::numeric, 2);
  v_net   := round((v_gross - v_fee)::numeric, 2);
  v_seller_business_name := case
    when v_listing.source_type = 'personal' then 'Personal Inventory'
    else null
  end;

  if v_listing.source_type = 'business' then
    if v_listing.source_inventory_id is null then
      raise exception 'Business listing is missing its source inventory reference.';
    end if;

    select *
    into v_source_inventory
    from public.business_inventory
    where id = v_listing.source_inventory_id
    for update;

    if not found then
      raise exception 'Source inventory not found for listing.';
    end if;

    if v_source_inventory.quantity < p_sold_qty then
      raise exception 'Source inventory quantity is insufficient.';
    end if;

    if v_source_inventory.reserved_quantity < p_sold_qty then
      raise exception 'Source inventory reservation is insufficient.';
    end if;

    select r.unit_cost, r.relieved_cost, r.next_total_cost
    into v_inventory_unit_cost, v_sold_inventory_cost, v_next_total_cost
    from public.compute_inventory_cost_relief(
      v_source_inventory.quantity, v_source_inventory.total_cost, v_source_inventory.unit_cost, p_sold_qty, p_baseline_unit_cost
    ) r;

    if (v_source_inventory.quantity - p_sold_qty) <= 0 then
      delete from public.business_inventory
      where id = v_source_inventory.id;
    else
      update public.business_inventory
      set
        quantity          = v_source_inventory.quantity - p_sold_qty,
        reserved_quantity = greatest(
          0,
          least(
            v_source_inventory.quantity - p_sold_qty,
            v_source_inventory.reserved_quantity - p_sold_qty
          )
        ),
        total_cost        = v_next_total_cost,
        updated_at        = v_now
      where id = v_source_inventory.id;
    end if;

    select name
    into v_seller_business_name
    from public.businesses
    where id = v_listing.source_business_id;
  end if;

  v_next_qty      := v_listing.quantity - p_sold_qty;
  v_next_reserved := greatest(0, v_listing.reserved_quantity - p_sold_qty);
  v_next_status   := case when v_next_qty <= 0 then 'filled' else 'active' end;

  update public.market_listings
  set
    quantity          = greatest(0, v_next_qty),
    reserved_quantity = greatest(0, v_next_reserved),
    status            = v_next_status,
    filled_at         = case when v_next_status = 'filled' then v_now else null end,
    updated_at        = v_now
  where id = v_listing.id
  returning * into v_updated_listing;

  if v_listing.source_type = 'business' then
    v_journal_lines := jsonb_build_array(
      jsonb_build_object('account_code', 'cash', 'debit', v_gross),
      jsonb_build_object('account_code', 'revenue', 'credit', v_gross)
    )
    || case when v_sold_inventory_cost > 0 then jsonb_build_array(
         jsonb_build_object('account_code', 'cogs', 'debit', v_sold_inventory_cost),
         jsonb_build_object('account_code', 'inventory', 'credit', v_sold_inventory_cost)
       ) else '[]'::jsonb end
    || case when v_fee > 0 then jsonb_build_array(
         jsonb_build_object('account_code', 'market_fees', 'debit', v_fee),
         jsonb_build_object('account_code', 'cash', 'credit', v_fee)
       ) else '[]'::jsonb end;

    v_journal_entry_id := public.post_business_journal_entry(
      v_listing.source_business_id,
      v_journal_lines,
      'market_transaction',
      v_listing.id,
      'NPC market sale: ' || p_sold_qty::text || 'x ' || v_listing.item_key,
      v_now
    );

    insert into public.business_accounts (business_id, amount, entry_type, category, reference_id, description, journal_entry_id)
    values (
      v_listing.source_business_id,
      v_gross,
      'credit',
      'market_sale',
      v_listing.id,
      'NPC market sale: ' || p_sold_qty::text || 'x ' || v_listing.item_key,
      v_journal_entry_id
    );

    if v_fee > 0 then
      insert into public.business_accounts (business_id, amount, entry_type, category, reference_id, description, journal_entry_id)
      values (
        v_listing.source_business_id,
        v_fee,
        'debit',
        'market_fee',
        v_listing.id,
        'Market fee: ' || p_sold_qty::text || 'x ' || v_listing.item_key,
        v_journal_entry_id
      );
    end if;
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

    insert into public.transactions (account_id, amount, direction, transaction_type, reference_id, description)
    values (
      v_seller_checking_account_id,
      v_net,
      'credit',
      'market_sale',
      v_listing.id,
      'NPC market sale: ' || p_sold_qty::text || 'x ' || v_listing.item_key
    );
  end if;

  insert into public.market_transactions (
    listing_id, seller_player_id, buyer_player_id, buyer_type, seller_source_type,
    seller_business_id, seller_business_name,
    buyer_business_id, buyer_business_name,
    city_id, item_key, quality, quantity, unit_price, gross_total, market_fee, net_total,
    shopper_name, shopper_tier, shopper_budget, sub_tick_index, tick_window_started_at
  ) values (
    v_listing.id, v_listing.owner_player_id, null, 'npc', v_listing.source_type,
    v_listing.source_business_id, coalesce(v_seller_business_name, 'Unknown Seller'),
    null, null,
    v_listing.city_id, v_listing.item_key, v_listing.quality, p_sold_qty, v_listing.unit_price, v_gross, v_fee, v_net,
    p_shopper_name, p_shopper_tier, p_shopper_budget, p_sub_tick_index, p_tick_window_started_at
  )
  returning * into v_tx;

  if v_listing.source_type = 'business' then
    insert into public.business_financial_events (business_id, account_code, amount, quantity, item_key, reference_type, reference_id, description, metadata)
    values
      (
        v_listing.source_business_id, 'revenue', v_gross, p_sold_qty, v_listing.item_key, 'market_transaction', v_tx.id,
        'NPC market sale revenue: ' || p_sold_qty::text || 'x ' || v_listing.item_key,
        jsonb_build_object('buyerType', 'npc')
      ),
      (
        v_listing.source_business_id, 'cogs', v_sold_inventory_cost, p_sold_qty, v_listing.item_key, 'market_transaction', v_tx.id,
        'NPC market sale COGS: ' || p_sold_qty::text || 'x ' || v_listing.item_key,
        jsonb_build_object('unitCost', v_inventory_unit_cost)
      ),
      (
        v_listing.source_business_id, 'inventory', v_sold_inventory_cost, p_sold_qty, v_listing.item_key, 'market_transaction', v_tx.id,
        'Inventory relieved on NPC market sale: ' || p_sold_qty::text || 'x ' || v_listing.item_key,
        jsonb_build_object('direction', 'out', 'unitCost', v_inventory_unit_cost)
      );

    if v_fee > 0 then
      insert into public.business_financial_events (business_id, account_code, amount, quantity, item_key, reference_type, reference_id, description)
      values (
        v_listing.source_business_id, 'operating_expense', v_fee, p_sold_qty, v_listing.item_key, 'market_transaction', v_tx.id,
        'Market fee expense: ' || p_sold_qty::text || 'x ' || v_listing.item_key
      );
    end if;
  end if;

  return jsonb_build_object('gross', v_gross, 'fee', v_fee, 'net', v_net, 'listing', to_jsonb(v_updated_listing));
end;
$$;

-- ---------------------------------------------------------------------------
-- execute_market_purchase -- buyer journal entry (always, buyer is always a
-- business) plus seller journal entry (only when the listing is business-
-- sourced), each linked to that side's own business_accounts rows.
-- ---------------------------------------------------------------------------

create or replace function public.execute_market_purchase(
  p_listing_id      uuid,
  p_quantity        integer,
  p_buyer_business_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_player_id uuid := auth.uid();
  v_listing         public.market_listings%rowtype;
  v_updated_listing public.market_listings%rowtype;
  v_buyer_business  public.businesses%rowtype;
  v_source_inventory public.business_inventory%rowtype;
  v_target_inventory public.business_inventory%rowtype;
  v_now             timestamptz := now();
  v_next_qty        integer;
  v_next_reserved   integer;
  v_next_status     text;
  v_gross           numeric(14, 2);
  v_fee             numeric(14, 2);
  v_net             numeric(14, 2);
  v_buyer_balance   numeric;
  v_seller_business_name text;
  v_seller_checking_account_id uuid;
  v_tx              public.market_transactions%rowtype;
  -- Market transaction fee rate: keep in sync with MARKET_TRANSACTION_FEE in shared/economy.ts
  v_fee_rate        constant numeric := 0.03;
  v_purchase_unit_cost numeric;
  v_next_total_cost numeric;
  v_next_unit_cost  numeric;
  v_seller_unit_cost numeric;
  v_seller_next_total_cost numeric;
  v_seller_relief_cost numeric;
  v_buyer_journal_entry_id uuid;
  v_seller_journal_entry_id uuid;
  v_seller_journal_lines jsonb;
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

  if v_listing.owner_player_id = v_buyer_player_id then
    raise exception 'Cannot buy your own listing.';
  end if;

  if p_quantity > v_listing.quantity then
    raise exception 'Requested quantity exceeds listing availability.';
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
  v_fee   := round((v_gross * v_fee_rate)::numeric, 2);
  v_net   := round((v_gross - v_fee)::numeric, 2);
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

  if v_listing.source_inventory_id is not null then
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

    -- Weighted-average cost relief via the shared helper.
    select r.unit_cost, r.relieved_cost, r.next_total_cost
    into v_seller_unit_cost, v_seller_relief_cost, v_seller_next_total_cost
    from public.compute_inventory_cost_relief(
      v_source_inventory.quantity, v_source_inventory.total_cost, v_source_inventory.unit_cost, p_quantity, 0
    ) r;

    if (v_source_inventory.quantity - p_quantity) <= 0 then
      delete from public.business_inventory
      where id = v_source_inventory.id;
    else
      update public.business_inventory
      set
        quantity          = v_source_inventory.quantity - p_quantity,
        reserved_quantity = greatest(
          0,
          least(
            v_source_inventory.quantity - p_quantity,
            v_source_inventory.reserved_quantity - p_quantity
          )
        ),
        total_cost        = v_seller_next_total_cost,
        updated_at        = v_now
      where id = v_source_inventory.id;
    end if;
  end if;

  v_next_qty      := v_listing.quantity - p_quantity;
  v_next_reserved := greatest(0, v_listing.reserved_quantity - p_quantity);
  v_next_status   := case when v_next_qty <= 0 then 'filled' else 'active' end;

  update public.market_listings
  set
    quantity          = greatest(0, v_next_qty),
    reserved_quantity = greatest(0, v_next_reserved),
    status            = v_next_status,
    filled_at         = case when v_next_status = 'filled' then v_now else null end,
    updated_at        = v_now
  where id = v_listing.id
  returning * into v_updated_listing;

  select *
  into v_target_inventory
  from public.business_inventory
  where owner_player_id = v_buyer_player_id
    and business_id     = p_buyer_business_id
    and item_key        = v_listing.item_key
    and quality         = v_listing.quality
  for update;

  -- Weighted-average cost basis, computed under the same lock that updates
  -- quantity, using the same formula as computeWeightedAverageCost().
  v_purchase_unit_cost := round((v_gross / p_quantity)::numeric, 2);

  if not found then
    insert into public.business_inventory (
      owner_player_id, business_id, city_id, item_key, quality, quantity, reserved_quantity,
      unit_cost, total_cost
    ) values (
      v_buyer_player_id, p_buyer_business_id, v_buyer_business.city_id,
      v_listing.item_key, v_listing.quality, p_quantity, 0,
      v_purchase_unit_cost, round((p_quantity * v_purchase_unit_cost)::numeric, 2)
    );
  else
    select a.next_total_cost, a.next_unit_cost
    into v_next_total_cost, v_next_unit_cost
    from public.compute_inventory_cost_addition(
      v_target_inventory.quantity, v_target_inventory.total_cost, v_target_inventory.unit_cost, p_quantity, v_purchase_unit_cost
    ) a;

    update public.business_inventory
    set
      quantity   = v_target_inventory.quantity + p_quantity,
      unit_cost  = v_next_unit_cost,
      total_cost = v_next_total_cost,
      updated_at = v_now
    where id = v_target_inventory.id;
  end if;

  -- Buyer journal: Debit Inventory / Credit Cash. v_gross > 0 always
  -- (unit_price/quantity are both positive by this point).
  v_buyer_journal_entry_id := public.post_business_journal_entry(
    p_buyer_business_id,
    jsonb_build_array(
      jsonb_build_object('account_code', 'inventory', 'debit', v_gross),
      jsonb_build_object('account_code', 'cash', 'credit', v_gross)
    ),
    'market_transaction',
    v_listing.id,
    'Market purchase: ' || p_quantity::text || 'x ' || v_listing.item_key,
    v_now
  );

  -- Buyer inventory purchase debit
  insert into public.business_accounts (business_id, amount, entry_type, category, reference_id, description, journal_entry_id)
  values (
    p_buyer_business_id,
    v_gross,
    'debit',
    'market_purchase',
    v_listing.id,
    'Market purchase: ' || p_quantity::text || 'x ' || v_listing.item_key,
    v_buyer_journal_entry_id
  );

  if v_listing.source_type = 'business' then
    v_seller_journal_lines := jsonb_build_array(
      jsonb_build_object('account_code', 'cash', 'debit', v_gross),
      jsonb_build_object('account_code', 'revenue', 'credit', v_gross)
    )
    || case when v_seller_relief_cost > 0 then jsonb_build_array(
         jsonb_build_object('account_code', 'cogs', 'debit', v_seller_relief_cost),
         jsonb_build_object('account_code', 'inventory', 'credit', v_seller_relief_cost)
       ) else '[]'::jsonb end
    || case when v_fee > 0 then jsonb_build_array(
         jsonb_build_object('account_code', 'market_fees', 'debit', v_fee),
         jsonb_build_object('account_code', 'cash', 'credit', v_fee)
       ) else '[]'::jsonb end;

    v_seller_journal_entry_id := public.post_business_journal_entry(
      v_listing.source_business_id,
      v_seller_journal_lines,
      'market_transaction',
      v_listing.id,
      'PLAYER market sale: ' || p_quantity::text || 'x ' || v_listing.item_key,
      v_now
    );

    -- Seller revenue credit — always positive (gross > 0 enforced by listing quantity/price checks above)
    insert into public.business_accounts (business_id, amount, entry_type, category, reference_id, description, journal_entry_id)
    values (
      v_listing.source_business_id,
      v_gross,
      'credit',
      'market_sale',
      v_listing.id,
      'PLAYER market sale: ' || p_quantity::text || 'x ' || v_listing.item_key,
      v_seller_journal_entry_id
    );

    -- Seller fee debit — only when fee > 0 (rounds to zero for very cheap items)
    if v_fee > 0 then
      insert into public.business_accounts (business_id, amount, entry_type, category, reference_id, description, journal_entry_id)
      values (
        v_listing.source_business_id,
        v_fee,
        'debit',
        'market_fee',
        v_listing.id,
        'Market fee: ' || p_quantity::text || 'x ' || v_listing.item_key,
        v_seller_journal_entry_id
      );
    end if;
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

    insert into public.transactions (account_id, amount, direction, transaction_type, reference_id, description)
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
    listing_id, seller_player_id, buyer_player_id, buyer_type, seller_source_type,
    seller_business_id, seller_business_name,
    buyer_business_id, buyer_business_name,
    city_id, item_key, quality, quantity, unit_price, gross_total, market_fee, net_total
  ) values (
    v_listing.id,
    v_listing.owner_player_id,
    v_buyer_player_id,
    'player',
    v_listing.source_type,
    v_listing.source_business_id,
    coalesce(v_seller_business_name, 'Unknown Business'),
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

  -- Finance-dashboard bookkeeping, inserted atomically in the same transaction
  -- as everything above.
  insert into public.business_financial_events (business_id, account_code, amount, quantity, item_key, reference_type, reference_id, description)
  values (
    p_buyer_business_id, 'inventory', v_gross, p_quantity, v_listing.item_key, 'market_transaction', v_tx.id,
    'Inventory acquired: ' || p_quantity::text || 'x ' || v_listing.item_key
  );

  if v_listing.source_type = 'business' then
    insert into public.business_financial_events (business_id, account_code, amount, quantity, item_key, reference_type, reference_id, description, metadata)
    values
      (
        v_listing.source_business_id, 'revenue', v_gross, p_quantity, v_listing.item_key, 'market_transaction', v_tx.id,
        'Player market sale revenue: ' || p_quantity::text || 'x ' || v_listing.item_key,
        jsonb_build_object('buyerType', 'player')
      ),
      (
        v_listing.source_business_id, 'cogs', v_seller_relief_cost, p_quantity, v_listing.item_key, 'market_transaction', v_tx.id,
        'COGS on player market sale: ' || p_quantity::text || 'x ' || v_listing.item_key,
        jsonb_build_object('unitCost', coalesce(v_seller_unit_cost, 0))
      ),
      (
        v_listing.source_business_id, 'inventory', v_seller_relief_cost, p_quantity, v_listing.item_key, 'market_transaction', v_tx.id,
        'Inventory relieved on player market sale: ' || p_quantity::text || 'x ' || v_listing.item_key,
        jsonb_build_object('direction', 'out', 'unitCost', coalesce(v_seller_unit_cost, 0))
      );

    if v_fee > 0 then
      insert into public.business_financial_events (business_id, account_code, amount, quantity, item_key, reference_type, reference_id, description)
      values (
        v_listing.source_business_id, 'operating_expense', v_fee, p_quantity, v_listing.item_key, 'market_transaction', v_tx.id,
        'Market fee expense: ' || p_quantity::text || 'x ' || v_listing.item_key
      );
    end if;
  end if;

  return jsonb_build_object(
    'listing',     to_jsonb(v_updated_listing),
    'transaction', to_jsonb(v_tx)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- execute_inventory_transfer -- B2B same-city: journal entries for both
-- source and destination businesses. B2B shipping (cross-city): journal
-- entry for the source business only, at dispatch (matching the existing
-- dispatch-time revenue recognition; the destination gets no inventory event
-- until arrival, see this migration's header for why delivery itself isn't
-- journaled).
-- ---------------------------------------------------------------------------

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
  v_source_relieved_cost numeric;
  v_source_next_total_cost numeric;
  v_is_b2b boolean;
  v_destination_next_total_cost numeric;
  v_destination_next_unit_cost numeric;
  v_source_journal_entry_id uuid;
  v_destination_journal_entry_id uuid;
  v_source_journal_lines jsonb;
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

  v_is_b2b := p_source_type = 'business' and p_destination_type = 'business';

  if v_is_b2b and (p_unit_price is null or p_unit_price < 1) then
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

  if v_is_b2b then
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

    -- Weighted-average cost relief via the shared helper (compute_inventory_cost_relief) --
    -- same formula used by every other inventory-relieving RPC.
    select r.unit_cost, r.relieved_cost, r.next_total_cost
    into v_source_unit_cost, v_source_relieved_cost, v_source_next_total_cost
    from public.compute_inventory_cost_relief(
      v_source_business_inventory.quantity, v_source_business_inventory.total_cost, v_source_business_inventory.unit_cost,
      p_quantity, 0
    ) r;

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

      if v_is_b2b then
        -- Acquisition cost basis = what the buyer actually paid
        -- (p_unit_price), blended via the shared weighted-average addition
        -- helper -- same formula every other inventory-adding RPC uses.
        if not found then
          insert into public.business_inventory (
            owner_player_id, business_id, city_id, item_key, quantity, quality, reserved_quantity,
            unit_cost, total_cost
          )
          values (
            v_player_id, p_destination_business_id, v_destination_city_id, p_item_key, p_quantity, p_quality, 0,
            p_unit_price, round((p_quantity * p_unit_price)::numeric, 2)
          );
        else
          select a.next_total_cost, a.next_unit_cost
          into v_destination_next_total_cost, v_destination_next_unit_cost
          from public.compute_inventory_cost_addition(
            v_destination_business_inventory.quantity, v_destination_business_inventory.total_cost,
            v_destination_business_inventory.unit_cost, p_quantity, p_unit_price
          ) a;

          update public.business_inventory
          set
            quantity = v_destination_business_inventory.quantity + p_quantity,
            unit_cost = v_destination_next_unit_cost,
            total_cost = v_destination_next_total_cost,
            updated_at = v_now
          where id = v_destination_business_inventory.id;
        end if;
      else
        -- Non-B2B destination (e.g. personal -> business): no established
        -- acquisition price exists for this transfer, so cost basis is left
        -- untouched, matching this path's pre-existing behavior -- out of
        -- this phase's scope (item 44 is specifically B2B).
        if not found then
          insert into public.business_inventory (
            owner_player_id, business_id, city_id, item_key, quantity, quality, reserved_quantity
          )
          values (
            v_player_id, p_destination_business_id, v_destination_city_id, p_item_key, p_quantity, p_quality, 0
          );
        else
          update public.business_inventory
          set quantity = v_destination_business_inventory.quantity + p_quantity, updated_at = v_now
          where id = v_destination_business_inventory.id;
        end if;
      end if;
    end if;

    if v_is_b2b then
      v_source_journal_lines := jsonb_build_array(
        jsonb_build_object('account_code', 'cash', 'debit', v_inventory_sale_amount),
        jsonb_build_object('account_code', 'revenue', 'credit', v_inventory_sale_amount)
      )
      || case when v_source_relieved_cost > 0 then jsonb_build_array(
           jsonb_build_object('account_code', 'cogs', 'debit', v_source_relieved_cost),
           jsonb_build_object('account_code', 'inventory', 'credit', v_source_relieved_cost)
         ) else '[]'::jsonb end;

      v_source_journal_entry_id := public.post_business_journal_entry(
        p_source_business_id,
        v_source_journal_lines,
        'inventory_transfer',
        v_transfer_reference_id,
        'Inventory transfer sale: ' || p_quantity::text || 'x ' || p_item_key,
        v_now
      );

      v_destination_journal_entry_id := public.post_business_journal_entry(
        p_destination_business_id,
        jsonb_build_array(
          jsonb_build_object('account_code', 'inventory', 'debit', v_inventory_sale_amount),
          jsonb_build_object('account_code', 'cash', 'credit', v_inventory_sale_amount)
        ),
        'inventory_transfer',
        v_transfer_reference_id,
        'Inventory transfer purchase: ' || p_quantity::text || 'x ' || p_item_key,
        v_now
      );

      insert into public.business_accounts (
        business_id, amount, entry_type, category, reference_id, description, journal_entry_id
      )
      values
      (
        p_source_business_id, v_inventory_sale_amount, 'credit', 'business_transfer_in', v_transfer_reference_id,
        'Inventory transfer sale: ' || p_quantity::text || 'x ' || p_item_key || ' @ ' || to_char(p_unit_price, 'FM9999999990.00'),
        v_source_journal_entry_id
      ),
      (
        p_destination_business_id, v_inventory_sale_amount, 'debit', 'business_transfer_out', v_transfer_reference_id,
        'Inventory transfer purchase: ' || p_quantity::text || 'x ' || p_item_key || ' @ ' || to_char(p_unit_price, 'FM9999999990.00'),
        v_destination_journal_entry_id
      );

      insert into public.business_financial_events (business_id, account_code, amount, quantity, item_key, reference_type, reference_id, description, metadata)
      values
        (
          p_source_business_id, 'revenue', v_inventory_sale_amount, p_quantity, p_item_key, 'inventory_transfer', v_transfer_reference_id,
          'Intercompany transfer revenue: ' || p_quantity::text || 'x ' || p_item_key,
          '{}'::jsonb
        ),
        (
          p_source_business_id, 'cogs', v_source_relieved_cost, p_quantity, p_item_key, 'inventory_transfer', v_transfer_reference_id,
          'Intercompany transfer COGS: ' || p_quantity::text || 'x ' || p_item_key,
          jsonb_build_object('unitCost', coalesce(v_source_unit_cost, 0))
        ),
        (
          p_source_business_id, 'inventory', v_source_relieved_cost, p_quantity, p_item_key, 'inventory_transfer', v_transfer_reference_id,
          'Inventory relieved for transfer: ' || p_quantity::text || 'x ' || p_item_key,
          jsonb_build_object('direction', 'out', 'unitCost', coalesce(v_source_unit_cost, 0))
        ),
        (
          p_destination_business_id, 'inventory', v_inventory_sale_amount, p_quantity, p_item_key, 'inventory_transfer', v_transfer_reference_id,
          'Inventory acquired by transfer: ' || p_quantity::text || 'x ' || p_item_key,
          jsonb_build_object('direction', 'in')
        );
    end if;

    return jsonb_build_object(
      'transferType', 'same_city',
      'shippingQueueItem', null,
      'shippingCost', 0,
      'shippingMinutes', 0,
      'referenceId', v_transfer_reference_id,
      'sourceUnitCost', case when p_source_type = 'business' then v_source_unit_cost else null end,
      'sourceRelievedCost', case when p_source_type = 'business' then v_source_relieved_cost else null end
    );
  end if;

  if p_shipping_minutes is null or p_shipping_minutes < 1 then
    raise exception 'Shipping minutes must be at least 1 for cross-city transfers.';
  end if;

  if p_shipping_cost is null or p_shipping_cost < 0 then
    raise exception 'Shipping cost must be non-negative for cross-city transfers.';
  end if;

  if v_is_b2b then
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
    case when v_is_b2b then round(p_unit_price::numeric, 2) else null end,
    v_now,
    v_now + make_interval(mins => p_shipping_minutes),
    p_destination_type,
    case when p_destination_type = 'personal' then v_player_id else p_destination_business_id end,
    'in_transit'
  )
  returning * into v_shipment;

  if v_is_b2b then
    v_transfer_reference_id := v_shipment.id;

    v_source_journal_lines := jsonb_build_array(
      jsonb_build_object('account_code', 'cash', 'debit', v_inventory_sale_amount),
      jsonb_build_object('account_code', 'revenue', 'credit', v_inventory_sale_amount)
    )
    || case when v_source_relieved_cost > 0 then jsonb_build_array(
         jsonb_build_object('account_code', 'cogs', 'debit', v_source_relieved_cost),
         jsonb_build_object('account_code', 'inventory', 'credit', v_source_relieved_cost)
       ) else '[]'::jsonb end;

    v_source_journal_entry_id := public.post_business_journal_entry(
      p_source_business_id,
      v_source_journal_lines,
      'inventory_transfer',
      v_transfer_reference_id,
      'Inventory transfer sale: ' || p_quantity::text || 'x ' || p_item_key,
      v_now
    );

    insert into public.business_accounts (
      business_id, amount, entry_type, category, reference_id, description, journal_entry_id
    )
    values
    (
      p_source_business_id, v_inventory_sale_amount, 'credit', 'business_transfer_in', v_transfer_reference_id,
      'Inventory transfer sale: ' || p_quantity::text || 'x ' || p_item_key || ' @ ' || to_char(p_unit_price, 'FM9999999990.00'),
      v_source_journal_entry_id
    ),
    (
      p_destination_business_id, v_inventory_sale_amount, 'debit', 'business_transfer_out', v_transfer_reference_id,
      'Inventory transfer purchase: ' || p_quantity::text || 'x ' || p_item_key || ' @ ' || to_char(p_unit_price, 'FM9999999990.00'),
      null
    );

    -- No destination "inventory acquired" event yet -- the goods are still
    -- in shipping_queue, not in the buyer's business_inventory, until
    -- delivery resolves them (landed cost at arrival is item 45 / Phase F).
    -- No destination journal entry either, for the same reason plus the
    -- "goods in transit" gap documented in this migration's header comment.
    insert into public.business_financial_events (business_id, account_code, amount, quantity, item_key, reference_type, reference_id, description, metadata)
    values
      (
        p_source_business_id, 'revenue', v_inventory_sale_amount, p_quantity, p_item_key, 'inventory_transfer', v_transfer_reference_id,
        'Intercompany transfer revenue: ' || p_quantity::text || 'x ' || p_item_key,
        '{}'::jsonb
      ),
      (
        p_source_business_id, 'cogs', v_source_relieved_cost, p_quantity, p_item_key, 'inventory_transfer', v_transfer_reference_id,
        'Intercompany transfer COGS: ' || p_quantity::text || 'x ' || p_item_key,
        jsonb_build_object('unitCost', coalesce(v_source_unit_cost, 0))
      ),
      (
        p_source_business_id, 'inventory', v_source_relieved_cost, p_quantity, p_item_key, 'inventory_transfer', v_transfer_reference_id,
        'Inventory relieved for transfer: ' || p_quantity::text || 'x ' || p_item_key,
        jsonb_build_object('direction', 'out', 'unitCost', coalesce(v_source_unit_cost, 0))
      );
  end if;

  if p_shipping_cost > 0 then
    if v_is_b2b then
      insert into public.business_accounts (
        business_id, amount, entry_type, category, reference_id, description
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
        account_id, amount, direction, transaction_type, reference_id, description
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
    'referenceId', v_transfer_reference_id,
    'sourceUnitCost', case when p_source_type = 'business' then v_source_unit_cost else null end,
    'sourceRelievedCost', case when p_source_type = 'business' then v_source_relieved_cost else null end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- fulfill_contract_atomic -- single balanced journal entry per fulfillment.
-- ---------------------------------------------------------------------------

create or replace function public.fulfill_contract_atomic(
  p_player_id uuid,
  p_contract_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contract public.contracts%rowtype;
  v_business_id uuid;
  v_remaining integer;
  v_available numeric;
  v_to_consume numeric;
  v_row record;
  v_row_available numeric;
  v_used numeric;
  v_row_unit_cost numeric;
  v_row_relieved_cost numeric;
  v_row_next_qty numeric;
  v_row_next_total_cost numeric;
  v_row_estimated boolean;
  v_estimated boolean := false;
  v_consumed_cost numeric := 0;
  v_consumed_qty numeric := 0;
  v_payout numeric;
  v_now timestamptz := now();
  v_journal_lines jsonb;
  v_journal_entry_id uuid;
begin
  if p_player_id is null then
    raise exception 'player_id is required.';
  end if;

  select * into v_contract
  from public.contracts
  where id = p_contract_id and owner_player_id = p_player_id
  for update;

  if v_contract.id is null then
    raise exception 'Contract not found.';
  end if;

  if v_contract.status not in ('accepted', 'in_progress') then
    raise exception 'Only accepted or in-progress contracts can be fulfilled.';
  end if;

  select id into v_business_id
  from public.businesses
  where id = v_contract.business_id and player_id = p_player_id;

  if v_business_id is null then
    raise exception 'Business not found.';
  end if;

  v_remaining := greatest(0, v_contract.required_quantity - v_contract.delivered_quantity);
  if v_remaining <= 0 then
    raise exception 'Contract is already fully delivered.';
  end if;

  select coalesce(sum(greatest(0, quantity - reserved_quantity)), 0)
  into v_available
  from public.business_inventory
  where owner_player_id = p_player_id
    and business_id = v_contract.business_id
    and item_key = v_contract.item_key;

  if v_available < v_remaining then
    -- Nothing else has mutated yet in this call, so this commits as a plain
    -- status transition -- matching the pre-existing "attempted but short"
    -- behavior -- while the actual fulfillment stays all-or-nothing below.
    update public.contracts
    set status = 'in_progress', updated_at = v_now
    where id = v_contract.id;

    return jsonb_build_object('ok', false, 'reason', 'insufficient_inventory');
  end if;

  v_to_consume := v_remaining;

  for v_row in
    select id, quantity, reserved_quantity, unit_cost, total_cost
    from public.business_inventory
    where owner_player_id = p_player_id
      and business_id = v_contract.business_id
      and item_key = v_contract.item_key
    order by quality desc
    for update
  loop
    exit when v_to_consume <= 0;
    v_row_available := greatest(0, v_row.quantity - v_row.reserved_quantity);
    if v_row_available <= 0 then continue; end if;
    v_used := least(v_row_available, v_to_consume);

    select r.unit_cost, r.relieved_cost, r.next_quantity, r.next_total_cost, r.estimated
    into v_row_unit_cost, v_row_relieved_cost, v_row_next_qty, v_row_next_total_cost, v_row_estimated
    from public.compute_inventory_cost_relief(
      v_row.quantity, v_row.total_cost, v_row.unit_cost, v_used, 0
    ) r;

    if v_row_next_qty <= 0 then
      delete from public.business_inventory where id = v_row.id;
    else
      update public.business_inventory
      set
        quantity = v_row_next_qty,
        reserved_quantity = least(v_row.reserved_quantity, v_row_next_qty),
        total_cost = v_row_next_total_cost,
        updated_at = v_now
      where id = v_row.id;
    end if;

    v_consumed_cost := v_consumed_cost + v_row_relieved_cost;
    v_consumed_qty := v_consumed_qty + v_used;
    v_estimated := v_estimated or v_row_estimated;
    v_to_consume := v_to_consume - v_used;
  end loop;

  if v_to_consume > 0 then
    -- Should be unreachable given the availability check above (same
    -- transaction, rows locked immediately after) -- guards against a
    -- reserved_quantity accounting mismatch rather than silently paying out
    -- for goods that were never actually relieved.
    raise exception 'Inventory changed during fulfillment -- insufficient available quantity.';
  end if;

  v_payout := round((v_remaining * v_contract.unit_price)::numeric, 2);

  v_journal_lines := case when v_payout > 0 then jsonb_build_array(
       jsonb_build_object('account_code', 'cash', 'debit', v_payout),
       jsonb_build_object('account_code', 'revenue', 'credit', v_payout)
     ) else '[]'::jsonb end
  || case when v_consumed_cost > 0 then jsonb_build_array(
       jsonb_build_object('account_code', 'cogs', 'debit', v_consumed_cost),
       jsonb_build_object('account_code', 'inventory', 'credit', v_consumed_cost)
     ) else '[]'::jsonb end;

  if jsonb_array_length(v_journal_lines) >= 2 then
    v_journal_entry_id := public.post_business_journal_entry(
      v_contract.business_id,
      v_journal_lines,
      'contract',
      v_contract.id,
      'Contract fulfillment: ' || v_remaining::text || 'x ' || v_contract.item_key,
      v_now
    );
  end if;

  if v_payout > 0 then
    insert into public.business_accounts (business_id, amount, entry_type, category, reference_id, description, journal_entry_id)
    values (
      v_contract.business_id, v_payout, 'credit', 'contract_payout', v_contract.id,
      'Contract payout: ' || v_remaining::text || 'x ' || v_contract.item_key,
      v_journal_entry_id
    );
  end if;

  insert into public.business_financial_events (business_id, account_code, amount, quantity, item_key, reference_type, reference_id, description, metadata)
  values
    (
      v_contract.business_id, 'revenue', v_payout, v_remaining, v_contract.item_key, 'contract', v_contract.id,
      'Contract revenue: ' || v_remaining::text || 'x ' || v_contract.item_key,
      jsonb_build_object('estimatedCost', v_estimated)
    ),
    (
      v_contract.business_id, 'cogs', v_consumed_cost, v_consumed_qty, v_contract.item_key, 'contract', v_contract.id,
      'Contract COGS: ' || v_remaining::text || 'x ' || v_contract.item_key,
      jsonb_build_object('estimatedCost', v_estimated)
    ),
    (
      v_contract.business_id, 'inventory', v_consumed_cost, v_consumed_qty, v_contract.item_key, 'contract', v_contract.id,
      'Inventory relieved for contract: ' || v_remaining::text || 'x ' || v_contract.item_key,
      jsonb_build_object('direction', 'out', 'estimatedCost', v_estimated)
    );

  update public.contracts
  set
    delivered_quantity = v_contract.required_quantity,
    status = 'fulfilled',
    completed_at = v_now,
    updated_at = v_now
  where id = v_contract.id
  returning * into v_contract;

  return jsonb_build_object('ok', true, 'contract', to_jsonb(v_contract), 'payout', v_payout, 'consumedCost', v_consumed_cost);
end;
$$;

-- ---------------------------------------------------------------------------
-- purchase_business_upgrade_atomic -- single balanced journal entry
-- (Debit Fixed Assets / Credit Cash), skipped only for a $0 quoted cost.
-- ---------------------------------------------------------------------------

create or replace function public.purchase_business_upgrade_atomic(
  p_player_id uuid,
  p_business_id uuid,
  p_upgrade_key text,
  p_target_level integer,
  p_quoted_cost numeric,
  p_downtime_policy text,
  p_install_time_minutes integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business public.businesses%rowtype;
  v_balance numeric;
  v_now timestamptz := now();
  v_cost numeric;
  v_project public.business_upgrade_projects%rowtype;
  v_journal_entry_id uuid;
begin
  if p_player_id is null then
    raise exception 'player_id is required.';
  end if;

  select * into v_business
  from public.businesses
  where id = p_business_id
  for update;

  if not found or v_business.player_id <> p_player_id then
    raise exception 'Business not found.';
  end if;

  if p_quoted_cost is null or p_quoted_cost < 0 then
    raise exception 'Quoted cost must be non-negative.';
  end if;

  v_cost := round(p_quoted_cost::numeric, 2);

  select public.get_business_account_balance(p_business_id) into v_balance;

  if coalesce(v_balance, 0) < v_cost then
    raise exception 'Insufficient business funds. Upgrade cost is $%, and balance is $%.',
      to_char(v_cost, 'FM9999999990.00'),
      to_char(coalesce(v_balance, 0), 'FM9999999990.00');
  end if;

  begin
    insert into public.business_upgrade_projects (
      business_id, upgrade_key, target_level, project_status, quoted_cost,
      started_at, completes_at, applied_at, downtime_policy
    )
    values (
      p_business_id, p_upgrade_key, p_target_level, 'installing', v_cost,
      v_now, v_now + make_interval(mins => greatest(0, coalesce(p_install_time_minutes, 0))), null, p_downtime_policy
    )
    returning * into v_project;
  exception when unique_violation then
    raise exception 'This business already has an active capital project.';
  end;

  if v_cost > 0 then
    v_journal_entry_id := public.post_business_journal_entry(
      p_business_id,
      jsonb_build_array(
        jsonb_build_object('account_code', 'fixed_assets', 'debit', v_cost),
        jsonb_build_object('account_code', 'cash', 'credit', v_cost)
      ),
      'upgrade_project',
      v_project.id,
      'Capitalized upgrade: ' || p_upgrade_key || ' Lv.' || p_target_level::text,
      v_now
    );
  end if;

  insert into public.business_accounts (business_id, amount, entry_type, category, reference_id, description, journal_entry_id)
  values (
    p_business_id, v_cost, 'debit', 'upgrade_purchase', v_project.id,
    'Upgrade project funded: ' || p_upgrade_key || ' Lv.' || p_target_level::text,
    v_journal_entry_id
  );

  insert into public.business_financial_events (business_id, account_code, amount, reference_type, reference_id, description, metadata)
  values (
    p_business_id, 'fixed_assets', v_cost, 'upgrade_project', v_project.id,
    'Capitalized upgrade: ' || p_upgrade_key || ' Lv.' || p_target_level::text,
    jsonb_build_object('upgradeKey', p_upgrade_key, 'targetLevel', p_target_level)
  );

  return jsonb_build_object(
    'project', to_jsonb(v_project),
    'debitedAmount', v_cost,
    'resultingBalance', round(coalesce(v_balance, 0) - v_cost, 2)
  );
end;
$$;

-- Migration complete: journal-entry coverage now spans storefront sales,
-- NPC market-listing sales, open-market purchases (buyer + business seller),
-- B2B inventory transfers (both legs same-city, source leg at cross-city
-- dispatch), contract fulfillment, and upgrade capitalization. Grants on all
-- rewritten functions are unchanged (CREATE OR REPLACE FUNCTION preserves
-- existing ACLs).
