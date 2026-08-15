-- Phase 88: make execute_market_purchase's seller-side cost-basis relief and
-- finance-dashboard bookkeeping atomic, closing a real (if intermittent) data
-- corruption path.
--
-- Previously, execute_market_purchase decremented the seller's business_inventory
-- quantity but never touched total_cost, and the seller's cost-basis correction plus
-- revenue/COGS/inventory/fee business_financial_events rows were written afterwards, in
-- three separate unlocked network round trips from src/domains/market/service.ts
-- (buyMarketListing): a plain SELECT read of cost basis before calling this RPC, then
-- this RPC committing the trade, then a follow-up UPDATE + financial-event inserts. If
-- that follow-up step ever failed (transient DB/network error, concurrent request) after
-- this RPC had already committed, the trade was final but the seller's total_cost was
-- never corrected and no COGS/revenue financial event was recorded for that sale —
-- permanently desyncing the finance dashboard's Balance Sheet / COGS from what actually
-- happened. Every other settlement RPC (settle_market_listing_npc_sale_atomic,
-- settle_store_inventory_sale_atomic, and the buy-order functions in 086) already does
-- this atomically in SQL; this migration brings execute_market_purchase in line with
-- that pattern. src/domains/market/service.ts is updated in the same change to stop
-- doing the now-redundant TS-side preview/refresh/financial-event work.

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
  v_existing_total_cost numeric;
  v_existing_qty    numeric;
  v_next_total_cost numeric;
  v_next_unit_cost  numeric;
  v_seller_unit_cost numeric;
  v_seller_next_total_cost numeric;
  v_seller_relief_cost numeric;
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

    -- Weighted-average cost basis, read before relief (same formula used by
    -- settle_market_listing_npc_sale_atomic / settle_store_inventory_sale_atomic / 086/087).
    v_seller_unit_cost := case
      when v_source_inventory.total_cost is not null and v_source_inventory.quantity > 0
        then round((v_source_inventory.total_cost / v_source_inventory.quantity)::numeric, 2)
      else coalesce(v_source_inventory.unit_cost, 0)
    end;

    if (v_source_inventory.quantity - p_quantity) <= 0 then
      delete from public.business_inventory
      where id = v_source_inventory.id;
    else
      v_seller_next_total_cost := case
        when v_source_inventory.total_cost is not null
          then round(greatest(0, v_source_inventory.total_cost - v_seller_unit_cost * p_quantity)::numeric, 2)
        else null
      end;

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
    v_existing_qty := greatest(0, v_target_inventory.quantity);
    v_existing_total_cost := case
      when v_target_inventory.total_cost is null then v_existing_qty * coalesce(v_target_inventory.unit_cost, 0)
      else v_target_inventory.total_cost
    end;
    v_next_total_cost := round((v_existing_total_cost + p_quantity * v_purchase_unit_cost)::numeric, 2);
    v_next_unit_cost := case
      when (v_existing_qty + p_quantity) > 0 then round((v_next_total_cost / (v_existing_qty + p_quantity))::numeric, 2)
      else 0
    end;

    update public.business_inventory
    set
      quantity   = v_target_inventory.quantity + p_quantity,
      unit_cost  = v_next_unit_cost,
      total_cost = v_next_total_cost,
      updated_at = v_now
    where id = v_target_inventory.id;
  end if;

  -- Buyer inventory purchase debit
  insert into public.business_accounts (business_id, amount, entry_type, category, reference_id, description)
  values (
    p_buyer_business_id,
    v_gross,
    'debit',
    'market_purchase',
    v_listing.id,
    'Market purchase: ' || p_quantity::text || 'x ' || v_listing.item_key
  );

  if v_listing.source_type = 'business' then
    -- Seller revenue credit — always positive (gross > 0 enforced by listing quantity/price checks above)
    insert into public.business_accounts (business_id, amount, entry_type, category, reference_id, description)
    values (
      v_listing.source_business_id,
      v_gross,
      'credit',
      'market_sale',
      v_listing.id,
      'PLAYER market sale: ' || p_quantity::text || 'x ' || v_listing.item_key
    );

    -- Seller fee debit — only when fee > 0 (rounds to zero for very cheap items)
    if v_fee > 0 then
      insert into public.business_accounts (business_id, amount, entry_type, category, reference_id, description)
      values (
        v_listing.source_business_id,
        v_fee,
        'debit',
        'market_fee',
        v_listing.id,
        'Market fee: ' || p_quantity::text || 'x ' || v_listing.item_key
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
  -- as everything above (see migration header for why this moved out of the
  -- unlocked, multi-round-trip TS path in buyMarketListing).
  insert into public.business_financial_events (business_id, account_code, amount, quantity, item_key, reference_type, reference_id, description)
  values (
    p_buyer_business_id, 'inventory', v_gross, p_quantity, v_listing.item_key, 'market_transaction', v_tx.id,
    'Inventory acquired: ' || p_quantity::text || 'x ' || v_listing.item_key
  );

  if v_listing.source_type = 'business' then
    v_seller_relief_cost := round(greatest(0, coalesce(v_seller_unit_cost, 0) * p_quantity)::numeric, 2);

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

-- Migration complete: execute_market_purchase now relieves the seller's cost basis and
-- posts all finance-dashboard bookkeeping atomically, in the same transaction as the trade.
