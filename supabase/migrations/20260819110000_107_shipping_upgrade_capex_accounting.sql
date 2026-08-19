-- AccountingFixPlan Phase F: shipping/upgrades/loans/owner equity.
--
-- Loans (item 52) and owner equity (item 51) needed no code changes here --
-- audited both before touching anything, per the plan's own rule:
--   - Loans are personal-only by design (src/domains/banking/DOMAIN.md: "all
--     personal money movement and personal loan lifecycle logic"; the
--     `loans` table is keyed by player_id with no business_id anywhere, and
--     create_loan_for_player / pay_loan_from_checking never touch a
--     business). There is no business-level borrowing to fabricate a
--     loan_payable balance sheet line for. Documented here per item 52's own
--     fallback instruction rather than invented.
--   - Owner equity (item 51) was already fully correct as of Phase A:
--     transfer_between_personal_and_business posts owner_transfer_in/
--     owner_transfer_out (owner_equity/owner_draw classified in
--     src/config/finance.ts) with zero revenue/COGS/expense events, and
--     test/finance/owner-funding.test.ts already asserts the plan's own
--     $100,000-deposit example end to end. Nothing to fix.
--
-- The two real gaps closed by this migration:
--
-- 1. Item 46 (upgrades/capex): purchaseUpgrade() (src/domains/businesses/
--    service.ts) created the business_upgrade_projects row and debited cash
--    as two separate non-transactional round trips, and never wrote any
--    financial event at all -- a durable upgrade purchase was
--    indistinguishable from a one-time consumable expense on every report.
--    New RPC purchase_business_upgrade_atomic capitalizes the purchase
--    (Debit Fixed Assets / Credit Cash) in one transaction: project insert +
--    business_accounts debit + a `fixed_assets` business_financial_events
--    row. Every upgrade in this game (src/config/business-upgrades.ts) is a
--    permanent, leveled, install-time-gated business improvement -- there is
--    no "consumable/temporary upgrade" concept here to carve out as
--    operating expense (the plan explicitly allows that carve-out only
--    "where appropriate"; it isn't, in this catalog), so every upgrade
--    purchase capitalizes.
-- 2. Item 45 (shipping): execute_due_shipping_deliveries (migration 047,
--    unchanged since) delivered B2B cross-city inventory at
--    declared_unit_price only -- the inbound freight charged at dispatch
--    (business_accounts `shipping_fee` debit against the destination
--    business, already correct and left untouched) never folded into the
--    delivered inventory's cost basis. Now, only when declared_unit_price is
--    not null (the B2B signal -- personal-involved transfers have no
--    acquisition-price concept and are deliberately left untouched, matching
--    migration 106's own B2B-only scoping for item 44), landed unit cost =
--    purchase price + attributable inbound freight (the shipping_queue
--    row's own `cost` column, already 1:1 with this delivery batch).

-- ---------------------------------------------------------------------------
-- business_financial_events: widen account_code CHECK for fixed_assets.
-- Same reason as migration 098's payroll_expense/wages_payable widening --
-- this constraint (migration 046, predates the Chart of Accounts) doesn't
-- derive from a shared source of truth and must be widened by hand whenever
-- a new CHART_OF_ACCOUNTS code needs to be written here.
-- ---------------------------------------------------------------------------

alter table public.business_financial_events
  drop constraint business_financial_events_account_code_check;

alter table public.business_financial_events
  add constraint business_financial_events_account_code_check
  check (
    account_code in (
      'inventory',
      'cogs',
      'revenue',
      'operating_expense',
      'owner_equity',
      'owner_draw',
      'payroll_expense',
      'wages_payable',
      'fixed_assets'
    )
  );

-- ---------------------------------------------------------------------------
-- purchase_business_upgrade_atomic
-- ---------------------------------------------------------------------------

create or replace function public.purchase_business_upgrade_atomic(
  p_player_id uuid,
  p_business_id uuid,
  p_upgrade_key text,
  p_target_level integer,
  p_quoted_cost numeric,
  p_downtime_policy text,
  p_install_time_minutes integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business public.businesses%rowtype;
  v_balance numeric;
  v_now timestamptz := now();
  v_cost numeric;
  v_project public.business_upgrade_projects%rowtype;
begin
  if p_player_id is null then
    raise exception 'player_id is required.';
  end if;

  select * into v_business
  from public.businesses
  where id = p_business_id
  for update;

  if not found or v_business.player_id <> p_player_id then
    raise exception 'Business not found.';
  end if;

  if p_quoted_cost is null or p_quoted_cost < 0 then
    raise exception 'Quoted cost must be non-negative.';
  end if;

  v_cost := round(p_quoted_cost::numeric, 2);

  select public.get_business_account_balance(p_business_id) into v_balance;

  if coalesce(v_balance, 0) < v_cost then
    raise exception 'Insufficient business funds. Upgrade cost is $%, and balance is $%.',
      to_char(v_cost, 'FM9999999990.00'),
      to_char(coalesce(v_balance, 0), 'FM9999999990.00');
  end if;

  begin
    insert into public.business_upgrade_projects (
      business_id, upgrade_key, target_level, project_status, quoted_cost,
      started_at, completes_at, applied_at, downtime_policy
    )
    values (
      p_business_id, p_upgrade_key, p_target_level, 'installing', v_cost,
      v_now, v_now + make_interval(mins => greatest(0, coalesce(p_install_time_minutes, 0))), null, p_downtime_policy
    )
    returning * into v_project;
  exception when unique_violation then
    raise exception 'This business already has an active capital project.';
  end;

  insert into public.business_accounts (business_id, amount, entry_type, category, reference_id, description)
  values (
    p_business_id, v_cost, 'debit', 'upgrade_purchase', v_project.id,
    'Upgrade project funded: ' || p_upgrade_key || ' Lv.' || p_target_level::text
  );

  insert into public.business_financial_events (business_id, account_code, amount, reference_type, reference_id, description, metadata)
  values (
    p_business_id, 'fixed_assets', v_cost, 'upgrade_project', v_project.id,
    'Capitalized upgrade: ' || p_upgrade_key || ' Lv.' || p_target_level::text,
    jsonb_build_object('upgradeKey', p_upgrade_key, 'targetLevel', p_target_level)
  );

  return jsonb_build_object(
    'project', to_jsonb(v_project),
    'debitedAmount', v_cost,
    'resultingBalance', round(coalesce(v_balance, 0) - v_cost, 2)
  );
end;
$$;

revoke all on function public.purchase_business_upgrade_atomic(uuid, uuid, text, integer, numeric, text, integer) from public;
grant execute on function public.purchase_business_upgrade_atomic(uuid, uuid, text, integer, numeric, text, integer) to service_role;

comment on function public.purchase_business_upgrade_atomic is
  'AccountingFixPlan Phase F (item 46): atomically creates the upgrade project, debits cash, and capitalizes the cost as a fixed_assets financial event -- one transaction, replacing the prior two-round-trip createUpgradeProject + addBusinessAccountEntry sequence. The one-active-project-per-business unique index (idx_business_upgrade_projects_one_active) is the real race guard; the unique_violation catch here just turns a concurrent double-purchase into the same friendly error purchaseUpgrade used to raise from a separate pre-check.';

-- ---------------------------------------------------------------------------
-- execute_due_shipping_deliveries -- capitalize inbound freight into the
-- delivered inventory's cost basis for B2B deliveries.
-- ---------------------------------------------------------------------------

create or replace function public.execute_due_shipping_deliveries(
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_row public.shipping_queue%rowtype;
  v_existing_personal public.personal_inventory%rowtype;
  v_existing_business public.business_inventory%rowtype;
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 2000));
  v_processed integer := 0;
  v_delivered_personal integer := 0;
  v_delivered_business integer := 0;
  v_added_total_cost numeric := 0;
  v_existing_quantity integer := 0;
  v_existing_total_cost numeric := 0;
  v_next_total_cost numeric := 0;
  v_next_unit_cost numeric := 0;
begin
  for v_row in
    select *
    from public.shipping_queue
    where status = 'in_transit'
      and arrives_at <= v_now
    order by arrives_at asc
    for update skip locked
    limit v_limit
  loop
    if v_row.destination_type = 'personal' then
      select * into v_existing_personal
      from public.personal_inventory
      where player_id = v_row.owner_player_id
        and item_key = v_row.item_key
        and quality = v_row.quality
      for update;

      if not found then
        insert into public.personal_inventory (player_id, item_key, quantity, quality)
        values (v_row.owner_player_id, v_row.item_key, v_row.quantity, v_row.quality);
      else
        update public.personal_inventory
        set quantity = v_existing_personal.quantity + v_row.quantity, updated_at = v_now
        where id = v_existing_personal.id;
      end if;

      v_delivered_personal := v_delivered_personal + 1;
    else
      select * into v_existing_business
      from public.business_inventory
      where owner_player_id = v_row.owner_player_id
        and business_id = v_row.destination_id
        and item_key = v_row.item_key
        and quality = v_row.quality
      for update;

      -- Landed cost (item 45): for a B2B acquisition (declared_unit_price is
      -- only ever set for business-to-business transfers -- see
      -- execute_inventory_transfer), the delivered inventory's cost basis is
      -- purchase price + attributable inbound freight, not purchase price
      -- alone. Computed as an exact dollar total (not derived by multiplying
      -- a rounded per-unit cost back out) so it never drifts a cent from
      -- declared_unit_price * quantity + shipping_queue.cost -- see item 56
      -- ("treat total_cost as authoritative and derive display unit cost
      -- from it", not the other way around). Personal-involved transfers
      -- have no acquisition-price concept and keep their pre-existing
      -- untouched cost basis.
      v_added_total_cost := case
        when v_row.declared_unit_price is null then 0
        else round(v_row.quantity * v_row.declared_unit_price, 2) + coalesce(v_row.cost, 0)
      end;

      if not found then
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
          v_row.owner_player_id,
          v_row.destination_id,
          v_row.to_city_id,
          v_row.item_key,
          v_row.quantity,
          v_row.quality,
          0,
          case when v_row.declared_unit_price is null then null else round(v_added_total_cost / v_row.quantity, 2) end,
          case when v_row.declared_unit_price is null then null else v_added_total_cost end
        );
      else
        v_existing_quantity := greatest(0, v_existing_business.quantity);
        v_existing_total_cost := coalesce(v_existing_business.total_cost, v_existing_quantity * coalesce(v_existing_business.unit_cost, 0));
        v_next_total_cost := round(v_existing_total_cost + v_added_total_cost, 2);
        v_next_unit_cost := case
          when (v_existing_quantity + v_row.quantity) > 0 and v_row.declared_unit_price is not null
            then round(v_next_total_cost / (v_existing_quantity + v_row.quantity), 2)
          else v_existing_business.unit_cost
        end;

        update public.business_inventory
        set
          quantity = v_existing_business.quantity + v_row.quantity,
          unit_cost = v_next_unit_cost,
          total_cost = case when v_row.declared_unit_price is null then v_existing_business.total_cost else v_next_total_cost end,
          updated_at = v_now
        where id = v_existing_business.id;
      end if;

      if v_row.declared_unit_price is not null then
        insert into public.business_financial_events (
          business_id,
          account_code,
          amount,
          quantity,
          item_key,
          reference_type,
          reference_id,
          description,
          effective_at,
          metadata
        )
        values (
          v_row.destination_id,
          'inventory',
          v_added_total_cost,
          v_row.quantity,
          v_row.item_key,
          'inventory_transfer',
          v_row.id,
          'Inventory acquired by transfer (landed cost incl. freight): ' || v_row.quantity::text || 'x ' || v_row.item_key,
          v_now,
          jsonb_build_object('direction', 'in', 'delivered_from_shipping', true, 'freightCapitalized', coalesce(v_row.cost, 0))
        );
      end if;

      v_delivered_business := v_delivered_business + 1;
    end if;

    update public.shipping_queue
    set status = 'delivered'
    where id = v_row.id and status = 'in_transit';

    v_processed := v_processed + 1;
  end loop;

  return jsonb_build_object(
    'processed', v_processed,
    'deliveredPersonal', v_delivered_personal,
    'deliveredBusiness', v_delivered_business
  );
end;
$$;

revoke all on function public.execute_due_shipping_deliveries(integer) from public, anon, authenticated, service_role;
grant execute on function public.execute_due_shipping_deliveries(integer) to service_role;

comment on function public.execute_due_shipping_deliveries is
  'AccountingFixPlan Phase F (item 45): delivers due shipping_queue rows. For B2B deliveries (declared_unit_price is not null), the delivered inventory''s cost basis is landed cost = purchase price + attributable inbound freight (shipping_queue.cost), computed as an exact dollar total rather than reconstructed from a rounded unit cost. Personal-involved transfers are unchanged (no acquisition-price/cost-basis concept for personal_inventory).';
