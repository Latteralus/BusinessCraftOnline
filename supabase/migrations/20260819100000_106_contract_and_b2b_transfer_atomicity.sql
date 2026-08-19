-- AccountingFixPlan Phase E: storefront/market/contracts/B2B.
--
-- Storefront sales (settle_store_inventory_sale(s)_atomic), open-market
-- sales (execute_market_purchase), NPC sales (settle_market_listing_npc_sale_atomic),
-- and buy-order fulfillment (_settle_buy_order_fill, called by both
-- place_market_buy_order's own sweep and sweep_buy_orders_for_new_listing /
-- fulfill_market_buy_order) were all already audited and found correct per
-- item 43 -- each is a single atomic RPC that both relieves inventory cost
-- and writes revenue/COGS/fee business_financial_events. Per the plan's own
-- instruction ("verify that storefront logic already doing this correctly
-- is preserved rather than rewritten unnecessarily"), none of those are
-- touched here. The two real gaps this migration closes:
--
-- 1. Item 44 (B2B): execute_inventory_transfer's SOURCE-side cost relief was
--    already atomic (Phase C), but the DESTINATION-side weighted-average
--    cost-basis write and every business_financial_events row for the trade
--    were left to a separate, non-atomic TS step afterward
--    (src/domains/inventory/service.ts, ~40 lines, per migration 087's and
--    099's own header comments flagging this as deferred to this phase).
--    Moved entirely into the RPC for the business-to-business case: the
--    destination's inventory addition now uses compute_inventory_cost_addition
--    under the same lock already held for the quantity update, and revenue/
--    COGS/inventory financial events are inserted in the same transaction as
--    the cash movement and the source-side relief.
-- 2. Item 43 (contracts): fulfillContract() (src/domains/contracts/service.ts)
--    was a sequential, unlocked, multi-round-trip TS orchestration --
--    inventory relief, a cash credit, financial events, and the contract
--    status update were four+ separate network round trips with no shared
--    transaction, violating the plan's top-level rule ("do not leave
--    important financial-event writes in TypeScript after an economic SQL
--    transaction has already committed"). tick-manufacturing's own contract
--    auto-fulfillment path (consumeInventoryForContract) was worse still: it
--    reduced business_inventory.quantity in a loop with no lock and, unlike
--    every other consumption path in this codebase, never touched
--    total_cost at all -- leaving a stale, overstated cost basis on any
--    partially-consumed row -- and wrote zero financial events, just a bare
--    business_accounts credit. New RPC fulfill_contract_atomic replaces both
--    call sites: it relieves inventory (compute_inventory_cost_relief),
--    credits cash, and writes revenue/COGS/inventory financial events in one
--    transaction, and is now the single implementation contract fulfillment
--    uses everywhere.
--
-- fulfill_contract_atomic follows the service_role-only, explicit-p_player_id
-- pattern established by charge_employee_wage_atomic/settle_employee_wages_atomic
-- (098) rather than accept_contract_atomic's auth.uid()-checking pattern:
-- fulfillContract() is invoked through the generic QueryClient abstraction
-- (sometimes RLS-scoped, sometimes -- in tests -- already service-role) and
-- never itself relied on auth.uid(), matching how addBusinessAccountEntry
-- already calls append_business_account_entry with its own freshly-minted
-- service-role client rather than the caller's client.
--
-- On an insufficient-inventory shortfall, fulfill_contract_atomic does NOT
-- raise -- it commits a status='in_progress' update and returns
-- {ok: false, reason: 'insufficient_inventory'} via a normal RETURN, since
-- nothing else has mutated yet at that point in the function. This preserves
-- the pre-existing behavior (a failed fulfillment attempt still commits the
-- in_progress transition) while keeping every write in this function
-- all-or-nothing.

-- ---------------------------------------------------------------------------
-- execute_inventory_transfer -- destination-side cost basis + financial
-- events for business-to-business transfers, now inside the same
-- transaction as the source-side relief and cash movement.
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
      insert into public.business_accounts (
        business_id, amount, entry_type, category, reference_id, description
      )
      values
      (
        p_source_business_id, v_inventory_sale_amount, 'credit', 'business_transfer_in', v_transfer_reference_id,
        'Inventory transfer sale: ' || p_quantity::text || 'x ' || p_item_key || ' @ ' || to_char(p_unit_price, 'FM9999999990.00')
      ),
      (
        p_destination_business_id, v_inventory_sale_amount, 'debit', 'business_transfer_out', v_transfer_reference_id,
        'Inventory transfer purchase: ' || p_quantity::text || 'x ' || p_item_key || ' @ ' || to_char(p_unit_price, 'FM9999999990.00')
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

    insert into public.business_accounts (
      business_id, amount, entry_type, category, reference_id, description
    )
    values
    (
      p_source_business_id, v_inventory_sale_amount, 'credit', 'business_transfer_in', v_transfer_reference_id,
      'Inventory transfer sale: ' || p_quantity::text || 'x ' || p_item_key || ' @ ' || to_char(p_unit_price, 'FM9999999990.00')
    ),
    (
      p_destination_business_id, v_inventory_sale_amount, 'debit', 'business_transfer_out', v_transfer_reference_id,
      'Inventory transfer purchase: ' || p_quantity::text || 'x ' || p_item_key || ' @ ' || to_char(p_unit_price, 'FM9999999990.00')
    );

    -- No destination "inventory acquired" event yet -- the goods are still
    -- in shipping_queue, not in the buyer's business_inventory, until
    -- delivery resolves them (landed cost at arrival is item 45 / Phase F).
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
-- fulfill_contract_atomic
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

  insert into public.business_accounts (business_id, amount, entry_type, category, reference_id, description)
  values (
    v_contract.business_id, v_payout, 'credit', 'contract_payout', v_contract.id,
    'Contract payout: ' || v_remaining::text || 'x ' || v_contract.item_key
  );

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

revoke all on function public.fulfill_contract_atomic(uuid, uuid) from public;
grant execute on function public.fulfill_contract_atomic(uuid, uuid) to service_role;

comment on function public.fulfill_contract_atomic is
  'AccountingFixPlan Phase E: atomically relieves the exact weighted-average inventory cost of goods delivered, credits the payout, writes revenue/COGS/inventory financial events, and marks the contract fulfilled -- all in one transaction. Used by both the player-initiated fulfillContract() path and tick-manufacturing''s contract auto-fulfillment sweep. Returns {ok: false, reason: ''insufficient_inventory''} (committing an in_progress status transition) instead of raising when there is not enough inventory yet.';
