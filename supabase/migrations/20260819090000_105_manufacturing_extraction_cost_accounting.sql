-- AccountingFixPlan Phase D: manufacturing/extraction cost accounting.
--
-- Item 42: extraction/farming output cost must never be derived from
-- NPC_PRICE_CEILINGS (a selling-price model). tick-extraction currently
-- passes p_unit_cost = NPC_PRICE_CEILINGS[item] * 0.55 unconditionally, even
-- for a mine that consumed nothing. The fix: output cost basis = the actual
-- weighted-average cost of consumables relieved to produce it (water, for
-- farms), or exactly 0 when nothing was consumed (mines/logging/oil/water
-- wells have no tracked consumable per shared/economy.ts).
--
-- Item 41: manufacturing finished-goods cost must equal the exact
-- weighted-average cost of consumed inputs, with no duplication. The input
-- consumption side already used real row costs, but its fallback for a row
-- with no cost basis at all (resolveRowUnitCost in tick-manufacturing) fell
-- back to the same NPC-price-ceiling formula -- the same bug in a different
-- place, and one that would silently reappear the moment extraction starts
-- producing legitimately-$0-cost raw materials that manufacturing later
-- consumes.
--
-- Per the Phase A/C notes, tick-manufacturing and tick-extraction were the
-- least atomic paths in the codebase: input consumption was a plain
-- unlocked SELECT followed by a loop of per-row .update()/.delete() calls,
-- with the availability check itself a separate, earlier, non-locking read
-- -- a TOCTOU window between "can we produce" and "consume inputs" that no
-- other economic path in this codebase has. This migration adds two new
-- atomic RPCs, following the same pattern as charge_employee_wage_atomic
-- (098) and the settle_*_atomic family: input relief (via the Phase C
-- shared compute_inventory_cost_relief helper, fallback_unit_cost = 0, not
-- a price-ceiling guess) + output creation (via add_business_inventory_quantity,
-- reusing the existing weighted-average addition logic) happen in one
-- transaction, locked with SELECT ... FOR UPDATE, so a shortfall rolls back
-- every input already relieved during that same call instead of leaving a
-- partially-consumed state.
--
-- Both extraction and manufacturing decouple "input consumed this tick"
-- from "output produced this tick" (separate floor()/remainder progress
-- accumulators -- see 20260309211000_053_production_progress_deterministic.sql),
-- so a tick can relieve input cost without yet producing a unit. A new
-- pending_production_cost column on each table acts as a small WIP/suspense
-- account: relieved input cost accumulates there and is fully absorbed into
-- the next produced unit's cost basis (then zeroed), so cost is never lost
-- or double-counted across ticks.

alter table public.extraction_slots
  add column if not exists pending_production_cost numeric(14, 2) not null default 0;

comment on column public.extraction_slots.pending_production_cost is
  'Weighted-average cost of consumables (e.g. farm water) relieved but not yet absorbed into a produced unit''s cost basis. Absorbed into the next produced batch by run_extraction_slot_production, then reset to 0.';

alter table public.manufacturing_lines
  add column if not exists pending_production_cost numeric(14, 2) not null default 0;

comment on column public.manufacturing_lines.pending_production_cost is
  'Weighted-average cost of raw-material inputs relieved but not yet absorbed into a produced unit''s cost basis. Absorbed into the next produced batch by run_manufacturing_line_production, then reset to 0.';

-- ---------------------------------------------------------------------------
-- run_extraction_slot_production
-- ---------------------------------------------------------------------------

create or replace function public.run_extraction_slot_production(
  p_slot_id uuid,
  p_owner_player_id uuid,
  p_business_id uuid,
  p_city_id uuid,
  p_water_required numeric,
  p_next_input_progress numeric,
  p_output_item_key text,
  p_output_quality integer,
  p_output_units integer,
  p_next_output_progress numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot public.extraction_slots%rowtype;
  v_row record;
  v_available numeric;
  v_used numeric;
  v_remaining numeric;
  v_row_unit_cost numeric;
  v_row_relieved_cost numeric;
  v_row_next_qty numeric;
  v_row_next_total_cost numeric;
  v_water_relieved numeric := 0;
  v_pending numeric;
  v_output_unit_cost numeric := null;
  v_now timestamptz := now();
begin
  if p_slot_id is null then
    raise exception 'slot_id is required.';
  end if;

  select * into v_slot from public.extraction_slots where id = p_slot_id for update;
  if not found then
    raise exception 'Extraction slot not found.';
  end if;

  v_pending := coalesce(v_slot.pending_production_cost, 0);

  if coalesce(p_water_required, 0) > 0 then
    v_remaining := p_water_required;

    for v_row in
      select id, quantity, reserved_quantity, unit_cost, total_cost
      from public.business_inventory
      where business_id = p_business_id
        and owner_player_id = p_owner_player_id
        and item_key = 'water'
      order by quality desc
      for update
    loop
      exit when v_remaining <= 0;
      v_available := greatest(0, v_row.quantity - v_row.reserved_quantity);
      if v_available <= 0 then continue; end if;
      v_used := least(v_available, v_remaining);

      select r.unit_cost, r.relieved_cost, r.next_quantity, r.next_total_cost
      into v_row_unit_cost, v_row_relieved_cost, v_row_next_qty, v_row_next_total_cost
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

      v_water_relieved := v_water_relieved + v_row_relieved_cost;
      v_remaining := v_remaining - v_used;
    end loop;

    if v_remaining > 0 then
      -- Not enough water yet -- raise so every relief statement run above in
      -- this same call rolls back too (no partial water consumption without
      -- a corresponding cost/output outcome). Caller treats this as a normal
      -- "wait and retry next tick" outcome, not a real error.
      raise exception 'insufficient_input:water';
    end if;

    v_pending := round(v_pending + v_water_relieved, 2);
  end if;

  if coalesce(p_output_units, 0) > 0 then
    v_output_unit_cost := case when v_pending > 0 then round(v_pending / p_output_units, 2) else 0 end;
    perform public.add_business_inventory_quantity(
      p_owner_player_id, p_business_id, p_city_id, p_output_item_key, p_output_quality, p_output_units, v_output_unit_cost
    );
    v_pending := 0;
  end if;

  update public.extraction_slots
  set
    input_progress = p_next_input_progress,
    output_progress = p_next_output_progress,
    pending_production_cost = v_pending,
    last_extracted_at = case when coalesce(p_output_units, 0) > 0 then v_now else last_extracted_at end,
    updated_at = v_now
  where id = p_slot_id;

  return jsonb_build_object(
    'outputUnitCost', v_output_unit_cost,
    'waterRelieved', v_water_relieved
  );
end;
$$;

revoke all on function public.run_extraction_slot_production(uuid, uuid, uuid, uuid, numeric, numeric, text, integer, integer, numeric) from public;
grant execute on function public.run_extraction_slot_production(uuid, uuid, uuid, uuid, numeric, numeric, text, integer, integer, numeric) to service_role;

comment on function public.run_extraction_slot_production is
  'AccountingFixPlan Phase D: atomically relieves a farm''s water cost (if any) and creates the produced batch with a cost basis derived only from actually-consumed inputs (never NPC_PRICE_CEILINGS). Raises insufficient_input:water instead of partially consuming when there is not enough water for the tick.';

-- ---------------------------------------------------------------------------
-- run_manufacturing_line_production
-- ---------------------------------------------------------------------------

create or replace function public.run_manufacturing_line_production(
  p_line_id uuid,
  p_owner_player_id uuid,
  p_business_id uuid,
  p_city_id uuid,
  p_inputs jsonb,
  p_output_item_key text,
  p_output_quality integer,
  p_output_units integer,
  p_next_input_progress jsonb,
  p_next_output_progress numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.manufacturing_lines%rowtype;
  v_input jsonb;
  v_item_key text;
  v_required numeric;
  v_remaining numeric;
  v_row record;
  v_available numeric;
  v_used numeric;
  v_row_unit_cost numeric;
  v_row_relieved_cost numeric;
  v_row_next_qty numeric;
  v_row_next_total_cost numeric;
  v_consumed_cost numeric := 0;
  v_pending numeric;
  v_output_unit_cost numeric := null;
  v_now timestamptz := now();
begin
  if p_line_id is null then
    raise exception 'line_id is required.';
  end if;

  select * into v_line from public.manufacturing_lines where id = p_line_id for update;
  if not found then
    raise exception 'Manufacturing line not found.';
  end if;

  v_pending := coalesce(v_line.pending_production_cost, 0);

  for v_input in select * from jsonb_array_elements(coalesce(p_inputs, '[]'::jsonb))
  loop
    v_item_key := v_input ->> 'itemKey';
    v_required := coalesce((v_input ->> 'quantity')::numeric, 0);
    if v_item_key is null or v_required <= 0 then continue; end if;

    v_remaining := v_required;

    for v_row in
      select id, quantity, reserved_quantity, unit_cost, total_cost
      from public.business_inventory
      where business_id = p_business_id
        and owner_player_id = p_owner_player_id
        and item_key = v_item_key
      order by quality desc
      for update
    loop
      exit when v_remaining <= 0;
      v_available := greatest(0, v_row.quantity - v_row.reserved_quantity);
      if v_available <= 0 then continue; end if;
      v_used := least(v_available, v_remaining);

      select r.unit_cost, r.relieved_cost, r.next_quantity, r.next_total_cost
      into v_row_unit_cost, v_row_relieved_cost, v_row_next_qty, v_row_next_total_cost
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
      v_remaining := v_remaining - v_used;
    end loop;

    if v_remaining > 0 then
      -- Insufficient input -- raise so every input already relieved earlier
      -- in this same call (other items in p_inputs) rolls back too. This is
      -- the same all-or-nothing gate the prior TS pre-check performed, now
      -- enforced atomically under row locks instead of via a separate,
      -- earlier, non-locking read.
      raise exception 'insufficient_input:%', v_item_key;
    end if;
  end loop;

  v_pending := round(v_pending + v_consumed_cost, 2);

  if coalesce(p_output_units, 0) > 0 then
    v_output_unit_cost := case when v_pending > 0 then round(v_pending / p_output_units, 2) else 0 end;
    perform public.add_business_inventory_quantity(
      p_owner_player_id, p_business_id, p_city_id, p_output_item_key, p_output_quality, p_output_units, v_output_unit_cost
    );
    v_pending := 0;
  end if;

  update public.manufacturing_lines
  set
    worker_assigned = true,
    input_progress = p_next_input_progress,
    output_progress = p_next_output_progress,
    pending_production_cost = v_pending,
    last_tick_at = case when coalesce(p_output_units, 0) > 0 then v_now else last_tick_at end,
    updated_at = v_now
  where id = p_line_id;

  return jsonb_build_object(
    'consumedCost', v_consumed_cost,
    'outputUnitCost', v_output_unit_cost
  );
end;
$$;

revoke all on function public.run_manufacturing_line_production(uuid, uuid, uuid, uuid, jsonb, text, integer, integer, jsonb, numeric) from public;
grant execute on function public.run_manufacturing_line_production(uuid, uuid, uuid, uuid, jsonb, text, integer, integer, jsonb, numeric) to service_role;

comment on function public.run_manufacturing_line_production is
  'AccountingFixPlan Phase D: atomically relieves manufacturing raw-material inputs (weighted-average cost, no NPC-price fallback) and creates finished goods with a cost basis equal to exactly what was consumed. Raises insufficient_input:<item_key> instead of partially consuming when inputs are short.';
