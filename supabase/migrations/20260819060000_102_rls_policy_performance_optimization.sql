-- Supabase Advisor performance hardening, part 1: `auth_rls_initplan` +
-- `multiple_permissive_policies`.
--
-- auth_rls_initplan: every policy below calls `auth.uid()` (or, for
-- mail_thread_participants, the SECURITY DEFINER helper
-- `public.can_access_mail_thread(...)`) directly in its USING/WITH CHECK
-- clause. Postgres's planner cannot prove a bare function call is constant
-- for the statement, so it re-evaluates it once per row scanned instead of
-- once per statement. Wrapping the call as `(select auth.uid())` gives the
-- planner an InitPlan it can evaluate once and reuse -- this is Supabase's
-- documented pattern (see the migration's PR-linked docs) and changes
-- nothing about *which* rows are visible to *which* role, only how many
-- times the identity check runs.
--
-- Every policy is dropped and recreated with the exact same USING/WITH
-- CHECK predicate as its current live definition (verified against the
-- latest version of each policy across all 99 prior migrations, not the
-- original -- several of these tables had their policies already
-- drop+recreated by later hardening migrations, e.g. 057/058/068/096; using
-- an outdated definition here would silently regress that hardening). Only
-- the auth.uid()/can_access_mail_thread() call sites gain a `(select ...)`
-- wrapper -- no predicate logic changes.
--
-- multiple_permissive_policies: market_storefront_performance_snapshots had
-- two separate SELECT policies (owner, admin). Postgres already ORs
-- multiple permissive policies for the same command together, so the
-- current effective predicate is already
-- `owner_player_id = auth.uid() OR <admin check>` -- consolidating them into
-- one policy with that same OR'd predicate is semantically identical (same
-- rows visible to the same roles) and removes the double policy-evaluation
-- overhead the Advisor flagged.

-- ---------------------------------------------------------------------------
-- businesses
-- ---------------------------------------------------------------------------
drop policy if exists "businesses_select_own" on public.businesses;
create policy "businesses_select_own" on public.businesses for select using (player_id = (select auth.uid()));

drop policy if exists "businesses_insert_own" on public.businesses;
create policy "businesses_insert_own" on public.businesses for insert with check (player_id = (select auth.uid()));

drop policy if exists "businesses_update_own" on public.businesses;
create policy "businesses_update_own" on public.businesses for update using (player_id = (select auth.uid())) with check (player_id = (select auth.uid()));

drop policy if exists "businesses_delete_own" on public.businesses;
create policy "businesses_delete_own" on public.businesses for delete using (player_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- players
-- ---------------------------------------------------------------------------
drop policy if exists "players_select_own" on public.players;
create policy "players_select_own" on public.players for select using (id = (select auth.uid()));

drop policy if exists "players_insert_own" on public.players;
create policy "players_insert_own" on public.players for insert with check (id = (select auth.uid()));

drop policy if exists "players_update_own" on public.players;
create policy "players_update_own" on public.players for update using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- characters
-- ---------------------------------------------------------------------------
drop policy if exists "characters_select_own" on public.characters;
create policy "characters_select_own" on public.characters for select using (player_id = (select auth.uid()));

drop policy if exists "characters_insert_own" on public.characters;
create policy "characters_insert_own" on public.characters for insert with check (player_id = (select auth.uid()));

drop policy if exists "characters_update_own" on public.characters;
create policy "characters_update_own" on public.characters for update using (player_id = (select auth.uid())) with check (player_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- cities
-- ---------------------------------------------------------------------------
drop policy if exists "cities_select_authenticated" on public.cities;
create policy "cities_select_authenticated" on public.cities for select using ((select auth.uid()) is not null);

-- ---------------------------------------------------------------------------
-- travel_log
-- ---------------------------------------------------------------------------
drop policy if exists "travel_log_select_own" on public.travel_log;
create policy "travel_log_select_own" on public.travel_log for select using (player_id = (select auth.uid()));

drop policy if exists "travel_log_insert_own" on public.travel_log;
create policy "travel_log_insert_own" on public.travel_log for insert with check (player_id = (select auth.uid()));

drop policy if exists "travel_log_update_own" on public.travel_log;
create policy "travel_log_update_own" on public.travel_log for update using (player_id = (select auth.uid())) with check (player_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- shipping_queue
-- ---------------------------------------------------------------------------
drop policy if exists "shipping_queue_select_own" on public.shipping_queue;
create policy "shipping_queue_select_own" on public.shipping_queue for select using (owner_player_id = (select auth.uid()));

drop policy if exists "shipping_queue_insert_own" on public.shipping_queue;
create policy "shipping_queue_insert_own" on public.shipping_queue for insert with check (owner_player_id = (select auth.uid()));

drop policy if exists "shipping_queue_update_own" on public.shipping_queue;
create policy "shipping_queue_update_own" on public.shipping_queue for update using (owner_player_id = (select auth.uid())) with check (owner_player_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- bank_accounts
-- ---------------------------------------------------------------------------
drop policy if exists "bank_accounts_select_own" on public.bank_accounts;
create policy "bank_accounts_select_own" on public.bank_accounts for select using (player_id = (select auth.uid()));

drop policy if exists "bank_accounts_insert_own" on public.bank_accounts;
create policy "bank_accounts_insert_own" on public.bank_accounts for insert with check (player_id = (select auth.uid()));

drop policy if exists "bank_accounts_update_own" on public.bank_accounts;
create policy "bank_accounts_update_own" on public.bank_accounts for update using (player_id = (select auth.uid())) with check (player_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- transactions (transactions_insert_own was intentionally dropped by
-- migration 057 -- all inserts go through append_personal_transaction; do
-- not recreate it here)
-- ---------------------------------------------------------------------------
drop policy if exists "transactions_select_own" on public.transactions;
create policy "transactions_select_own" on public.transactions for select using (
  exists (select 1 from public.bank_accounts ba where ba.id = account_id and ba.player_id = (select auth.uid()))
);

-- ---------------------------------------------------------------------------
-- loans
-- ---------------------------------------------------------------------------
drop policy if exists "loans_select_own" on public.loans;
create policy "loans_select_own" on public.loans for select using (player_id = (select auth.uid()));

drop policy if exists "loans_insert_own" on public.loans;
create policy "loans_insert_own" on public.loans for insert with check (player_id = (select auth.uid()));

drop policy if exists "loans_update_own" on public.loans;
create policy "loans_update_own" on public.loans for update using (player_id = (select auth.uid())) with check (player_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- employees
-- ---------------------------------------------------------------------------
drop policy if exists "employees_select_own" on public.employees;
create policy "employees_select_own" on public.employees for select using (player_id = (select auth.uid()));

drop policy if exists "employees_insert_own" on public.employees;
create policy "employees_insert_own" on public.employees for insert with check (player_id = (select auth.uid()));

drop policy if exists "employees_update_own" on public.employees;
create policy "employees_update_own" on public.employees for update using (player_id = (select auth.uid())) with check (player_id = (select auth.uid()));

drop policy if exists "employees_delete_own" on public.employees;
create policy "employees_delete_own" on public.employees for delete using (player_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- personal_inventory
-- ---------------------------------------------------------------------------
drop policy if exists "personal_inventory_select_own" on public.personal_inventory;
create policy "personal_inventory_select_own" on public.personal_inventory for select using (player_id = (select auth.uid()));

drop policy if exists "personal_inventory_insert_own" on public.personal_inventory;
create policy "personal_inventory_insert_own" on public.personal_inventory for insert with check (player_id = (select auth.uid()));

drop policy if exists "personal_inventory_update_own" on public.personal_inventory;
create policy "personal_inventory_update_own" on public.personal_inventory for update using (player_id = (select auth.uid())) with check (player_id = (select auth.uid()));

drop policy if exists "personal_inventory_delete_own" on public.personal_inventory;
create policy "personal_inventory_delete_own" on public.personal_inventory for delete using (player_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- business_accounts (business_accounts_insert_own was intentionally dropped
-- by migration 057 -- do not recreate it)
-- ---------------------------------------------------------------------------
drop policy if exists "business_accounts_select_own" on public.business_accounts;
create policy "business_accounts_select_own" on public.business_accounts for select using (
  exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()))
);

-- ---------------------------------------------------------------------------
-- business_upgrades
-- ---------------------------------------------------------------------------
drop policy if exists "business_upgrades_select_own" on public.business_upgrades;
create policy "business_upgrades_select_own" on public.business_upgrades for select using (
  exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()))
);

drop policy if exists "business_upgrades_insert_own" on public.business_upgrades;
create policy "business_upgrades_insert_own" on public.business_upgrades for insert with check (
  exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()))
);

drop policy if exists "business_upgrades_update_own" on public.business_upgrades;
create policy "business_upgrades_update_own" on public.business_upgrades for update using (
  exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()))
) with check (
  exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()))
);

-- ---------------------------------------------------------------------------
-- employee_assignments
-- ---------------------------------------------------------------------------
drop policy if exists "employee_assignments_select_own" on public.employee_assignments;
create policy "employee_assignments_select_own" on public.employee_assignments for select using (
  exists (select 1 from public.employees e where e.id = employee_id and e.player_id = (select auth.uid()))
);

drop policy if exists "employee_assignments_insert_own" on public.employee_assignments;
create policy "employee_assignments_insert_own" on public.employee_assignments for insert with check (
  exists (select 1 from public.employees e where e.id = employee_id and e.player_id = (select auth.uid()))
  and exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()))
);

drop policy if exists "employee_assignments_update_own" on public.employee_assignments;
create policy "employee_assignments_update_own" on public.employee_assignments for update using (
  exists (select 1 from public.employees e where e.id = employee_id and e.player_id = (select auth.uid()))
) with check (
  exists (select 1 from public.employees e where e.id = employee_id and e.player_id = (select auth.uid()))
  and exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()))
);

drop policy if exists "employee_assignments_delete_own" on public.employee_assignments;
create policy "employee_assignments_delete_own" on public.employee_assignments for delete using (
  exists (select 1 from public.employees e where e.id = employee_id and e.player_id = (select auth.uid()))
);

-- ---------------------------------------------------------------------------
-- employee_skills
-- ---------------------------------------------------------------------------
drop policy if exists "employee_skills_select_own" on public.employee_skills;
create policy "employee_skills_select_own" on public.employee_skills for select using (
  exists (select 1 from public.employees e where e.id = employee_id and e.player_id = (select auth.uid()))
);

drop policy if exists "employee_skills_insert_own" on public.employee_skills;
create policy "employee_skills_insert_own" on public.employee_skills for insert with check (
  exists (select 1 from public.employees e where e.id = employee_id and e.player_id = (select auth.uid()))
);

drop policy if exists "employee_skills_update_own" on public.employee_skills;
create policy "employee_skills_update_own" on public.employee_skills for update using (
  exists (select 1 from public.employees e where e.id = employee_id and e.player_id = (select auth.uid()))
) with check (
  exists (select 1 from public.employees e where e.id = employee_id and e.player_id = (select auth.uid()))
);

drop policy if exists "employee_skills_delete_own" on public.employee_skills;
create policy "employee_skills_delete_own" on public.employee_skills for delete using (
  exists (select 1 from public.employees e where e.id = employee_id and e.player_id = (select auth.uid()))
);

-- ---------------------------------------------------------------------------
-- extraction_slots
-- ---------------------------------------------------------------------------
drop policy if exists "extraction_slots_select_own" on public.extraction_slots;
create policy "extraction_slots_select_own" on public.extraction_slots for select using (
  exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()))
);

drop policy if exists "extraction_slots_insert_own" on public.extraction_slots;
create policy "extraction_slots_insert_own" on public.extraction_slots for insert with check (
  exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()))
);

drop policy if exists "extraction_slots_update_own" on public.extraction_slots;
create policy "extraction_slots_update_own" on public.extraction_slots for update using (
  exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()))
) with check (
  exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()))
);

drop policy if exists "extraction_slots_delete_own" on public.extraction_slots;
create policy "extraction_slots_delete_own" on public.extraction_slots for delete using (
  exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()))
);

-- ---------------------------------------------------------------------------
-- tool_durability
-- ---------------------------------------------------------------------------
drop policy if exists "tool_durability_select_own" on public.tool_durability;
create policy "tool_durability_select_own" on public.tool_durability for select using (
  exists (select 1 from public.extraction_slots es join public.businesses b on b.id = es.business_id
          where es.id = extraction_slot_id and b.player_id = (select auth.uid()))
);

drop policy if exists "tool_durability_insert_own" on public.tool_durability;
create policy "tool_durability_insert_own" on public.tool_durability for insert with check (
  exists (select 1 from public.extraction_slots es join public.businesses b on b.id = es.business_id
          where es.id = extraction_slot_id and b.player_id = (select auth.uid()))
);

drop policy if exists "tool_durability_update_own" on public.tool_durability;
create policy "tool_durability_update_own" on public.tool_durability for update using (
  exists (select 1 from public.extraction_slots es join public.businesses b on b.id = es.business_id
          where es.id = extraction_slot_id and b.player_id = (select auth.uid()))
) with check (
  exists (select 1 from public.extraction_slots es join public.businesses b on b.id = es.business_id
          where es.id = extraction_slot_id and b.player_id = (select auth.uid()))
);

drop policy if exists "tool_durability_delete_own" on public.tool_durability;
create policy "tool_durability_delete_own" on public.tool_durability for delete using (
  exists (select 1 from public.extraction_slots es join public.businesses b on b.id = es.business_id
          where es.id = extraction_slot_id and b.player_id = (select auth.uid()))
);

-- ---------------------------------------------------------------------------
-- manufacturing_jobs
-- ---------------------------------------------------------------------------
drop policy if exists "manufacturing_jobs_select_own" on public.manufacturing_jobs;
create policy "manufacturing_jobs_select_own" on public.manufacturing_jobs for select using (
  exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()))
);

drop policy if exists "manufacturing_jobs_insert_own" on public.manufacturing_jobs;
create policy "manufacturing_jobs_insert_own" on public.manufacturing_jobs for insert with check (
  exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()))
);

drop policy if exists "manufacturing_jobs_update_own" on public.manufacturing_jobs;
create policy "manufacturing_jobs_update_own" on public.manufacturing_jobs for update using (
  exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()))
) with check (
  exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()))
);

drop policy if exists "manufacturing_jobs_delete_own" on public.manufacturing_jobs;
create policy "manufacturing_jobs_delete_own" on public.manufacturing_jobs for delete using (
  exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()))
);

-- ---------------------------------------------------------------------------
-- contracts
-- ---------------------------------------------------------------------------
drop policy if exists "contracts_select_own" on public.contracts;
create policy "contracts_select_own" on public.contracts for select using (owner_player_id = (select auth.uid()));

drop policy if exists "contracts_insert_own" on public.contracts;
create policy "contracts_insert_own" on public.contracts for insert with check (
  owner_player_id = (select auth.uid())
  and exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()))
);

drop policy if exists "contracts_update_own" on public.contracts;
create policy "contracts_update_own" on public.contracts for update using (owner_player_id = (select auth.uid())) with check (
  owner_player_id = (select auth.uid())
  and exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()))
);

drop policy if exists "contracts_delete_own" on public.contracts;
create policy "contracts_delete_own" on public.contracts for delete using (owner_player_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- market_listings (insert_own/update_own use the current live definitions
-- from migration 058 -- personal-inventory-sourced listings -- not the
-- original 022 versions)
-- ---------------------------------------------------------------------------
drop policy if exists "market_listings_select_authenticated" on public.market_listings;
create policy "market_listings_select_authenticated" on public.market_listings for select using (
  (select auth.uid()) is not null and (status = 'active' or owner_player_id = (select auth.uid()))
);

drop policy if exists "market_listings_insert_own" on public.market_listings;
create policy "market_listings_insert_own" on public.market_listings for insert with check (
  owner_player_id = (select auth.uid())
  and (
    (source_type = 'business' and exists (select 1 from public.businesses b where b.id = source_business_id and b.player_id = (select auth.uid())))
    or (source_type = 'personal' and owner_player_id = (select auth.uid()))
  )
);

drop policy if exists "market_listings_update_own" on public.market_listings;
create policy "market_listings_update_own" on public.market_listings for update using (owner_player_id = (select auth.uid())) with check (
  owner_player_id = (select auth.uid())
  and (
    (source_type = 'business' and exists (select 1 from public.businesses b where b.id = source_business_id and b.player_id = (select auth.uid())))
    or source_type = 'personal'
  )
);

drop policy if exists "market_listings_delete_own" on public.market_listings;
create policy "market_listings_delete_own" on public.market_listings for delete using (owner_player_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- market_transactions (market_transactions_insert_authenticated was
-- intentionally dropped and replaced by a service_role-only insert policy in
-- migration 068 -- do not recreate the authenticated insert policy)
-- ---------------------------------------------------------------------------
drop policy if exists "market_transactions_select_party" on public.market_transactions;
create policy "market_transactions_select_party" on public.market_transactions for select using (
  seller_player_id = (select auth.uid()) or buyer_player_id = (select auth.uid())
);

-- ---------------------------------------------------------------------------
-- market_storefront_settings
-- ---------------------------------------------------------------------------
drop policy if exists "market_storefront_settings_select_own" on public.market_storefront_settings;
create policy "market_storefront_settings_select_own" on public.market_storefront_settings for select using (owner_player_id = (select auth.uid()));

drop policy if exists "market_storefront_settings_insert_own" on public.market_storefront_settings;
create policy "market_storefront_settings_insert_own" on public.market_storefront_settings for insert with check (
  owner_player_id = (select auth.uid())
  and exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()))
);

drop policy if exists "market_storefront_settings_update_own" on public.market_storefront_settings;
create policy "market_storefront_settings_update_own" on public.market_storefront_settings for update using (owner_player_id = (select auth.uid())) with check (
  owner_player_id = (select auth.uid())
  and exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()))
);

drop policy if exists "market_storefront_settings_delete_own" on public.market_storefront_settings;
create policy "market_storefront_settings_delete_own" on public.market_storefront_settings for delete using (owner_player_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- tick_run_logs
-- ---------------------------------------------------------------------------
drop policy if exists "tick_run_logs_select_authenticated" on public.tick_run_logs;
create policy "tick_run_logs_select_authenticated" on public.tick_run_logs for select using ((select auth.uid()) is not null);

-- ---------------------------------------------------------------------------
-- market_storefront_performance_snapshots -- consolidate the owner + admin
-- SELECT policies into one OR'd policy (multiple_permissive_policies fix).
-- Postgres already ORs multiple permissive policies for the same command,
-- so this is the exact same effective predicate as today, evaluated once
-- instead of twice.
-- ---------------------------------------------------------------------------
drop policy if exists "market_storefront_snapshots_select_owner" on public.market_storefront_performance_snapshots;
drop policy if exists "market_storefront_snapshots_select_admin" on public.market_storefront_performance_snapshots;

create policy "market_storefront_snapshots_select_owner_or_admin"
  on public.market_storefront_performance_snapshots
  for select
  using (
    owner_player_id = (select auth.uid())
    or exists (
      select 1
      from public.players p
      where p.id = (select auth.uid())
        and p.role = 'admin'
    )
  );

-- ---------------------------------------------------------------------------
-- store_shelf_items
-- ---------------------------------------------------------------------------
drop policy if exists "store_shelf_items_select_own" on public.store_shelf_items;
create policy "store_shelf_items_select_own" on public.store_shelf_items for select using ((select auth.uid()) = owner_player_id);

drop policy if exists "store_shelf_items_insert_own" on public.store_shelf_items;
create policy "store_shelf_items_insert_own" on public.store_shelf_items for insert with check (
  (select auth.uid()) = owner_player_id
  and exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()) and b.type in ('general_store', 'specialty_store'))
);

drop policy if exists "store_shelf_items_update_own" on public.store_shelf_items;
create policy "store_shelf_items_update_own" on public.store_shelf_items for update using ((select auth.uid()) = owner_player_id) with check (
  (select auth.uid()) = owner_player_id
  and exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()) and b.type in ('general_store', 'specialty_store'))
);

drop policy if exists "store_shelf_items_delete_own" on public.store_shelf_items;
create policy "store_shelf_items_delete_own" on public.store_shelf_items for delete using ((select auth.uid()) = owner_player_id);

-- ---------------------------------------------------------------------------
-- player_presence
-- ---------------------------------------------------------------------------
drop policy if exists "player_presence_select_own" on public.player_presence;
create policy "player_presence_select_own" on public.player_presence for select using (player_id = (select auth.uid()));

drop policy if exists "player_presence_insert_own" on public.player_presence;
create policy "player_presence_insert_own" on public.player_presence for insert with check (player_id = (select auth.uid()));

drop policy if exists "player_presence_update_own" on public.player_presence;
create policy "player_presence_update_own" on public.player_presence for update using (player_id = (select auth.uid())) with check (player_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- chat_messages
-- ---------------------------------------------------------------------------
drop policy if exists "chat_messages_select_authenticated" on public.chat_messages;
create policy "chat_messages_select_authenticated" on public.chat_messages for select using ((select auth.uid()) is not null);

-- ---------------------------------------------------------------------------
-- business_financial_events (business_financial_events_insert_own was
-- intentionally dropped by migration 057 -- do not recreate it)
-- ---------------------------------------------------------------------------
drop policy if exists "business_financial_events_select_own" on public.business_financial_events;
create policy "business_financial_events_select_own" on public.business_financial_events for select using (
  exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()))
);

-- ---------------------------------------------------------------------------
-- business_upgrade_projects
-- ---------------------------------------------------------------------------
drop policy if exists "business_upgrade_projects_select_own" on public.business_upgrade_projects;
create policy "business_upgrade_projects_select_own" on public.business_upgrade_projects for select using (
  exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()))
);

drop policy if exists "business_upgrade_projects_insert_own" on public.business_upgrade_projects;
create policy "business_upgrade_projects_insert_own" on public.business_upgrade_projects for insert with check (
  exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()))
);

drop policy if exists "business_upgrade_projects_update_own" on public.business_upgrade_projects;
create policy "business_upgrade_projects_update_own" on public.business_upgrade_projects for update using (
  exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()))
) with check (
  exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()))
);

-- ---------------------------------------------------------------------------
-- manufacturing_lines
-- ---------------------------------------------------------------------------
drop policy if exists "manufacturing_lines_select_own" on public.manufacturing_lines;
create policy "manufacturing_lines_select_own" on public.manufacturing_lines for select using (
  exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()))
);

drop policy if exists "manufacturing_lines_insert_own" on public.manufacturing_lines;
create policy "manufacturing_lines_insert_own" on public.manufacturing_lines for insert with check (
  exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()))
);

drop policy if exists "manufacturing_lines_update_own" on public.manufacturing_lines;
create policy "manufacturing_lines_update_own" on public.manufacturing_lines for update using (
  exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()))
) with check (
  exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()))
);

drop policy if exists "manufacturing_lines_delete_own" on public.manufacturing_lines;
create policy "manufacturing_lines_delete_own" on public.manufacturing_lines for delete using (
  exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()))
);

-- ---------------------------------------------------------------------------
-- business_inventory (current live definitions from migration 057 -- note
-- the exists subquery compares b.player_id to business_inventory.owner_player_id,
-- not auth.uid() again, so only the leading owner_player_id check needs
-- wrapping)
-- ---------------------------------------------------------------------------
drop policy if exists "business_inventory_select_own" on public.business_inventory;
create policy "business_inventory_select_own" on public.business_inventory for select using (
  owner_player_id = (select auth.uid())
  and exists (select 1 from public.businesses b where b.id = business_inventory.business_id and b.player_id = business_inventory.owner_player_id)
);

drop policy if exists "business_inventory_insert_own" on public.business_inventory;
create policy "business_inventory_insert_own" on public.business_inventory for insert with check (
  owner_player_id = (select auth.uid())
  and exists (select 1 from public.businesses b where b.id = business_inventory.business_id and b.player_id = business_inventory.owner_player_id)
);

drop policy if exists "business_inventory_update_own" on public.business_inventory;
create policy "business_inventory_update_own" on public.business_inventory for update using (
  owner_player_id = (select auth.uid())
  and exists (select 1 from public.businesses b where b.id = business_inventory.business_id and b.player_id = business_inventory.owner_player_id)
) with check (
  owner_player_id = (select auth.uid())
  and exists (select 1 from public.businesses b where b.id = business_inventory.business_id and b.player_id = business_inventory.owner_player_id)
);

drop policy if exists "business_inventory_delete_own" on public.business_inventory;
create policy "business_inventory_delete_own" on public.business_inventory for delete using (
  owner_player_id = (select auth.uid())
  and exists (select 1 from public.businesses b where b.id = business_inventory.business_id and b.player_id = business_inventory.owner_player_id)
);

-- ---------------------------------------------------------------------------
-- mail_thread_participants (select policy routes through the SECURITY
-- DEFINER helper can_access_mail_thread(), not a bare auth.uid() call --
-- wrap the whole function call, which gets the identical InitPlan benefit)
-- ---------------------------------------------------------------------------
drop policy if exists "mail_thread_participants_select_visible_thread" on public.mail_thread_participants;
create policy "mail_thread_participants_select_visible_thread" on public.mail_thread_participants for select using ((select public.can_access_mail_thread(thread_id)));

drop policy if exists "mail_thread_participants_update_self" on public.mail_thread_participants;
create policy "mail_thread_participants_update_self" on public.mail_thread_participants for update using (player_id = (select auth.uid())) with check (player_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- player_chat_state
-- ---------------------------------------------------------------------------
drop policy if exists "player_chat_state_select_own" on public.player_chat_state;
create policy "player_chat_state_select_own" on public.player_chat_state for select using ((select auth.uid()) = player_id);

-- ---------------------------------------------------------------------------
-- market_buy_orders
-- ---------------------------------------------------------------------------
drop policy if exists "market_buy_orders_select_active_or_own" on public.market_buy_orders;
create policy "market_buy_orders_select_active_or_own" on public.market_buy_orders for select using (status = 'active' or owner_player_id = (select auth.uid()));

drop policy if exists "market_buy_orders_insert_own" on public.market_buy_orders;
create policy "market_buy_orders_insert_own" on public.market_buy_orders for insert with check (
  owner_player_id = (select auth.uid())
  and (
    (purchaser_type = 'business' and exists (select 1 from public.businesses b where b.id = purchaser_business_id and b.player_id = (select auth.uid())))
    or purchaser_type = 'personal'
  )
);

drop policy if exists "market_buy_orders_update_own" on public.market_buy_orders;
create policy "market_buy_orders_update_own" on public.market_buy_orders for update using (owner_player_id = (select auth.uid())) with check (owner_player_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- business_journal_entries
-- ---------------------------------------------------------------------------
drop policy if exists "business_journal_entries_select_own" on public.business_journal_entries;
create policy "business_journal_entries_select_own" on public.business_journal_entries for select using (
  exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()))
);

-- ---------------------------------------------------------------------------
-- business_journal_lines
-- ---------------------------------------------------------------------------
drop policy if exists "business_journal_lines_select_own" on public.business_journal_lines;
create policy "business_journal_lines_select_own" on public.business_journal_lines for select using (
  exists (select 1 from public.businesses b where b.id = business_id and b.player_id = (select auth.uid()))
);
