-- AccountingFixPlan Phase H: reconciliation RPCs + historical data backfill
-- (items 53, 58).
--
-- Two independent pieces:
--
-- 1. reconcile_business_accounting(p_business_id): a read-only, service_role
--    -only report of the raw numbers item 53 asks for -- cash ledger balance
--    vs the maintained businesses.cash_balance column (migration 089),
--    journal debits vs credits, and inventory book value. It NEVER repairs
--    anything, only reports (per item 53: "Never silently repair
--    discrepancies... Report them clearly"). Two documented, expected
--    sources of a nonzero journal discrepancy that are NOT bugs (see
--    migration 108's own header comment): buy-order fills never post to the
--    journal at all, and B2B landed-cost capitalization at shipping delivery
--    doesn't either. The TypeScript layer (src/domains/businesses/
--    reconciliation.ts) combines this with getBalanceSheet/
--    getCashFlowStatement (src/domains/businesses/statements.ts) rather than
--    re-deriving Assets=Liabilities+Equity or beginning+netCF=ending here,
--    so there is exactly one implementation of each check.
--
-- 2. Two idempotent backfill functions for the two classes of pre-existing
--    data this plan's earlier phases fixed only prospectively:
--      - backfill_reconstruct_inventory_cost_basis(): business_inventory
--        rows with quantity > 0 and total_cost IS NULL (the exact bug Phase
--        C fixed going forward for every SQL relief/addition path, migration
--        099 -- this reconstructs any row that already existed with that gap
--        before 099 shipped). Reconstructed from unit_cost * quantity where
--        unit_cost is known; explicit $0 (not a fabricated market-derived
--        guess -- item 42/56's own philosophy) where it is not.
--      - backfill_capitalize_historical_upgrades(): business_upgrade_projects
--        rows (status completed/installing) purchased before Phase F's
--        purchase_business_upgrade_atomic (migration 107) existed, which
--        never wrote a fixed_assets financial event at all. Backfilled from
--        the project's own quoted_cost + started_at/applied_at -- reliably
--        reconstructable, not fabricated, per item 58's own preferred path
--        ("create a migration/backfill that creates opening... Fixed Assets
--        that can be reliably reconstructed").
--
--    No separate "Opening Equity / Historical Adjustment" account or backfill
--    step is needed for retained earnings, owner capital, or wages payable:
--    getIncomeStatement/getBalanceSheet (statements.ts) already derive those
--    from the *complete* history of business_financial_events/
--    business_accounts/employees.unpaid_wage_due, which existed before this
--    plan started (business_financial_events dates to migration 046) -- nothing
--    there needs seeding. Depreciation on the newly-backfilled fixed_assets
--    rows is computed analytically at report time from cost + acquisition
--    date (statements.ts's computeAccumulatedDepreciation has no persisted
--    state), so it applies correctly retroactively the moment the backfilled
--    event exists -- verified by hand against the plan's own math: a
--    business that spent $2,000 on an upgrade before Phase F, with no other
--    activity, is understated by exactly $2,000 on the Assets side before
--    this backfill (cash already debited, no fixed_assets event to offset
--    it) and exactly balanced afterward, whether the upgrade was acquired
--    yesterday (~$0 depreciation so far) or years ago (a large chunk of it
--    already depreciated through retained earnings).
--
-- Both backfill functions are called once at the bottom of this migration
-- (a safe no-op on a database with no pre-existing gaps, e.g. a fresh
-- `supabase db reset`) and are left in place, service_role-grantable, so they
-- can be re-run by hand against the hosted project after `db push` if any
-- gap surfaces there that a local dev reset never would have had.

-- ---------------------------------------------------------------------------
-- 1. reconcile_business_accounting
-- ---------------------------------------------------------------------------

create or replace function public.reconcile_business_accounting(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_stored_cash numeric;
  v_ledger_cash numeric;
  v_journal_debits numeric;
  v_journal_credits numeric;
  v_journal_entry_count integer;
  v_journal_unbalanced_entries integer;
  v_inventory_book_value numeric;
  v_inventory_zero_cost_rows integer;
  v_fixed_assets_total numeric;
  v_fixed_assets_event_count integer;
begin
  select cash_balance into v_stored_cash
  from public.businesses
  where id = p_business_id;

  if not found then
    raise exception 'Business % not found.', p_business_id;
  end if;

  select coalesce(sum(case when entry_type = 'credit' then amount else -amount end), 0)
  into v_ledger_cash
  from public.business_accounts
  where business_id = p_business_id;

  select coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(distinct entry_id)
  into v_journal_debits, v_journal_credits, v_journal_entry_count
  from public.business_journal_lines
  where business_id = p_business_id;

  -- Should always be 0 -- trg_journal_lines_balanced (migration 096) rejects
  -- an unbalanced entry at commit time. Included as a defensive sanity check,
  -- not because this is expected to ever fire.
  select count(*) into v_journal_unbalanced_entries
  from (
    select entry_id
    from public.business_journal_lines
    where business_id = p_business_id
    group by entry_id
    having round(sum(debit), 2) <> round(sum(credit), 2)
  ) unbalanced;

  select coalesce(sum(total_cost), 0),
         count(*) filter (where quantity > 0 and coalesce(total_cost, 0) = 0)
  into v_inventory_book_value, v_inventory_zero_cost_rows
  from public.business_inventory
  where business_id = p_business_id;

  select coalesce(sum(amount), 0), count(*)
  into v_fixed_assets_total, v_fixed_assets_event_count
  from public.business_financial_events
  where business_id = p_business_id
    and account_code = 'fixed_assets';

  return jsonb_build_object(
    'businessId', p_business_id,
    'asOf', now(),
    'cash', jsonb_build_object(
      'ledgerBalance', round(v_ledger_cash, 2),
      'storedBalance', round(coalesce(v_stored_cash, 0), 2),
      'discrepancy', round(v_ledger_cash - coalesce(v_stored_cash, 0), 2)
    ),
    'journal', jsonb_build_object(
      'debits', round(v_journal_debits, 2),
      'credits', round(v_journal_credits, 2),
      'discrepancy', round(v_journal_debits - v_journal_credits, 2),
      'entryCount', v_journal_entry_count,
      'unbalancedEntryCount', v_journal_unbalanced_entries
    ),
    'inventory', jsonb_build_object(
      'bookValue', round(v_inventory_book_value, 2),
      'zeroCostRowCount', v_inventory_zero_cost_rows
    ),
    'fixedAssets', jsonb_build_object(
      'total', round(v_fixed_assets_total, 2),
      'eventCount', v_fixed_assets_event_count
    )
  );
end;
$$;

revoke all on function public.reconcile_business_accounting(uuid) from public;
grant execute on function public.reconcile_business_accounting(uuid) to service_role;

comment on function public.reconcile_business_accounting is
  'AccountingFixPlan Phase H (item 53): read-only reconciliation report for one business -- cash ledger vs stored cash_balance, journal debits vs credits, inventory book value. Never repairs anything. Combined with getBalanceSheet/getCashFlowStatement in src/domains/businesses/reconciliation.ts for the full report (Assets=Liabilities+Equity, beginning+netCF=ending cash are already implemented once there, not re-derived in SQL).';

-- ---------------------------------------------------------------------------
-- 2a. backfill_reconstruct_inventory_cost_basis
-- ---------------------------------------------------------------------------

create or replace function public.backfill_reconstruct_inventory_cost_basis()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fixed integer;
begin
  with fixed as (
    update public.business_inventory
    set
      unit_cost = coalesce(unit_cost, 0),
      total_cost = round(coalesce(unit_cost, 0) * quantity, 2)
    where total_cost is null
      and quantity > 0
    returning id
  )
  select count(*) into v_fixed from fixed;

  return v_fixed;
end;
$$;

revoke all on function public.backfill_reconstruct_inventory_cost_basis() from public;
grant execute on function public.backfill_reconstruct_inventory_cost_basis() to service_role;

comment on function public.backfill_reconstruct_inventory_cost_basis is
  'AccountingFixPlan Phase H (item 58): one-time-per-row, idempotent backfill for business_inventory rows left with quantity > 0 and total_cost NULL by the pre-Phase-C SQL relief/addition bugs (migration 099 fixed this prospectively; this repairs any row that already existed with the gap). Reconstructs total_cost from unit_cost * quantity where a unit_cost is known, else explicit $0 -- never a fabricated market-derived guess. Safe to re-run; a clean row is left untouched.';

-- ---------------------------------------------------------------------------
-- 2b. backfill_capitalize_historical_upgrades
-- ---------------------------------------------------------------------------

create or replace function public.backfill_capitalize_historical_upgrades()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
  v_project record;
begin
  for v_project in
    select p.*
    from public.business_upgrade_projects p
    where p.project_status in ('completed', 'installing')
      and not exists (
        select 1
        from public.business_financial_events e
        where e.business_id = p.business_id
          and e.account_code = 'fixed_assets'
          and e.reference_type = 'upgrade_project'
          and e.reference_id = p.id
      )
  loop
    insert into public.business_financial_events (
      business_id, account_code, amount, reference_type, reference_id, description, effective_at, metadata
    ) values (
      v_project.business_id,
      'fixed_assets',
      v_project.quoted_cost,
      'upgrade_project',
      v_project.id,
      'Capitalized upgrade (historical backfill): ' || v_project.upgrade_key || ' Lv.' || v_project.target_level::text,
      coalesce(v_project.applied_at, v_project.started_at, v_project.created_at),
      jsonb_build_object('upgradeKey', v_project.upgrade_key, 'targetLevel', v_project.target_level, 'backfilled', true)
    );
    v_inserted := v_inserted + 1;
  end loop;

  return v_inserted;
end;
$$;

revoke all on function public.backfill_capitalize_historical_upgrades() from public;
grant execute on function public.backfill_capitalize_historical_upgrades() to service_role;

comment on function public.backfill_capitalize_historical_upgrades is
  'AccountingFixPlan Phase H (item 58): one-time-per-project, idempotent backfill of the fixed_assets financial event that purchase_business_upgrade_atomic (migration 107) started writing going forward. Covers any completed/installing business_upgrade_projects row purchased before that RPC existed. Guarded by a not-exists check against (account_code=''fixed_assets'', reference_type=''upgrade_project'', reference_id=project.id), so it is safe to re-run and will never double-insert for a project the atomic RPC (or a prior run of this function) already covered.';

-- ---------------------------------------------------------------------------
-- 3. Run both backfills once now. No-op on a database with no pre-existing
--    gaps (e.g. a fresh `supabase db reset`, or the hosted project once it
--    has run past Phase C/F's fixes for every row/project created since).
-- ---------------------------------------------------------------------------

select public.backfill_reconstruct_inventory_cost_basis();
select public.backfill_capitalize_historical_upgrades();

-- Migration complete: reconciliation RPC + idempotent historical backfills.
