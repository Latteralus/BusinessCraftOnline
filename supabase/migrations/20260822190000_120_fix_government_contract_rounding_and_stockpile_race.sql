-- Fixes three real bugs found during a full-project assessment (2026-08-21)
-- in functions from migrations 112/114/119. Migrations 111-119 were already
-- applied to the hosted project by the time this was written (confirmed via
-- `supabase migration list` and by reading each live function's actual body
-- with `supabase db query --linked`), so editing those migration files in
-- place -- as an earlier pass of this same fix mistakenly did, since it
-- believed 111-119 were still unpushed -- has no effect on hosted: Supabase's
-- migration tracking is version-based, not content-based, and a version
-- already recorded as applied is never re-run by `db push`. This migration
-- is the actual fix, following this repo's own established convention for
-- correcting an already-shipped migration (e.g. 081 fixing 066, 110 fixing
-- extraction_slots) -- a new migration with `create or replace function`,
-- never a silent edit to history. See Documents/changelog.md (2026-08-21/22
-- entries) for the full investigation, including a first fix attempt that
-- introduced a *different* bug (letting quantity_delivered exceed
-- quantity_requested), caught only by manually exercising a genuinely
-- fractional case against a local reset before this was pushed anywhere.
--
-- All three functions below are `create or replace function` with the exact
-- same signature as their live counterparts, so existing grants/ACLs and
-- every existing call site are unaffected.

-- ---------------------------------------------------------------------------
-- 1. product_agg's transition function: make it STRICT so a malformed event
--    modifier (an explicit `null` for a matching key) can't silently poison
--    the whole running product to null, which the outer `coalesce(..., 1)`
--    in migration 112 then reads as "reset this index to neutral" instead of
--    "skip just this bad row." CREATE OR REPLACE can change STRICT-ness
--    freely (only argument/return types are signature-fixed), and since the
--    `product_agg` aggregate references this function by OID, it picks up
--    the new strictness automatically -- no need to redefine the aggregate.
-- ---------------------------------------------------------------------------
create or replace function public._multiply_numeric_state(state numeric, value numeric)
returns numeric
language sql
immutable
strict
as $$
  select state * value;
$$;

-- ---------------------------------------------------------------------------
-- 2. _materialize_city_stockpile_ids: the original single `UPDATE ... FROM`
--    relied on the update's own row lock, correct for one caller but not for
--    three (the 5-minute due sweep, the daily government pass, and
--    deliver_government_contract_atomic below, which calls this function
--    twice on the same row in one transaction). A blocked UPDATE's
--    EvalPlanQual re-check on lock conflict only re-verifies join/WHERE
--    quals, not the already-computed SET expressions, so a second writer
--    could silently overwrite a first writer's correctly-depleted stock with
--    stale-computed values. Fixed by explicitly locking every target row (in
--    a stable order, to avoid a lock-order deadlock between two overlapping
--    calls) before the CTE-based UPDATE runs, so the UPDATE executes as a
--    fresh statement against fresh (post-lock) data under READ COMMITTED's
--    per-statement snapshot semantics.
-- ---------------------------------------------------------------------------
create or replace function public._materialize_city_stockpile_ids(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_processed integer := 0;
begin
  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;

  perform 1 from public.city_stockpiles where id = any(p_ids) order by id for update;

  with computed as (
    select
      cs.id,
      cs.stored_quantity,
      cs.reorder_point,
      cs.base_consumption_per_hour,
      greatest(0, extract(epoch from (v_now - cs.last_materialized_at)) / 3600.0) as elapsed_hours,
      case when coalesce(c.population_baseline, 0) > 0
        then coalesce(ces.population, c.population_baseline)::numeric / c.population_baseline
        else 1
      end as population_scale,
      coalesce(ces.municipal_consumption_index, 1) as city_municipal_index,
      coalesce(wes.municipal_consumption_index, 1) as world_municipal_index,
      coalesce((
        select product_agg((ce.modifiers ->> ('stockpile_' || cs.item_key))::numeric)
        from public.city_events ce
        where ce.city_id = cs.city_id
          and ce.is_active
          and ce.modifiers ? ('stockpile_' || cs.item_key)
      ), 1) as event_mult
    from public.city_stockpiles cs
    join public.cities c on c.id = cs.city_id
    left join public.city_economic_state ces on ces.city_id = cs.city_id
    left join public.world_economic_state wes on wes.id = 1
    where cs.id = any(p_ids)
  ),
  final as (
    select
      id,
      reorder_point,
      base_consumption_per_hour * population_scale * city_municipal_index * world_municipal_index * event_mult as effective_rate,
      greatest(0, stored_quantity - elapsed_hours * (base_consumption_per_hour * population_scale * city_municipal_index * world_municipal_index * event_mult)) as new_stock
    from computed
  )
  update public.city_stockpiles cs
  set
    stored_quantity = f.new_stock,
    last_materialized_at = v_now,
    next_reorder_at = case
      when f.new_stock <= f.reorder_point then v_now
      when f.effective_rate > 0 then v_now + ((f.new_stock - f.reorder_point) / f.effective_rate) * interval '1 hour'
      else null
    end,
    updated_at = v_now
  from final f
  where f.id = cs.id;

  get diagnostics v_processed = row_count;
  return v_processed;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. deliver_government_contract_atomic: business_inventory.quantity is a
--    whole-unit integer column, but government_contracts.quantity_requested/
--    quantity_delivered are numeric (auto-generated replenishment contracts,
--    migration 118, target fractional per-capita amounts). The live version
--    wrote a fractional p_quantity straight into that integer column with no
--    rounding -- silent, since Postgres implicitly casts on assignment. Fixed
--    by flooring the deliverable amount to whole units up front, capped
--    against v_remaining itself (NOT its ceiling -- government_contracts'
--    own `quantity_delivered <= quantity_requested` CHECK, migration 117,
--    forbids delivering even one unit past the requested amount; a first fix
--    attempt that capped via ceil() to let a sub-unit remainder close out
--    with one final unit instead threw that CHECK violation outright,
--    confirmed by manually delivering 42 against a 41.7 remainder against a
--    local reset). floor(least(p_quantity, v_remaining)) can never exceed
--    v_remaining, so it can never violate that constraint -- the accepted
--    tradeoff is that a sub-whole-unit remainder (e.g. 0.7 units) can never
--    be fully closed out by a real delivery, since a fractional physical
--    delivery isn't possible either; the contract simply stays 'in_progress'
--    with that residual forever. Silently corrupting the inventory count
--    (the original bug) is worse than an honest, permanently-open fractional
--    remainder. Also added an explicit round(...)::integer on the actual
--    inventory write as defense in depth.
-- ---------------------------------------------------------------------------
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

-- Migration complete: all three functions now match the fixes validated
-- locally in migrations 112/114/119's file comments (those files were edited
-- in place before it was discovered they were already live -- this
-- migration is what actually ships the fix).
