-- AccountingFixPlan Phase C: shared inventory cost-basis helpers.
--
-- The weighted-average cost RELIEF formula (shrink total_cost proportionally
-- when quantity drops) and the weighted-average cost ADDITION formula (blend
-- an incoming unit cost into an existing total_cost when quantity grows) were
-- each hand-duplicated inline across 9+ PL/pgSQL functions, picked up one
-- migration at a time as each accounting bug was found and patched locally
-- (065, 075/092, 079/081/088, 082, 086 x4, 087). Three subtly different
-- relief variants existed:
--   - execute_market_purchase/settle_store_inventory_sale(s)_atomic/
--     settle_market_listing_npc_sale_atomic: unit cost falls back to
--     coalesce(unit_cost, baseline, 0), and total_cost is reconstructed from
--     unit_cost * remaining_qty when the row had no total_cost to begin with.
--   - execute_inventory_transfer / the market_buy_order_settlement_functions
--     (086): unit cost falls back to raw unit_cost (possibly null) or
--     coalesce(unit_cost, 0), and total_cost is left NULL when the row had no
--     total_cost to begin with instead of ever being reconstructed.
-- The second family is a real accounting bug: a business_inventory row with
-- real quantity but a NULL total_cost silently contributes $0 to
-- SUM(business_inventory.total_cost) (nulls are skipped by SUM), permanently
-- understating the Balance Sheet's inventory asset for that row. This
-- migration standardizes every call site on the first (correct, more
-- complete) formula via one shared function, per the plan's explicit
-- instruction: "Make one shared database/helper implementation for cost
-- relief so manufacturing, transfers, sales, contracts, and other systems
-- cannot implement different math."
--
-- Two new pure-SQL helpers (no table access, no locking -- callers already
-- SELECT ... FOR UPDATE the row themselves before calling, since they also
-- need the locked row's fields for their own validation/branching):
--   compute_inventory_cost_relief(quantity, total_cost, unit_cost,
--     relieve_quantity, fallback_unit_cost) -> (unit_cost, relieved_cost,
--     next_quantity, next_total_cost, estimated)
--   compute_inventory_cost_addition(existing_quantity, existing_total_cost,
--     existing_unit_cost, added_quantity, added_unit_cost) -> (next_quantity,
--     next_total_cost, next_unit_cost)
-- compute_inventory_cost_addition mirrors computeWeightedAverageCost()
-- (src/domains/businesses/financial-events.ts), the TS-side canonical
-- addition formula already used by every TS-orchestrated inventory-add path.
--
-- Every function below is `create or replace` with its existing signature
-- unchanged, so no drops/grants are needed -- ACLs persist across
-- CREATE OR REPLACE FUNCTION. execute_inventory_transfer's returned jsonb
-- gains two additive fields (sourceUnitCost, sourceRelievedCost) so
-- src/domains/inventory/service.ts (transferItems) can stop re-deriving the
-- source's relief cost basis in a second, separately-locked TS read after the
-- RPC commits -- that TS-side recomputation was itself a "different math"
-- risk (JS floating-point division vs SQL numeric division; see that file's
-- update in this same change).

-- ---------------------------------------------------------------------------
-- compute_inventory_cost_relief
-- ---------------------------------------------------------------------------

create or replace function public.compute_inventory_cost_relief(
  p_quantity           numeric,
  p_total_cost         numeric,
  p_unit_cost          numeric,
  p_relieve_quantity   numeric,
  p_fallback_unit_cost numeric default 0
)
returns table (
  unit_cost       numeric,
  relieved_cost   numeric,
  next_quantity   numeric,
  next_total_cost numeric,
  estimated       boolean
)
language sql
stable
as $$
  select
    resolved.unit_cost,
    round(greatest(0, resolved.unit_cost * least(greatest(coalesce(p_relieve_quantity, 0), 0), greatest(coalesce(p_quantity, 0), 0)))::numeric, 2) as relieved_cost,
    greatest(coalesce(p_quantity, 0) - coalesce(p_relieve_quantity, 0), 0) as next_quantity,
    case
      when p_total_cost is not null then
        round(greatest(0, p_total_cost - round(greatest(0, resolved.unit_cost * least(greatest(coalesce(p_relieve_quantity, 0), 0), greatest(coalesce(p_quantity, 0), 0)))::numeric, 2))::numeric, 2)
      else
        round(greatest(0, resolved.unit_cost * greatest(coalesce(p_quantity, 0) - coalesce(p_relieve_quantity, 0), 0))::numeric, 2)
    end as next_total_cost,
    (p_total_cost is null and p_unit_cost is null) as estimated
  from (
    select case
      when p_total_cost is not null and coalesce(p_quantity, 0) > 0
        then round((p_total_cost / p_quantity)::numeric, 2)
      else coalesce(p_unit_cost, p_fallback_unit_cost, 0)
    end as unit_cost
  ) resolved;
$$;

revoke all on function public.compute_inventory_cost_relief(numeric, numeric, numeric, numeric, numeric) from public;

comment on function public.compute_inventory_cost_relief is
  'Canonical weighted-average inventory cost-relief math. Given a row''s current quantity/total_cost/unit_cost and a quantity being relieved, returns the unit cost used, the dollar cost relieved, the remaining quantity, and the remaining total_cost (reconstructed from unit_cost * remaining quantity when total_cost was NULL, so a row never ends up with real quantity and a NULL total_cost). Pure function -- caller must already hold FOR UPDATE on the source row and perform the actual UPDATE/DELETE.';

-- ---------------------------------------------------------------------------
-- compute_inventory_cost_addition
-- ---------------------------------------------------------------------------

create or replace function public.compute_inventory_cost_addition(
  p_existing_quantity   numeric,
  p_existing_total_cost numeric,
  p_existing_unit_cost  numeric,
  p_added_quantity      numeric,
  p_added_unit_cost     numeric
)
returns table (
  next_quantity   numeric,
  next_total_cost numeric,
  next_unit_cost  numeric
)
language sql
stable
as $$
  select
    greatest(coalesce(p_existing_quantity, 0), 0) + coalesce(p_added_quantity, 0) as next_quantity,
    round((resolved.existing_total_cost + coalesce(p_added_quantity, 0) * coalesce(p_added_unit_cost, 0))::numeric, 2) as next_total_cost,
    case
      when (greatest(coalesce(p_existing_quantity, 0), 0) + coalesce(p_added_quantity, 0)) > 0
        then round((resolved.existing_total_cost + coalesce(p_added_quantity, 0) * coalesce(p_added_unit_cost, 0))::numeric / (greatest(coalesce(p_existing_quantity, 0), 0) + coalesce(p_added_quantity, 0)), 2)
      else 0
    end as next_unit_cost
  from (
    select case
      when p_existing_total_cost is not null then p_existing_total_cost
      else greatest(coalesce(p_existing_quantity, 0), 0) * coalesce(p_existing_unit_cost, 0)
    end as existing_total_cost
  ) resolved;
$$;

revoke all on function public.compute_inventory_cost_addition(numeric, numeric, numeric, numeric, numeric) from public;

comment on function public.compute_inventory_cost_addition is
  'Canonical weighted-average inventory cost-addition math, mirroring computeWeightedAverageCost() in src/domains/businesses/financial-events.ts. Given a row''s current quantity/total_cost/unit_cost and an added quantity/unit cost, returns the blended next quantity/total_cost/unit_cost. Pure function -- caller performs the actual INSERT/UPDATE.';

-- ---------------------------------------------------------------------------
-- add_business_inventory_quantity -- now calls compute_inventory_cost_addition
-- instead of duplicating the weighted-average blend inline in the ON CONFLICT
-- DO UPDATE SET clause.
-- ---------------------------------------------------------------------------

create or replace function public.add_business_inventory_quantity(
  p_owner_player_id uuid,
  p_business_id     uuid,
  p_city_id         uuid,
  p_item_key        text,
  p_quality         integer,
  p_quantity        integer,
  p_unit_cost       numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_owner_player_id is null then
    raise exception 'owner_player_id is required.';
  end if;
  if p_business_id is null then
    raise exception 'business_id is required.';
  end if;
  if p_city_id is null then
    raise exception 'city_id is required.';
  end if;
  if p_item_key is null or char_length(trim(p_item_key)) = 0 then
    raise exception 'item_key is required.';
  end if;
  if p_quality is null or p_quality < 1 or p_quality > 100 then
    raise exception 'quality must be between 1 and 100.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be greater than 0.';
  end if;

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
    p_owner_player_id,
    p_business_id,
    p_city_id,
    p_item_key,
    p_quantity,
    p_quality,
    0,
    p_unit_cost,
    case when p_unit_cost is not null
         then round(p_unit_cost * p_quantity, 2)
         else null
    end
  )
  on conflict (business_id, item_key, quality)
  do update set
    quantity   = public.business_inventory.quantity + excluded.quantity,
    unit_cost  = case
      when excluded.unit_cost is not null then (
        select a.next_unit_cost
        from public.compute_inventory_cost_addition(
          public.business_inventory.quantity,
          public.business_inventory.total_cost,
          public.business_inventory.unit_cost,
          excluded.quantity,
          excluded.unit_cost
        ) a
      )
      else public.business_inventory.unit_cost
    end,
    total_cost = case
      when excluded.unit_cost is not null then (
        select a.next_total_cost
        from public.compute_inventory_cost_addition(
          public.business_inventory.quantity,
          public.business_inventory.total_cost,
          public.business_inventory.unit_cost,
          excluded.quantity,
          excluded.unit_cost
        ) a
      )
      else public.business_inventory.total_cost
    end,
    updated_at = now();
end;
$$;

grant execute on function public.add_business_inventory_quantity(uuid, uuid, uuid, text, integer, integer, numeric) to service_role;

-- ---------------------------------------------------------------------------
-- execute_inventory_transfer -- source-side relief now via the shared helper.
-- Also returns sourceUnitCost/sourceRelievedCost (additive jsonb fields) so
-- callers no longer need a second, separately-locked read to reconstruct
-- what the relief cost was.
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

    -- Weighted-average cost relief via the shared helper (compute_inventory_cost_relief) --
    -- same formula used by every other inventory-relieving RPC.
    select r.unit_cost, r.relieved_cost, r.next_total_cost
    into v_source_unit_cost, v_source_relieved_cost, v_source_next_total_cost
    from public.compute_inventory_cost_relief(
      v_source_business_inventory.quantity,
      v_source_business_inventory.total_cost,
      v_source_business_inventory.unit_cost,
      p_quantity,
      0
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
    'referenceId', v_transfer_reference_id,
    'sourceUnitCost', case when p_source_type = 'business' then v_source_unit_cost else null end,
    'sourceRelievedCost', case when p_source_type = 'business' then v_source_relieved_cost else null end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- execute_market_purchase -- seller-side relief and buyer-side addition now
-- via the shared helpers.
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
-- settle_store_inventory_sale_atomic -- relief via the shared helper.
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

-- ---------------------------------------------------------------------------
-- settle_store_inventory_sales_atomic (batch) -- relief via the shared helper.
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

-- ---------------------------------------------------------------------------
-- settle_market_listing_npc_sale_atomic -- relief via the shared helper. This
-- also closes the "leaves total_cost NULL forever" bug that variant existed
-- in (see migration header): a business-sourced listing whose backing row had
-- no total_cost previously kept total_cost NULL after a partial NPC sale.
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

-- ---------------------------------------------------------------------------
-- Buy-order settlement functions (_settle_buy_order_fill, place_market_buy_order,
-- sweep_buy_orders_for_new_listing, fulfill_market_buy_order) -- relief and
-- addition math now via the shared helpers everywhere they previously
-- duplicated it inline.
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
      select a.next_total_cost, a.next_unit_cost
      into v_next_total_cost, v_next_unit_cost
      from public.compute_inventory_cost_addition(
        v_target_business_inv.quantity, v_target_business_inv.total_cost, v_target_business_inv.unit_cost,
        p_fill_quantity, p_buy_order.max_unit_price
      ) a;

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

      select r.unit_cost, r.next_total_cost
      into v_seller_unit_cost, v_next_total_cost
      from public.compute_inventory_cost_relief(
        v_source_inventory.quantity, v_source_inventory.total_cost, v_source_inventory.unit_cost, v_fill_qty, 0
      ) r;

      if (v_source_inventory.quantity - v_fill_qty) <= 0 then
        delete from public.business_inventory where id = v_source_inventory.id;
      else
        update public.business_inventory
        set quantity = v_source_inventory.quantity - v_fill_qty,
            reserved_quantity = greatest(0, least(v_source_inventory.quantity - v_fill_qty, v_source_inventory.reserved_quantity - v_fill_qty)),
            total_cost = v_next_total_cost,
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
        select a.next_total_cost, a.next_unit_cost
        into v_next_total_cost, v_next_unit_cost
        from public.compute_inventory_cost_addition(
          v_target_business_inv.quantity, v_target_business_inv.total_cost, v_target_business_inv.unit_cost,
          v_fill_qty, v_listing.unit_price
        ) a;

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
  v_next_total_cost     numeric;
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

      select r.unit_cost, r.next_total_cost
      into v_seller_unit_cost, v_next_total_cost
      from public.compute_inventory_cost_relief(
        v_source_inventory.quantity, v_source_inventory.total_cost, v_source_inventory.unit_cost, v_fill_qty, 0
      ) r;

      if (v_source_inventory.quantity - v_fill_qty) <= 0 then
        delete from public.business_inventory where id = v_source_inventory.id;
      else
        update public.business_inventory
        set quantity = v_source_inventory.quantity - v_fill_qty,
            reserved_quantity = greatest(0, least(v_source_inventory.quantity - v_fill_qty, v_source_inventory.reserved_quantity - v_fill_qty)),
            total_cost = v_next_total_cost,
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
  v_next_total_cost     numeric;
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

    select r.unit_cost, r.next_total_cost
    into v_seller_unit_cost, v_next_total_cost
    from public.compute_inventory_cost_relief(
      v_business_inv.quantity, v_business_inv.total_cost, v_business_inv.unit_cost, p_quantity, 0
    ) r;

    if (v_business_inv.quantity - p_quantity) <= 0 then
      delete from public.business_inventory where id = v_business_inv.id;
    else
      update public.business_inventory
      set quantity = v_business_inv.quantity - p_quantity,
          total_cost = v_next_total_cost,
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

-- Migration complete: every SQL path that relieves or adds to
-- business_inventory's weighted-average cost basis now calls
-- compute_inventory_cost_relief / compute_inventory_cost_addition instead of
-- duplicating the math inline. Grants on all rewritten functions are
-- unchanged (CREATE OR REPLACE FUNCTION preserves existing ACLs).
