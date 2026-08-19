-- AccountingFixPlan Phase H (item 60, final end-to-end audit): closes a real
-- gap the audit found that no earlier phase's item list named -- production
-- line retooling.
--
-- retoolExtractionSlot / retoolManufacturingLine (src/domains/production/
-- service.ts) charge a real cash cost (category 'upgrade_purchase', the
-- exact same ledger category purchase_business_upgrade_atomic uses) via
-- addBusinessAccountEntry, but as a bare business_accounts insert with no
-- business_financial_events row at all -- invisible to getIncomeStatement,
-- getBalanceSheet, and reconcile_business_accounting. It was also the last
-- non-atomic money-moving path in the codebase: the balance check, the cash
-- debit, and the extraction_slots/manufacturing_lines status update were
-- three separate unlocked round trips, so a failure after the debit left
-- cash gone with no retool applied and no accounting trace at all.
--
-- Two new RPCs close both gaps at once, following the exact
-- service_role-only + explicit p_player_id pattern established by
-- charge_employee_wage_atomic (098), fulfill_contract_atomic (106), and
-- purchase_business_upgrade_atomic (107): validate ownership under a row
-- lock, debit cash + write a balanced journal entry (Debit operating_expense
-- / Credit cash -- a retool is a routine operating cost, not a durable
-- capitalized asset, unlike a real upgrade purchase) + an operating_expense
-- financial event, then apply the retool, all in one transaction. Recipe/
-- item validity and "already tooled for that" checks stay in TypeScript as a
-- cheap pre-check (same "pre-check is an optimization, the RPC is the
-- authority" split used for manufacturing/extraction production in Phase D)
-- -- this RPC only re-validates what's accounting-critical: ownership and
-- the cost.
--
-- Also found while wiring this up, not an accounting bug but a live
-- money-loss bug this same code path was about to trip over: extraction_slots'
-- status CHECK constraint (migration 018) was never widened to include
-- 'retooling' when per-line retooling was introduced (migration 053 added
-- manufacturing_lines from scratch with 'retooling' baked into its own CHECK
-- from day one, but only ALTERed extraction_slots to add the new *columns*,
-- not its status list). retoolExtractionSlot has therefore never been able to
-- reach `status = 'retooling'` on this table without violating
-- extraction_slots_status_check -- meaning the pre-existing (pre-Phase-H)
-- code would debit the retool cost via addBusinessAccountEntry and *then*
-- throw on the status update, leaving a player's cash gone with no retool
-- applied and no error surfaced anywhere but a failed request. Fixed here
-- since it blocks this migration's own RPC from ever succeeding either way.

alter table public.extraction_slots
  drop constraint extraction_slots_status_check;

alter table public.extraction_slots
  add constraint extraction_slots_status_check
  check (status in ('active', 'idle', 'resting', 'tool_broken', 'retooling'));

create or replace function public.retool_extraction_slot_atomic(
  p_player_id uuid,
  p_slot_id uuid,
  p_pending_item_key text,
  p_retool_cost numeric,
  p_retool_minutes integer
)
returns public.extraction_slots
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot public.extraction_slots%rowtype;
  v_ledger_row public.business_accounts;
  v_journal_entry_id uuid;
  v_cost numeric := coalesce(p_retool_cost, 0);
begin
  if p_player_id is null then
    raise exception 'player_id is required.';
  end if;

  select es.* into v_slot
  from public.extraction_slots es
  join public.businesses b on b.id = es.business_id
  where es.id = p_slot_id
    and b.player_id = p_player_id
  for update of es;

  if not found then
    raise exception 'Extraction slot not found.';
  end if;

  if v_cost > 0 then
    if coalesce(public.get_business_account_balance(v_slot.business_id), 0) < v_cost then
      raise exception 'Insufficient business funds. Retooling costs $%.', to_char(v_cost, 'FM9999999990.00');
    end if;

    v_ledger_row := public.append_business_account_entry(
      p_player_id,
      v_slot.business_id,
      v_cost,
      'debit',
      'upgrade_purchase',
      'Line retool funded: ' || p_pending_item_key,
      v_slot.id
    );

    v_journal_entry_id := public.post_business_journal_entry(
      v_slot.business_id,
      jsonb_build_array(
        jsonb_build_object('account_code', 'operating_expense', 'debit', v_cost),
        jsonb_build_object('account_code', 'cash', 'credit', v_cost)
      ),
      'line_retool',
      v_slot.id,
      'Extraction line retool: ' || p_pending_item_key,
      now()
    );

    update public.business_accounts set journal_entry_id = v_journal_entry_id where id = v_ledger_row.id;

    perform public.append_business_financial_event(
      p_player_id,
      v_slot.business_id,
      'operating_expense',
      v_cost,
      'Extraction line retool: ' || p_pending_item_key,
      null,
      p_pending_item_key,
      'line_retool',
      v_slot.id,
      now()
    );
  end if;

  update public.extraction_slots
  set
    pending_item_key = p_pending_item_key,
    retool_started_at = now(),
    retool_complete_at = now() + make_interval(mins => greatest(0, coalesce(p_retool_minutes, 0))),
    status = 'retooling',
    input_progress = 0,
    output_progress = 0,
    updated_at = now()
  where id = p_slot_id
  returning * into v_slot;

  return v_slot;
end;
$$;

revoke all on function public.retool_extraction_slot_atomic(uuid, uuid, text, numeric, integer) from public;
grant execute on function public.retool_extraction_slot_atomic(uuid, uuid, text, numeric, integer) to service_role;

comment on function public.retool_extraction_slot_atomic is
  'AccountingFixPlan Phase H (item 60): atomically charges an extraction slot retool cost (Debit operating_expense / Credit cash, plus a matching business_financial_events row) and applies the retool, replacing the prior two-round-trip addBusinessAccountEntry + plain update sequence that left the cost with no financial-event coverage at all.';

create or replace function public.retool_manufacturing_line_atomic(
  p_player_id uuid,
  p_line_id uuid,
  p_pending_recipe_key text,
  p_retool_cost numeric,
  p_retool_minutes integer
)
returns public.manufacturing_lines
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.manufacturing_lines%rowtype;
  v_ledger_row public.business_accounts;
  v_journal_entry_id uuid;
  v_cost numeric := coalesce(p_retool_cost, 0);
begin
  if p_player_id is null then
    raise exception 'player_id is required.';
  end if;

  select ml.* into v_line
  from public.manufacturing_lines ml
  join public.businesses b on b.id = ml.business_id
  where ml.id = p_line_id
    and b.player_id = p_player_id
  for update of ml;

  if not found then
    raise exception 'Manufacturing line not found.';
  end if;

  if v_cost > 0 then
    if coalesce(public.get_business_account_balance(v_line.business_id), 0) < v_cost then
      raise exception 'Insufficient business funds. Retooling costs $%.', to_char(v_cost, 'FM9999999990.00');
    end if;

    v_ledger_row := public.append_business_account_entry(
      p_player_id,
      v_line.business_id,
      v_cost,
      'debit',
      'upgrade_purchase',
      'Line retool funded: ' || p_pending_recipe_key,
      v_line.id
    );

    v_journal_entry_id := public.post_business_journal_entry(
      v_line.business_id,
      jsonb_build_array(
        jsonb_build_object('account_code', 'operating_expense', 'debit', v_cost),
        jsonb_build_object('account_code', 'cash', 'credit', v_cost)
      ),
      'line_retool',
      v_line.id,
      'Manufacturing line retool: ' || p_pending_recipe_key,
      now()
    );

    update public.business_accounts set journal_entry_id = v_journal_entry_id where id = v_ledger_row.id;

    perform public.append_business_financial_event(
      p_player_id,
      v_line.business_id,
      'operating_expense',
      v_cost,
      'Manufacturing line retool: ' || p_pending_recipe_key,
      null,
      p_pending_recipe_key,
      'line_retool',
      v_line.id,
      now()
    );
  end if;

  update public.manufacturing_lines
  set
    pending_recipe_key = p_pending_recipe_key,
    retool_started_at = now(),
    retool_complete_at = now() + make_interval(mins => greatest(0, coalesce(p_retool_minutes, 0))),
    status = 'retooling',
    output_progress = 0,
    input_progress = '{}'::jsonb,
    updated_at = now()
  where id = p_line_id
  returning * into v_line;

  return v_line;
end;
$$;

revoke all on function public.retool_manufacturing_line_atomic(uuid, uuid, text, numeric, integer) from public;
grant execute on function public.retool_manufacturing_line_atomic(uuid, uuid, text, numeric, integer) to service_role;

comment on function public.retool_manufacturing_line_atomic is
  'AccountingFixPlan Phase H (item 60): atomically charges a manufacturing line retool cost (Debit operating_expense / Credit cash, plus a matching business_financial_events row) and applies the retool, replacing the prior two-round-trip addBusinessAccountEntry + plain update sequence that left the cost with no financial-event coverage at all.';

-- Migration complete: production line retooling is now atomic and fully accounted for.
