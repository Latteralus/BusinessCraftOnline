-- Phase 86: buy-order settlement RPCs.
--
-- Four entry points cover buy-order placement, matching, and cancellation.
-- All follow the same discipline as execute_market_purchase: select ... for
-- update every row before mutating anything, in a stable lock order (sell
-- listing -> its source inventory -> buy order -> buyer's destination
-- inventory -> funds rows), so no trade ever completes against stale data.
--
-- Money movement for buy orders reuses the existing ledgers exactly as
-- execute_market_purchase does. "Escrow" is not a separate account: it is a
-- single debit for the buyer's worst-case remaining commitment
-- (quantity * max_unit_price), recorded once a creation-time sweep has
-- already paid real (lower-or-equal) prices for whatever it could fill.
-- Every later fill against a resting buy order settles at exactly
-- max_unit_price (see 085's match_type vocabulary), so a fill's cost is
-- always an exact slice of what's already escrowed and cancellation refunds
-- exactly quantity * max_unit_price with no partial-refund reconciliation.
--
-- _settle_buy_order_fill is the shared core (credit buyer inventory, credit
-- seller net of the 3% fee, decrement the order, log the trade) used by both
-- sweep_buy_orders_for_new_listing and fulfill_market_buy_order — the two
-- paths that always settle at max_unit_price. place_market_buy_order's own
-- creation-time sweep pays each listing's own (lower-or-equal) price instead,
-- so it stays close to execute_market_purchase's existing per-listing logic
-- rather than going through the shared helper.

-- ---------------------------------------------------------------------------
-- Private helper: settle one fill of a buy order at its max_unit_price.
-- Caller must already hold `for update` locks on p_buy_order and on whatever
-- seller inventory row it just relieved. Not exposed to authenticated/anon —
-- only callable from other security definer functions owned by the same
-- role, mirroring the append_personal_transaction / append_business_account_entry
-- restriction pattern from 072_critical_security_hardening.sql.
-- ---------------------------------------------------------------------------

create or replace function public._settle_buy_order_fill(
  p_buy_order           public.market_buy_orders,
  p_fill_quantity       integer,
  p_item_quality        integer,
  p_seller_player_id    uuid,
  p_seller_source_type  text,
  p_seller_business_id  uuid,
  p_seller_unit_cost    numeric,
  p_listing_id          uuid,
  p_match_type          text
)
returns public.market_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now                    timestamptz := now();
  v_fee_rate                constant numeric := 0.03; -- keep in sync with MARKET_TRANSACTION_FEE in shared/economy.ts
  v_gross                   numeric(14, 2);
  v_fee                     numeric(14, 2);
  v_net                     numeric(14, 2);
  v_target_business_inv     public.business_inventory%rowtype;
  v_target_personal_inv     public.personal_inventory%rowtype;
  v_existing_qty            numeric;
  v_existing_total_cost     numeric;
  v_next_total_cost         numeric;
  v_next_unit_cost          numeric;
  v_next_order_qty          integer;
  v_next_order_status       text;
  v_seller_business_name    text;
  v_buyer_business_name     text;
  v_seller_checking_account_id uuid;
  v_sold_inventory_cost     numeric;
  v_tx                      public.market_transactions%rowtype;
begin
  v_gross := round((p_buy_order.max_unit_price * p_fill_quantity)::numeric, 2);
  v_fee   := round((v_gross * v_fee_rate)::numeric, 2);
  v_net   := round((v_gross - v_fee)::numeric, 2);

  -- Credit buyer's destination inventory.
  if p_buy_order.purchaser_type = 'business' then
    select * into v_target_business_inv
    from public.business_inventory
    where owner_player_id = p_buy_order.owner_player_id
      and business_id = p_buy_order.purchaser_business_id
      and item_key = p_buy_order.item_key
      and quality = p_item_quality
    for update;

    if not found then
      insert into public.business_inventory (
        owner_player_id, business_id, city_id, item_key, quality,
        quantity, reserved_quantity, unit_cost, total_cost
      ) values (
        p_buy_order.owner_player_id, p_buy_order.purchaser_business_id, p_buy_order.city_id,
        p_buy_order.item_key, p_item_quality, p_fill_quantity, 0,
        p_buy_order.max_unit_price, round((p_fill_quantity * p_buy_order.max_unit_price)::numeric, 2)
      );
    else
      v_existing_qty := greatest(0, v_target_business_inv.quantity);
      v_existing_total_cost := case
        when v_target_business_inv.total_cost is null
          then v_existing_qty * coalesce(v_target_business_inv.unit_cost, 0)
        else v_target_business_inv.total_cost
      end;
      v_next_total_cost := round((v_existing_total_cost + p_fill_quantity * p_buy_order.max_unit_price)::numeric, 2);
      v_next_unit_cost := case
        when (v_existing_qty + p_fill_quantity) > 0
          then round((v_next_total_cost / (v_existing_qty + p_fill_quantity))::numeric, 2)
        else 0
      end;

      update public.business_inventory
      set quantity = v_target_business_inv.quantity + p_fill_quantity,
          unit_cost = v_next_unit_cost,
          total_cost = v_next_total_cost,
          updated_at = v_now
      where id = v_target_business_inv.id;
    end if;

    select name into v_buyer_business_name from public.businesses where id = p_buy_order.purchaser_business_id;
  else
    select * into v_target_personal_inv
    from public.personal_inventory
    where player_id = p_buy_order.owner_player_id
      and item_key = p_buy_order.item_key
      and quality = p_item_quality
    for update;

    if not found then
      insert into public.personal_inventory (player_id, item_key, quality, quantity)
      values (p_buy_order.owner_player_id, p_buy_order.item_key, p_item_quality, p_fill_quantity);
    else
      update public.personal_inventory
      set quantity = v_target_personal_inv.quantity + p_fill_quantity,
          updated_at = v_now
      where id = v_target_personal_inv.id;
    end if;

    v_buyer_business_name := 'Personal Inventory';
  end if;

  -- Credit seller, net of the market fee.
  if p_seller_source_type = 'business' then
    insert into public.business_accounts (business_id, amount, entry_type, category, reference_id, description)
    values (
      p_seller_business_id, v_gross, 'credit', 'market_sale', p_buy_order.id,
      'Buy order fill: ' || p_fill_quantity::text || 'x ' || p_buy_order.item_key
    );

    if v_fee > 0 then
      insert into public.business_accounts (business_id, amount, entry_type, category, reference_id, description)
      values (
        p_seller_business_id, v_fee, 'debit', 'market_fee', p_buy_order.id,
        'Market fee: ' || p_fill_quantity::text || 'x ' || p_buy_order.item_key
      );
    end if;

    select name into v_seller_business_name from public.businesses where id = p_seller_business_id;
  else
    select ba.id into v_seller_checking_account_id
    from public.bank_accounts ba
    where ba.player_id = p_seller_player_id and ba.account_type = 'checking'
    limit 1;

    if v_seller_checking_account_id is null then
      raise exception 'Seller checking account not found.';
    end if;

    insert into public.transactions (account_id, amount, direction, transaction_type, reference_id, description)
    values (
      v_seller_checking_account_id, v_net, 'credit', 'market_sale', p_buy_order.id,
      'Buy order fill: ' || p_fill_quantity::text || 'x ' || p_buy_order.item_key
    );

    v_seller_business_name := 'Personal Inventory';
  end if;

  -- Decrement the buy order.
  v_next_order_qty := p_buy_order.quantity - p_fill_quantity;
  v_next_order_status := case when v_next_order_qty <= 0 then 'filled' else 'active' end;

  update public.market_buy_orders
  set quantity = greatest(0, v_next_order_qty),
      status = v_next_order_status,
      filled_at = case when v_next_order_status = 'filled' then v_now else null end,
      updated_at = v_now
  where id = p_buy_order.id;

  insert into public.market_transactions (
    listing_id, seller_player_id, buyer_player_id, buyer_type, seller_source_type,
    seller_business_id, seller_business_name, buyer_business_id, buyer_business_name,
    city_id, item_key, quality, quantity, unit_price, gross_total, market_fee, net_total,
    buy_order_id, match_type
  ) values (
    p_listing_id, p_seller_player_id, p_buy_order.owner_player_id, 'player', p_seller_source_type,
    p_seller_business_id, coalesce(v_seller_business_name, 'Unknown Seller'),
    p_buy_order.purchaser_business_id, coalesce(v_buyer_business_name, 'Unknown Business'),
    p_buy_order.city_id, p_buy_order.item_key, p_item_quality, p_fill_quantity, p_buy_order.max_unit_price,
    v_gross, v_fee, v_net, p_buy_order.id, p_match_type
  ) returning * into v_tx;

  -- Finance-dashboard bookkeeping, inserted directly (same pattern as
  -- settle_market_listing_npc_sale_atomic) rather than round-tripping through
  -- the TS insertBusinessFinancialEvents helper, since this settlement can
  -- touch inventory rows the caller never previewed.
  if p_buy_order.purchaser_type = 'business' then
    insert into public.business_financial_events (business_id, account_code, amount, quantity, item_key, reference_type, reference_id, description, metadata)
    values (
      p_buy_order.purchaser_business_id, 'inventory', v_gross, p_fill_quantity, p_buy_order.item_key, 'market_transaction', v_tx.id,
      'Inventory acquired via buy order: ' || p_fill_quantity::text || 'x ' || p_buy_order.item_key,
      jsonb_build_object('buyerType', 'player')
    );
  end if;

  if p_seller_source_type = 'business' then
    v_sold_inventory_cost := round(greatest(0, coalesce(p_seller_unit_cost, 0) * p_fill_quantity)::numeric, 2);

    insert into public.business_financial_events (business_id, account_code, amount, quantity, item_key, reference_type, reference_id, description, metadata)
    values
      (
        p_seller_business_id, 'revenue', v_gross, p_fill_quantity, p_buy_order.item_key, 'market_transaction', v_tx.id,
        'Buy order fill revenue: ' || p_fill_quantity::text || 'x ' || p_buy_order.item_key,
        jsonb_build_object('buyerType', 'player')
      ),
      (
        p_seller_business_id, 'cogs', v_sold_inventory_cost, p_fill_quantity, p_buy_order.item_key, 'market_transaction', v_tx.id,
        'Buy order fill COGS: ' || p_fill_quantity::text || 'x ' || p_buy_order.item_key,
        jsonb_build_object('unitCost', coalesce(p_seller_unit_cost, 0))
      ),
      (
        p_seller_business_id, 'inventory', v_sold_inventory_cost, p_fill_quantity, p_buy_order.item_key, 'market_transaction', v_tx.id,
        'Inventory relieved on buy order fill: ' || p_fill_quantity::text || 'x ' || p_buy_order.item_key,
        jsonb_build_object('direction', 'out', 'unitCost', coalesce(p_seller_unit_cost, 0))
      );

    if v_fee > 0 then
      insert into public.business_financial_events (business_id, account_code, amount, quantity, item_key, reference_type, reference_id, description)
      values (
        p_seller_business_id, 'operating_expense', v_fee, p_fill_quantity, p_buy_order.item_key, 'market_transaction', v_tx.id,
        'Market fee expense: ' || p_fill_quantity::text || 'x ' || p_buy_order.item_key
      );
    end if;
  end if;

  return v_tx;
end;
$$;

revoke execute on function public._settle_buy_order_fill(
  public.market_buy_orders, integer, integer, uuid, text, uuid, numeric, uuid, text
) from public;

-- ---------------------------------------------------------------------------
-- place_market_buy_order: create the order, then immediately sweep active
-- sell listings that already satisfy it (paying each listing's own price),
-- escrowing only the worst-case remainder.
-- ---------------------------------------------------------------------------

create or replace function public.place_market_buy_order(
  p_purchaser_type       text,
  p_purchaser_business_id uuid,
  p_city_id              uuid,
  p_item_key             text,
  p_quality_min          integer,
  p_quality_max          integer,
  p_quantity             integer,
  p_max_unit_price       numeric,
  p_expires_at           timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_player_id       uuid := auth.uid();
  v_purchaser_business    public.businesses%rowtype;
  v_city_id               uuid;
  v_checking_account_id   uuid;
  v_balance                numeric;
  v_worst_case             numeric(14, 2);
  v_order                  public.market_buy_orders%rowtype;
  v_listing                public.market_listings%rowtype;
  v_source_inventory       public.business_inventory%rowtype;
  v_source_personal_inv    public.personal_inventory%rowtype;
  v_target_business_inv    public.business_inventory%rowtype;
  v_target_personal_inv    public.personal_inventory%rowtype;
  v_existing_qty           numeric;
  v_existing_total_cost    numeric;
  v_next_total_cost        numeric;
  v_next_unit_cost         numeric;
  v_remaining              integer;
  v_fill_qty               integer;
  v_gross                  numeric(14, 2);
  v_fee                    numeric(14, 2);
  v_net                    numeric(14, 2);
  v_fee_rate               constant numeric := 0.03;
  v_seller_business_name   text;
  v_buyer_business_name    text;
  v_seller_checking_account_id uuid;
  v_seller_unit_cost       numeric;
  v_sold_inventory_cost    numeric;
  v_tx_id                  uuid;
  v_now                    timestamptz := now();
begin
  if v_buyer_player_id is null then
    raise exception 'Unauthorized.';
  end if;

  if p_purchaser_type not in ('business', 'personal') then
    raise exception 'Purchaser type must be business or personal.';
  end if;

  if p_quantity is null or p_quantity < 1 then
    raise exception 'Quantity must be at least 1.';
  end if;

  if p_max_unit_price is null or p_max_unit_price <= 0 then
    raise exception 'Max unit price must be greater than 0.';
  end if;

  if p_quality_min is null or p_quality_max is null or p_quality_min < 1 or p_quality_max > 100 or p_quality_max < p_quality_min then
    raise exception 'Quality range is invalid.';
  end if;

  v_worst_case := round((p_quantity * p_max_unit_price)::numeric, 2);

  -- Lock the buyer's funds source and require it can cover the full
  -- worst-case commitment before anything else happens, so the order can
  -- never end up under-collateralized mid-life.
  if p_purchaser_type = 'business' then
    if p_purchaser_business_id is null then
      raise exception 'Purchaser business id is required.';
    end if;

    select * into v_purchaser_business from public.businesses where id = p_purchaser_business_id for update;
    if not found or v_purchaser_business.player_id <> v_buyer_player_id then
      raise exception 'Business not found.';
    end if;

    -- City is always the business's own city, never a client-supplied value —
    -- p_city_id is only trusted for personal purchasers below.
    v_city_id := v_purchaser_business.city_id;

    select public.get_business_account_balance(p_purchaser_business_id) into v_balance;
    if coalesce(v_balance, 0) < v_worst_case then
      raise exception 'Insufficient business funds to place this buy order.';
    end if;
  else
    v_city_id := p_city_id;

    select ba.id into v_checking_account_id
    from public.bank_accounts ba
    where ba.player_id = v_buyer_player_id and ba.account_type = 'checking'
    limit 1;
    if v_checking_account_id is null then
      raise exception 'Checking account not found.';
    end if;

    perform 1 from public.bank_accounts where id = v_checking_account_id for update;

    select public.get_bank_account_balance(v_checking_account_id) into v_balance;
    if coalesce(v_balance, 0) < v_worst_case then
      raise exception 'Insufficient personal funds to place this buy order.';
    end if;
  end if;

  if v_city_id is null then
    raise exception 'City id is required.';
  end if;

  insert into public.market_buy_orders (
    owner_player_id, purchaser_type, purchaser_business_id, city_id, item_key,
    quality_min, quality_max, quantity, max_unit_price, status, expires_at
  ) values (
    v_buyer_player_id, p_purchaser_type, p_purchaser_business_id, v_city_id, p_item_key,
    p_quality_min, p_quality_max, p_quantity, p_max_unit_price, 'active', p_expires_at
  ) returning * into v_order;

  v_remaining := p_quantity;
  v_buyer_business_name := case when p_purchaser_type = 'business' then v_purchaser_business.name else 'Personal Inventory' end;

  for v_listing in
    select * from public.market_listings
    where city_id = v_city_id
      and item_key = p_item_key
      and status = 'active'
      and quality between p_quality_min and p_quality_max
      and unit_price <= p_max_unit_price
      and owner_player_id <> v_buyer_player_id
    order by unit_price asc, created_at asc
    for update skip locked
  loop
    exit when v_remaining <= 0;

    v_fill_qty := least(v_listing.quantity, v_remaining);
    v_seller_unit_cost := 0;

    -- Relieve the seller's source inventory (mirrors execute_market_purchase).
    if v_listing.source_type = 'business' and v_listing.source_inventory_id is not null then
      select * into v_source_inventory from public.business_inventory where id = v_listing.source_inventory_id for update;
      if not found or v_source_inventory.quantity < v_fill_qty or v_source_inventory.reserved_quantity < v_fill_qty then
        continue; -- listing's backing inventory no longer supports this fill; skip it
      end if;

      v_seller_unit_cost := case
        when v_source_inventory.total_cost is not null and v_source_inventory.quantity > 0
          then round((v_source_inventory.total_cost / v_source_inventory.quantity)::numeric, 2)
        else coalesce(v_source_inventory.unit_cost, 0)
      end;

      if (v_source_inventory.quantity - v_fill_qty) <= 0 then
        delete from public.business_inventory where id = v_source_inventory.id;
      else
        update public.business_inventory
        set quantity = v_source_inventory.quantity - v_fill_qty,
            reserved_quantity = greatest(0, least(v_source_inventory.quantity - v_fill_qty, v_source_inventory.reserved_quantity - v_fill_qty)),
            total_cost = case when v_source_inventory.total_cost is not null
              then round(greatest(0, v_source_inventory.total_cost - v_seller_unit_cost * v_fill_qty)::numeric, 2)
              else null
            end,
            updated_at = v_now
        where id = v_source_inventory.id;
      end if;
    elsif v_listing.source_type = 'personal' then
      select * into v_source_personal_inv
      from public.personal_inventory
      where player_id = v_listing.owner_player_id and item_key = v_listing.item_key and quality = v_listing.quality
      for update;
      if not found or v_source_personal_inv.quantity < v_fill_qty then
        continue;
      end if;

      if (v_source_personal_inv.quantity - v_fill_qty) <= 0 then
        delete from public.personal_inventory where id = v_source_personal_inv.id;
      else
        update public.personal_inventory
        set quantity = v_source_personal_inv.quantity - v_fill_qty, updated_at = v_now
        where id = v_source_personal_inv.id;
      end if;
    end if;

    -- Decrement the listing.
    update public.market_listings
    set quantity = greatest(0, v_listing.quantity - v_fill_qty),
        reserved_quantity = greatest(0, v_listing.reserved_quantity - v_fill_qty),
        status = case when (v_listing.quantity - v_fill_qty) <= 0 then 'filled' else 'active' end,
        filled_at = case when (v_listing.quantity - v_fill_qty) <= 0 then v_now else null end,
        updated_at = v_now
    where id = v_listing.id;

    -- Credit buyer's destination inventory at the listing's real price.
    if p_purchaser_type = 'business' then
      select * into v_target_business_inv
      from public.business_inventory
      where owner_player_id = v_buyer_player_id
        and business_id = p_purchaser_business_id
        and item_key = v_listing.item_key
        and quality = v_listing.quality
      for update;

      if not found then
        insert into public.business_inventory (
          owner_player_id, business_id, city_id, item_key, quality, quantity, reserved_quantity, unit_cost, total_cost
        ) values (
          v_buyer_player_id, p_purchaser_business_id, v_purchaser_business.city_id, v_listing.item_key, v_listing.quality,
          v_fill_qty, 0, v_listing.unit_price, round((v_fill_qty * v_listing.unit_price)::numeric, 2)
        );
      else
        v_existing_qty := greatest(0, v_target_business_inv.quantity);
        v_existing_total_cost := case
          when v_target_business_inv.total_cost is null then v_existing_qty * coalesce(v_target_business_inv.unit_cost, 0)
          else v_target_business_inv.total_cost
        end;
        v_next_total_cost := round((v_existing_total_cost + v_fill_qty * v_listing.unit_price)::numeric, 2);
        v_next_unit_cost := case when (v_existing_qty + v_fill_qty) > 0 then round((v_next_total_cost / (v_existing_qty + v_fill_qty))::numeric, 2) else 0 end;

        update public.business_inventory
        set quantity = v_target_business_inv.quantity + v_fill_qty, unit_cost = v_next_unit_cost, total_cost = v_next_total_cost, updated_at = v_now
        where id = v_target_business_inv.id;
      end if;
    else
      select * into v_target_personal_inv
      from public.personal_inventory
      where player_id = v_buyer_player_id and item_key = v_listing.item_key and quality = v_listing.quality
      for update;

      if not found then
        insert into public.personal_inventory (player_id, item_key, quality, quantity)
        values (v_buyer_player_id, v_listing.item_key, v_listing.quality, v_fill_qty);
      else
        update public.personal_inventory
        set quantity = v_target_personal_inv.quantity + v_fill_qty, updated_at = v_now
        where id = v_target_personal_inv.id;
      end if;
    end if;

    -- Real money movement for this fill (paid at the listing's own price).
    v_gross := round((v_listing.unit_price * v_fill_qty)::numeric, 2);
    v_fee := round((v_gross * v_fee_rate)::numeric, 2);
    v_net := round((v_gross - v_fee)::numeric, 2);
    v_seller_business_name := case when v_listing.source_type = 'personal' then 'Personal Inventory' else null end;
    if v_listing.source_business_id is not null then
      select name into v_seller_business_name from public.businesses where id = v_listing.source_business_id;
    end if;

    if p_purchaser_type = 'business' then
      insert into public.business_accounts (business_id, amount, entry_type, category, reference_id, description)
      values (p_purchaser_business_id, v_gross, 'debit', 'market_purchase', v_listing.id, 'Buy order sweep: ' || v_fill_qty::text || 'x ' || v_listing.item_key);
    else
      insert into public.transactions (account_id, amount, direction, transaction_type, reference_id, description)
      values (v_checking_account_id, v_gross, 'debit', 'market_purchase', v_listing.id, 'Buy order sweep: ' || v_fill_qty::text || 'x ' || v_listing.item_key);
    end if;

    if v_listing.source_type = 'business' and v_listing.source_business_id is not null then
      insert into public.business_accounts (business_id, amount, entry_type, category, reference_id, description)
      values (v_listing.source_business_id, v_gross, 'credit', 'market_sale', v_listing.id, 'PLAYER market sale: ' || v_fill_qty::text || 'x ' || v_listing.item_key);
      if v_fee > 0 then
        insert into public.business_accounts (business_id, amount, entry_type, category, reference_id, description)
        values (v_listing.source_business_id, v_fee, 'debit', 'market_fee', v_listing.id, 'Market fee: ' || v_fill_qty::text || 'x ' || v_listing.item_key);
      end if;
    else
      select ba.id into v_seller_checking_account_id from public.bank_accounts ba
      where ba.player_id = v_listing.owner_player_id and ba.account_type = 'checking' limit 1;
      if v_seller_checking_account_id is null then
        raise exception 'Seller checking account not found.';
      end if;
      insert into public.transactions (account_id, amount, direction, transaction_type, reference_id, description)
      values (v_seller_checking_account_id, v_net, 'credit', 'market_sale', v_listing.id, 'Market sale: ' || v_fill_qty::text || 'x ' || v_listing.item_key);
    end if;

    insert into public.market_transactions (
      listing_id, seller_player_id, buyer_player_id, buyer_type, seller_source_type,
      seller_business_id, seller_business_name, buyer_business_id, buyer_business_name,
      city_id, item_key, quality, quantity, unit_price, gross_total, market_fee, net_total,
      buy_order_id, match_type
    ) values (
      v_listing.id, v_listing.owner_player_id, v_buyer_player_id, 'player', v_listing.source_type,
      v_listing.source_business_id, coalesce(v_seller_business_name, 'Unknown Seller'),
      p_purchaser_business_id, coalesce(v_buyer_business_name, 'Unknown Business'),
      v_listing.city_id, v_listing.item_key, v_listing.quality, v_fill_qty, v_listing.unit_price,
      v_gross, v_fee, v_net, v_order.id, 'buy_order_sweep'
    )
    returning id into v_tx_id;

    -- Finance-dashboard bookkeeping (same direct-insert pattern as
    -- settle_market_listing_npc_sale_atomic — see _settle_buy_order_fill above
    -- for why this isn't round-tripped through TS).
    if p_purchaser_type = 'business' then
      insert into public.business_financial_events (business_id, account_code, amount, quantity, item_key, reference_type, reference_id, description, metadata)
      values (
        p_purchaser_business_id, 'inventory', v_gross, v_fill_qty, v_listing.item_key, 'market_transaction', v_tx_id,
        'Inventory acquired via buy order sweep: ' || v_fill_qty::text || 'x ' || v_listing.item_key,
        jsonb_build_object('buyerType', 'player')
      );
    end if;

    if v_listing.source_type = 'business' and v_listing.source_business_id is not null then
      v_sold_inventory_cost := round(greatest(0, v_seller_unit_cost * v_fill_qty)::numeric, 2);

      insert into public.business_financial_events (business_id, account_code, amount, quantity, item_key, reference_type, reference_id, description, metadata)
      values
        (
          v_listing.source_business_id, 'revenue', v_gross, v_fill_qty, v_listing.item_key, 'market_transaction', v_tx_id,
          'Player market sale revenue: ' || v_fill_qty::text || 'x ' || v_listing.item_key,
          jsonb_build_object('buyerType', 'player')
        ),
        (
          v_listing.source_business_id, 'cogs', v_sold_inventory_cost, v_fill_qty, v_listing.item_key, 'market_transaction', v_tx_id,
          'COGS on player market sale: ' || v_fill_qty::text || 'x ' || v_listing.item_key,
          jsonb_build_object('unitCost', v_seller_unit_cost)
        ),
        (
          v_listing.source_business_id, 'inventory', v_sold_inventory_cost, v_fill_qty, v_listing.item_key, 'market_transaction', v_tx_id,
          'Inventory relieved on player market sale: ' || v_fill_qty::text || 'x ' || v_listing.item_key,
          jsonb_build_object('direction', 'out', 'unitCost', v_seller_unit_cost)
        );

      if v_fee > 0 then
        insert into public.business_financial_events (business_id, account_code, amount, quantity, item_key, reference_type, reference_id, description)
        values (
          v_listing.source_business_id, 'operating_expense', v_fee, v_fill_qty, v_listing.item_key, 'market_transaction', v_tx_id,
          'Market fee expense: ' || v_fill_qty::text || 'x ' || v_listing.item_key
        );
      end if;
    end if;

    v_remaining := v_remaining - v_fill_qty;
  end loop;

  -- Escrow the worst-case cost of whatever is still unmatched.
  if v_remaining > 0 then
    if p_purchaser_type = 'business' then
      insert into public.business_accounts (business_id, amount, entry_type, category, reference_id, description)
      values (p_purchaser_business_id, round((v_remaining * p_max_unit_price)::numeric, 2), 'debit', 'buy_order_escrow', v_order.id, 'Buy order escrow: ' || v_remaining::text || 'x ' || p_item_key);
    else
      insert into public.transactions (account_id, amount, direction, transaction_type, reference_id, description)
      values (v_checking_account_id, round((v_remaining * p_max_unit_price)::numeric, 2), 'debit', 'buy_order_escrow', v_order.id, 'Buy order escrow: ' || v_remaining::text || 'x ' || p_item_key);
    end if;
  end if;

  update public.market_buy_orders
  set quantity = v_remaining,
      status = case when v_remaining <= 0 then 'filled' else 'active' end,
      filled_at = case when v_remaining <= 0 then v_now else null end,
      updated_at = v_now
  where id = v_order.id
  returning * into v_order;

  return jsonb_build_object('buyOrder', to_jsonb(v_order));
end;
$$;

grant execute on function public.place_market_buy_order(text, uuid, uuid, text, integer, integer, integer, numeric, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- sweep_buy_orders_for_new_listing: called right after a sell listing is
-- inserted. Matches it against existing active buy orders, best price first,
-- settling each fill at the buy order's max_unit_price via the shared helper.
-- ---------------------------------------------------------------------------

create or replace function public.sweep_buy_orders_for_new_listing(p_listing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing            public.market_listings%rowtype;
  v_order              public.market_buy_orders%rowtype;
  v_source_inventory   public.business_inventory%rowtype;
  v_source_personal_inv public.personal_inventory%rowtype;
  v_remaining          integer;
  v_fill_qty           integer;
  v_seller_unit_cost    numeric;
  v_now                timestamptz := now();
  v_filled_count        integer := 0;
begin
  select * into v_listing from public.market_listings where id = p_listing_id for update;
  if not found or v_listing.status <> 'active' then
    return jsonb_build_object('fills', 0);
  end if;

  v_remaining := v_listing.quantity;

  for v_order in
    select * from public.market_buy_orders
    where city_id = v_listing.city_id
      and item_key = v_listing.item_key
      and status = 'active'
      and v_listing.quality between quality_min and quality_max
      and max_unit_price >= v_listing.unit_price
      and owner_player_id <> v_listing.owner_player_id
    order by max_unit_price desc, created_at asc
    for update skip locked
  loop
    exit when v_remaining <= 0;

    v_fill_qty := least(v_order.quantity, v_remaining);
    v_seller_unit_cost := 0;

    if v_listing.source_type = 'business' and v_listing.source_inventory_id is not null then
      select * into v_source_inventory from public.business_inventory where id = v_listing.source_inventory_id for update;
      if not found or v_source_inventory.quantity < v_fill_qty or v_source_inventory.reserved_quantity < v_fill_qty then
        continue;
      end if;

      v_seller_unit_cost := case
        when v_source_inventory.total_cost is not null and v_source_inventory.quantity > 0
          then round((v_source_inventory.total_cost / v_source_inventory.quantity)::numeric, 2)
        else coalesce(v_source_inventory.unit_cost, 0)
      end;

      if (v_source_inventory.quantity - v_fill_qty) <= 0 then
        delete from public.business_inventory where id = v_source_inventory.id;
      else
        update public.business_inventory
        set quantity = v_source_inventory.quantity - v_fill_qty,
            reserved_quantity = greatest(0, least(v_source_inventory.quantity - v_fill_qty, v_source_inventory.reserved_quantity - v_fill_qty)),
            total_cost = case when v_source_inventory.total_cost is not null
              then round(greatest(0, v_source_inventory.total_cost - v_seller_unit_cost * v_fill_qty)::numeric, 2)
              else null
            end,
            updated_at = v_now
        where id = v_source_inventory.id;
      end if;
    elsif v_listing.source_type = 'personal' then
      select * into v_source_personal_inv
      from public.personal_inventory
      where player_id = v_listing.owner_player_id and item_key = v_listing.item_key and quality = v_listing.quality
      for update;
      if not found or v_source_personal_inv.quantity < v_fill_qty then
        continue;
      end if;

      if (v_source_personal_inv.quantity - v_fill_qty) <= 0 then
        delete from public.personal_inventory where id = v_source_personal_inv.id;
      else
        update public.personal_inventory
        set quantity = v_source_personal_inv.quantity - v_fill_qty, updated_at = v_now
        where id = v_source_personal_inv.id;
      end if;
    end if;

    perform public._settle_buy_order_fill(
      v_order, v_fill_qty, v_listing.quality, v_listing.owner_player_id, v_listing.source_type,
      v_listing.source_business_id, v_seller_unit_cost, v_listing.id, 'sell_listing_sweep'
    );

    v_remaining := v_remaining - v_fill_qty;
    v_filled_count := v_filled_count + 1;
  end loop;

  update public.market_listings
  set quantity = v_remaining,
      reserved_quantity = least(reserved_quantity, v_remaining),
      status = case when v_remaining <= 0 then 'filled' else 'active' end,
      filled_at = case when v_remaining <= 0 then v_now else null end,
      updated_at = v_now
  where id = v_listing.id;

  return jsonb_build_object('fills', v_filled_count);
end;
$$;

grant execute on function public.sweep_buy_orders_for_new_listing(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- fulfill_market_buy_order: seller-initiated direct trade against one chosen
-- buy order, settling at max_unit_price via the shared helper. No listing is
-- created or consulted.
-- ---------------------------------------------------------------------------

create or replace function public.fulfill_market_buy_order(
  p_buy_order_id                  uuid,
  p_quantity                      integer,
  p_source_type                   text,
  p_source_business_id            uuid,
  p_source_business_inventory_id  uuid,
  p_source_personal_inventory_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller_player_id  uuid := auth.uid();
  v_order             public.market_buy_orders%rowtype;
  v_business_inv      public.business_inventory%rowtype;
  v_personal_inv      public.personal_inventory%rowtype;
  v_item_quality       integer;
  v_seller_unit_cost    numeric := 0;
  v_tx                public.market_transactions%rowtype;
begin
  if v_seller_player_id is null then
    raise exception 'Unauthorized.';
  end if;

  if p_quantity is null or p_quantity < 1 then
    raise exception 'Quantity must be at least 1.';
  end if;

  if p_source_type not in ('business', 'personal') then
    raise exception 'Source type must be business or personal.';
  end if;

  select * into v_order from public.market_buy_orders where id = p_buy_order_id for update;
  if not found then
    raise exception 'Buy order not found.';
  end if;
  if v_order.status <> 'active' then
    raise exception 'Buy order is not active.';
  end if;
  if v_order.owner_player_id = v_seller_player_id then
    raise exception 'Cannot fulfill your own buy order.';
  end if;
  if p_quantity > v_order.quantity then
    raise exception 'Requested quantity exceeds buy order remaining amount.';
  end if;

  if p_source_type = 'business' then
    if p_source_business_id is null or p_source_business_inventory_id is null then
      raise exception 'Source business inventory is required.';
    end if;

    if not exists (select 1 from public.businesses where id = p_source_business_id and player_id = v_seller_player_id) then
      raise exception 'Business not found.';
    end if;

    select * into v_business_inv from public.business_inventory where id = p_source_business_inventory_id for update;
    if not found or v_business_inv.business_id <> p_source_business_id or v_business_inv.owner_player_id <> v_seller_player_id then
      raise exception 'Source inventory not found.';
    end if;
    if v_business_inv.item_key <> v_order.item_key or v_business_inv.quality < v_order.quality_min or v_business_inv.quality > v_order.quality_max then
      raise exception 'Source inventory does not match the buy order''s item and quality range.';
    end if;
    if (v_business_inv.quantity - v_business_inv.reserved_quantity) < p_quantity then
      raise exception 'Not enough available (unreserved) inventory to fulfill this quantity.';
    end if;

    v_item_quality := v_business_inv.quality;
    v_seller_unit_cost := case
      when v_business_inv.total_cost is not null and v_business_inv.quantity > 0
        then round((v_business_inv.total_cost / v_business_inv.quantity)::numeric, 2)
      else coalesce(v_business_inv.unit_cost, 0)
    end;

    if (v_business_inv.quantity - p_quantity) <= 0 then
      delete from public.business_inventory where id = v_business_inv.id;
    else
      update public.business_inventory
      set quantity = v_business_inv.quantity - p_quantity,
          total_cost = case when v_business_inv.total_cost is not null
            then round(greatest(0, v_business_inv.total_cost - v_seller_unit_cost * p_quantity)::numeric, 2)
            else null
          end,
          updated_at = now()
      where id = v_business_inv.id;
    end if;
  else
    if p_source_personal_inventory_id is null then
      raise exception 'Source personal inventory id is required.';
    end if;

    select * into v_personal_inv from public.personal_inventory where id = p_source_personal_inventory_id for update;
    if not found or v_personal_inv.player_id <> v_seller_player_id then
      raise exception 'Source inventory not found.';
    end if;
    if v_personal_inv.item_key <> v_order.item_key or v_personal_inv.quality < v_order.quality_min or v_personal_inv.quality > v_order.quality_max then
      raise exception 'Source inventory does not match the buy order''s item and quality range.';
    end if;
    if v_personal_inv.quantity < p_quantity then
      raise exception 'Not enough personal inventory to fulfill this quantity.';
    end if;

    v_item_quality := v_personal_inv.quality;

    if (v_personal_inv.quantity - p_quantity) <= 0 then
      delete from public.personal_inventory where id = v_personal_inv.id;
    else
      update public.personal_inventory
      set quantity = v_personal_inv.quantity - p_quantity, updated_at = now()
      where id = v_personal_inv.id;
    end if;
  end if;

  v_tx := public._settle_buy_order_fill(
    v_order, p_quantity, v_item_quality, v_seller_player_id, p_source_type,
    p_source_business_id, v_seller_unit_cost, null, 'direct_fulfillment'
  );

  select * into v_order from public.market_buy_orders where id = p_buy_order_id;

  return jsonb_build_object('buyOrder', to_jsonb(v_order), 'transaction', to_jsonb(v_tx));
end;
$$;

grant execute on function public.fulfill_market_buy_order(uuid, integer, text, uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- cancel_market_buy_order: refund the escrowed remainder and close the order.
-- ---------------------------------------------------------------------------

create or replace function public.cancel_market_buy_order(p_buy_order_id uuid)
returns public.market_buy_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id            uuid := auth.uid();
  v_order                public.market_buy_orders%rowtype;
  v_refund               numeric(14, 2);
  v_checking_account_id  uuid;
  v_now                  timestamptz := now();
begin
  if v_player_id is null then
    raise exception 'Unauthorized.';
  end if;

  select * into v_order
  from public.market_buy_orders
  where id = p_buy_order_id and owner_player_id = v_player_id
  for update;

  if not found then
    raise exception 'Buy order not found.';
  end if;
  if v_order.status <> 'active' then
    raise exception 'Only active buy orders can be cancelled.';
  end if;

  v_refund := round((v_order.quantity * v_order.max_unit_price)::numeric, 2);

  if v_refund > 0 then
    if v_order.purchaser_type = 'business' then
      insert into public.business_accounts (business_id, amount, entry_type, category, reference_id, description)
      values (v_order.purchaser_business_id, v_refund, 'credit', 'buy_order_release', v_order.id, 'Buy order cancelled: refund for ' || v_order.quantity::text || 'x ' || v_order.item_key);
    else
      select ba.id into v_checking_account_id
      from public.bank_accounts ba
      where ba.player_id = v_player_id and ba.account_type = 'checking'
      limit 1;
      if v_checking_account_id is null then
        raise exception 'Checking account not found.';
      end if;

      insert into public.transactions (account_id, amount, direction, transaction_type, reference_id, description)
      values (v_checking_account_id, v_refund, 'credit', 'buy_order_release', v_order.id, 'Buy order cancelled: refund for ' || v_order.quantity::text || 'x ' || v_order.item_key);
    end if;
  end if;

  update public.market_buy_orders
  set status = 'cancelled', cancelled_at = v_now, updated_at = v_now
  where id = v_order.id
  returning * into v_order;

  return v_order;
end;
$$;

grant execute on function public.cancel_market_buy_order(uuid) to authenticated;

-- Migration complete: buy-order placement, sweep, direct fulfillment, and cancellation RPCs
