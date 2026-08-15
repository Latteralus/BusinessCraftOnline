-- NPC open-market purchases: a new, much lower-volume NPC shopper channel that
-- buys directly off active public.market_listings (in addition to the existing
-- storefront-only NPC traffic in tick-npc-purchases). Restricted at the edge
-- function level to a curated allowlist of directly-consumable/finished items
-- (NPC_OPEN_MARKET_ELIGIBLE_ITEMS in shared/economy.ts) — retailers remain the
-- primary NPC sales channel; this is background churn for the open market.
--
-- Mirrors settle_store_inventory_sale_atomic's fully-atomic, single-RPC-call
-- pattern (locks, mutates, and records the sale in one transaction) rather than
-- execute_market_purchase's shape, because there is no real buyer here: NPCs
-- consume the item outright, so there is no buyer business/inventory side to
-- update — only the listing and (for business-sourced listings) the seller's
-- underlying business_inventory row need to move.
--
-- Handles both listing source types, unlike execute_market_purchase pre-081:
--   - source_type = 'business': relieves business_inventory (same locking and
--     weighted-cost-basis-relief logic as execute_market_purchase), credits the
--     seller's business_accounts, and posts business_financial_events.
--   - source_type = 'personal': personal_inventory was already fully consumed
--     at listing-creation time, so there's nothing to relieve there — just
--     credit the seller's personal checking account, matching how
--     execute_market_purchase (post-081) settles a personal seller.
--
-- Market fee is the standard player-market rate (MARKET_TRANSACTION_FEE, 3%),
-- not the higher storefront NPC fee (NPC_STOREFRONT_FEE, 5%) — this is an
-- open-market fill, not a storefront sale; the seller's economics shouldn't
-- change just because an NPC happened to be the buyer instead of a player.

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

    v_inventory_unit_cost := case
      when v_source_inventory.total_cost is not null and v_source_inventory.quantity > 0
        then round((v_source_inventory.total_cost / v_source_inventory.quantity)::numeric, 2)
      else coalesce(v_source_inventory.unit_cost, p_baseline_unit_cost, 0)
    end;
    v_sold_inventory_cost := round(greatest(0, v_inventory_unit_cost * p_sold_qty)::numeric, 2);

    if (v_source_inventory.quantity - p_sold_qty) <= 0 then
      delete from public.business_inventory
      where id = v_source_inventory.id;
    else
      v_next_total_cost := case
        when v_source_inventory.total_cost is not null
          then round(greatest(0, v_source_inventory.total_cost - v_sold_inventory_cost)::numeric, 2)
        else null
      end;

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
    insert into public.business_accounts (business_id, amount, entry_type, category, reference_id, description)
    values (
      v_listing.source_business_id,
      v_gross,
      'credit',
      'market_sale',
      v_listing.id,
      'NPC market sale: ' || p_sold_qty::text || 'x ' || v_listing.item_key
    );

    if v_fee > 0 then
      insert into public.business_accounts (business_id, amount, entry_type, category, reference_id, description)
      values (
        v_listing.source_business_id,
        v_fee,
        'debit',
        'market_fee',
        v_listing.id,
        'Market fee: ' || p_sold_qty::text || 'x ' || v_listing.item_key
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

revoke all on function public.settle_market_listing_npc_sale_atomic(
  uuid, integer, numeric, text, text, numeric, integer, timestamptz
) from public;
grant execute on function public.settle_market_listing_npc_sale_atomic(
  uuid, integer, numeric, text, text, numeric, integer, timestamptz
) to service_role;
