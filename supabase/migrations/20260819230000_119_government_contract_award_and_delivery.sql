-- CityPlan Phase 4: Government Procurement Contracts, part 3 -- the two
-- player-facing RPCs. Per Documents/Plans/CityPlan.md ("Municipal
-- replenishment contracts point to a city stockpile. Cross-city goods must
-- be shipped to the issuing/destination city before they can be delivered.
-- Contract delivery atomically deducts destination-city business inventory,
-- replenishes municipal stock, updates contract progress, and pays the
-- business.")
--
-- award_government_contract_atomic -- a player claims an 'available'
--   contract with one of their businesses (any city; the city constraint is
--   enforced at delivery time, not award time, since a player may need to
--   move goods into the destination city first via the existing
--   execute_inventory_transfer shipping path -- no new freight system is
--   introduced here, per the plan's Phase 5 note that abstract shipping
--   already exists and route-based freight is a later phase).
--
-- deliver_government_contract_atomic -- models fulfill_contract_atomic's
-- *current* definition (migration 108, which added a balanced journal entry
-- on top of migration 106's original version) closely: lock the contract,
-- verify the awarded business, consume inventory at >= the contract's
-- minimum_quality via compute_inventory_cost_relief, post a single balanced
-- journal entry (cash/revenue, cogs/inventory) via post_business_journal_entry
-- so this shows up correctly in the balance sheet/cash flow statement/
-- reconciliation like every other revenue-generating flow, pay the business,
-- and replenish the destination city_stockpile via the existing
-- _materialize_city_stockpile_ids helper (called twice: once to bring the
-- checkpoint current before adding the delivered quantity, once more after
-- to recompute next_reorder_at against the new stock level -- reusing the
-- tested formula rather than duplicating it). Supports partial delivery
-- across multiple calls, same as player contracts' delivered_quantity/
-- required_quantity model.

create or replace function public.award_government_contract_atomic(
  p_player_id uuid,
  p_business_id uuid,
  p_contract_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contract public.government_contracts%rowtype;
  v_business_id uuid;
begin
  if p_player_id is null or auth.uid() is distinct from p_player_id then
    raise exception 'Unauthorized.';
  end if;

  select * into v_contract
  from public.government_contracts
  where id = p_contract_id
  for update;

  if v_contract.id is null then
    raise exception 'Contract not found.';
  end if;

  if v_contract.status <> 'available' then
    raise exception 'Only available contracts can be awarded.';
  end if;

  select id into v_business_id
  from public.businesses
  where id = p_business_id and player_id = p_player_id;

  if v_business_id is null then
    raise exception 'Business not found.';
  end if;

  update public.government_contracts
  set
    status = 'awarded',
    awarded_business_id = v_business_id,
    updated_at = now()
  where id = v_contract.id
  returning * into v_contract;

  return jsonb_build_object('ok', true, 'contract', to_jsonb(v_contract));
end;
$$;

revoke all on function public.award_government_contract_atomic(uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.award_government_contract_atomic(uuid, uuid, uuid) to authenticated;

create or replace function public.deliver_government_contract_atomic(
  p_player_id uuid,
  p_contract_id uuid,
  p_quantity numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contract public.government_contracts%rowtype;
  v_business public.businesses%rowtype;
  v_remaining numeric;
  v_to_deliver numeric;
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
  from public.government_contracts
  where id = p_contract_id
  for update;

  if v_contract.id is null then
    raise exception 'Contract not found.';
  end if;

  if v_contract.status not in ('awarded', 'in_progress') then
    raise exception 'Only awarded or in-progress contracts can be delivered against.';
  end if;

  if v_contract.awarded_business_id is null then
    raise exception 'Contract has not been awarded.';
  end if;

  select * into v_business
  from public.businesses
  where id = v_contract.awarded_business_id and player_id = p_player_id
  for update;

  if v_business.id is null then
    raise exception 'Business not found.';
  end if;

  -- Cross-city delivery must go through the existing inventory-transfer
  -- shipping path first (execute_inventory_transfer, migration 106) to move
  -- goods into a business located in the contract's destination city --
  -- there is no new freight system in this phase (see CityPlan.md Phase 5,
  -- not yet built). Nothing has mutated yet, so this is a clean early exit.
  if v_contract.city_id is not null and v_business.city_id <> v_contract.city_id then
    return jsonb_build_object('ok', false, 'reason', 'wrong_city');
  end if;

  v_remaining := greatest(0, v_contract.quantity_requested - v_contract.quantity_delivered);
  if v_remaining <= 0 then
    raise exception 'Contract is already fully delivered.';
  end if;

  -- business_inventory.quantity is a whole-unit integer column, but
  -- quantity_requested/quantity_delivered are numeric (auto-generated
  -- replenishment contracts target fractional per-capita amounts, migration
  -- 118). Round the deliverable amount down to whole units up front so every
  -- downstream inventory write below is already an integer. Must cap against
  -- v_remaining itself, not ceil(v_remaining) -- government_contracts' own
  -- `quantity_delivered <= quantity_requested` CHECK (migration 117) forbids
  -- delivering even one unit past the requested amount, confirmed by hand
  -- against a local reset: capping via ceil() let quantity_delivered (42)
  -- exceed a 41.7 quantity_requested and the RPC threw the CHECK violation
  -- outright. floor(least(p_quantity, v_remaining)) can never exceed
  -- v_remaining, so it can never violate that constraint -- the accepted
  -- tradeoff is that a sub-whole-unit remainder (e.g. 0.7 units) can never
  -- be fully closed out by a real delivery, since a fractional physical
  -- delivery isn't possible either; the contract simply stays 'in_progress'
  -- with that residual forever. Silently corrupting the inventory count (the
  -- original bug) is worse than an honest, permanently-open fractional
  -- remainder, so this is left as a known limitation rather than "solved"
  -- further -- fixing it for real would mean rounding quantity_requested
  -- itself at contract-creation time (migration 118), a separate decision.
  v_to_deliver := floor(least(greatest(coalesce(p_quantity, 0), 0), v_remaining));
  if v_to_deliver <= 0 then
    raise exception 'Delivery quantity must be at least 1 whole unit.';
  end if;

  select coalesce(sum(greatest(0, quantity - reserved_quantity)), 0)
  into v_available
  from public.business_inventory
  where owner_player_id = p_player_id
    and business_id = v_business.id
    and item_key = v_contract.item_key
    and quality >= v_contract.minimum_quality;

  if v_available < v_to_deliver then
    -- Nothing else has mutated yet, so this commits as a plain status
    -- transition (matches fulfill_contract_atomic's pre-existing pattern) --
    -- the actual delivery stays all-or-nothing for this call below.
    update public.government_contracts
    set status = 'in_progress', updated_at = v_now
    where id = v_contract.id;

    return jsonb_build_object('ok', false, 'reason', 'insufficient_inventory');
  end if;

  v_to_consume := v_to_deliver;

  for v_row in
    select id, quantity, reserved_quantity, unit_cost, total_cost
    from public.business_inventory
    where owner_player_id = p_player_id
      and business_id = v_business.id
      and item_key = v_contract.item_key
      and quality >= v_contract.minimum_quality
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
        -- v_row_next_qty is already whole given v_to_deliver/v_used are now
        -- guaranteed whole above; round explicitly as defense in depth so an
        -- integer column is never handed a silently-truncated fraction.
        quantity = round(v_row_next_qty)::integer,
        reserved_quantity = least(v_row.reserved_quantity, round(v_row_next_qty)::integer),
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
    -- transaction, rows locked immediately after).
    raise exception 'Inventory changed during delivery -- insufficient available quantity.';
  end if;

  -- Replenish the destination city_stockpile. Bring its checkpoint current
  -- first (elapsed-time depletion since it was last materialized), add the
  -- delivered quantity, then materialize again (elapsed ~0 this time) so
  -- next_reorder_at is recomputed against the new stock level using the
  -- exact same formula rather than a duplicated copy of it.
  if v_contract.stockpile_id is not null then
    perform public._materialize_city_stockpile_ids(array[v_contract.stockpile_id]);

    update public.city_stockpiles
    set stored_quantity = stored_quantity + v_to_deliver, updated_at = v_now
    where id = v_contract.stockpile_id;

    perform public._materialize_city_stockpile_ids(array[v_contract.stockpile_id]);
  end if;

  v_payout := round((v_to_deliver * v_contract.unit_price)::numeric, 2);

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
      v_business.id,
      v_journal_lines,
      'government_contract',
      v_contract.id,
      'Government contract delivery: ' || v_to_deliver::text || 'x ' || v_contract.item_key,
      v_now
    );
  end if;

  if v_payout > 0 then
    insert into public.business_accounts (business_id, amount, entry_type, category, reference_id, description, journal_entry_id)
    values (
      v_business.id, v_payout, 'credit', 'contract_payout', v_contract.id,
      'Government contract payout: ' || v_to_deliver::text || 'x ' || v_contract.item_key,
      v_journal_entry_id
    );
  end if;

  -- business_financial_events.quantity is integer (schema predates fractional
  -- government-contract quantities), so round for this informational field --
  -- the authoritative fractional amount stays in
  -- government_contracts.quantity_delivered (numeric) below, unaffected.
  insert into public.business_financial_events (business_id, account_code, amount, quantity, item_key, reference_type, reference_id, description, metadata)
  values
    (
      v_business.id, 'revenue', v_payout, round(v_to_deliver)::integer, v_contract.item_key, 'government_contract', v_contract.id,
      'Government contract revenue: ' || v_to_deliver::text || 'x ' || v_contract.item_key,
      jsonb_build_object('estimatedCost', v_estimated)
    ),
    (
      v_business.id, 'cogs', v_consumed_cost, round(v_consumed_qty)::integer, v_contract.item_key, 'government_contract', v_contract.id,
      'Government contract COGS: ' || v_to_deliver::text || 'x ' || v_contract.item_key,
      jsonb_build_object('estimatedCost', v_estimated)
    ),
    (
      v_business.id, 'inventory', v_consumed_cost, round(v_consumed_qty)::integer, v_contract.item_key, 'government_contract', v_contract.id,
      'Inventory relieved for government contract: ' || v_to_deliver::text || 'x ' || v_contract.item_key,
      jsonb_build_object('direction', 'out', 'estimatedCost', v_estimated)
    );

  update public.government_contracts
  set
    quantity_delivered = quantity_delivered + v_to_deliver,
    status = case when quantity_delivered + v_to_deliver >= quantity_requested then 'fulfilled' else 'in_progress' end,
    closed_at = case when quantity_delivered + v_to_deliver >= quantity_requested then v_now else null end,
    updated_at = v_now
  where id = v_contract.id
  returning * into v_contract;

  return jsonb_build_object('ok', true, 'contract', to_jsonb(v_contract), 'delivered', v_to_deliver, 'payout', v_payout, 'consumedCost', v_consumed_cost);
end;
$$;

-- service_role-only, not authenticated, matching fulfill_contract_atomic
-- (migration 106) exactly -- it moves business cash and inventory, so it's
-- called from server code (createSupabaseServiceRoleClient()) with an
-- already-authenticated p_player_id rather than trusting a direct
-- session-JWT call to self-report auth.uid().
revoke all on function public.deliver_government_contract_atomic(uuid, uuid, numeric) from public, anon, authenticated, service_role;
grant execute on function public.deliver_government_contract_atomic(uuid, uuid, numeric) to service_role;

-- Migration complete: players can award themselves an available government
-- contract and deliver against it in one or more calls.
