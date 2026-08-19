-- Supabase Advisor security hardening, part 1: explicit function EXECUTE
-- privilege model.
--
-- The Advisor report (Documents/Plans/SupabaseReport.md) flags ~66 functions
-- as `anon_security_definer_function_executable` /
-- `authenticated_security_definer_function_executable` -- i.e. callable via
-- PostgREST (`/rest/v1/rpc/<fn>`) by roles that were never meant to call
-- them directly. This happens because Postgres grants EXECUTE on a new
-- function to PUBLIC by default unless a migration explicitly revokes it,
-- and this repo has never had a schema-wide default that turns that off (see
-- the ALTER DEFAULT PRIVILEGES statement at the bottom of this file).
--
-- This migration audits every one of those functions by actual caller
-- (grepped every `.rpc(...)` call in src/, every Edge Function, and every
-- nested SQL call inside other SECURITY DEFINER functions) and assigns each
-- one to exactly the role(s) that legitimately need it:
--
--   A. anon        -- pre-login/public-facing (login, register, homepage stats)
--   B. authenticated + service_role -- player-facing RPCs called through the
--      app's own per-request client (which always carries the player's
--      session JWT). service_role is additionally granted on every one of
--      these: it is already a fully trusted role that bypasses RLS on every
--      table, so it is never a security regression for it to also call a
--      player-facing RPC directly, and both the finance integration test
--      suite (test/finance/*, e.g. fundBusinessFromOwner) and some
--      server-side fixture/admin paths rely on being able to invoke these
--      RPCs via the service-role client without minting a per-player JWT.
--   C. service_role only -- server-authoritative helpers called only via the
--      service-role client (tick edge functions, internal ledger writers) or
--      nested-only nowhere-else-called internal helpers, kept accessible to
--      service_role for admin/debug tooling. These must NOT also be granted
--      to authenticated -- that is the actual vulnerability class this
--      migration exists to close (see append_personal_transaction et al.).
--   D. trigger-only -- pure trigger functions with no legitimate direct
--      caller at all; these get no grant beyond the implicit owner access
--      triggers already have (firing a trigger never checks the triggering
--      statement's role for EXECUTE on the trigger function)
--
-- Every statement below is written as an unconditional
-- `revoke ... from public, anon, authenticated, service_role` followed by an
-- explicit re-grant, so the resulting privilege state is fully deterministic
-- regardless of whatever a given environment's history left in place (some
-- of these -- append_personal_transaction, append_business_account_entry,
-- append_business_financial_event, acquire_tick_lock, release_tick_lock --
-- were already correctly restricted by earlier migrations; they are
-- reasserted here so this file is a complete, self-contained source of
-- truth for the whole audited set, not a diff against assumed prior state).
--
-- Deliberately NOT touched here: functions the Advisor did not flag (e.g.
-- get_storefront_transaction_aggregate*, which already has a scoped
-- `authenticated`-only grant from its own migration -- see 101 for its
-- search_path fix) and a full schema-wide
-- `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC`, which
-- would also hit functions never audited here and risk silently breaking
-- gameplay. Scope is exactly the Advisor's flagged set plus the trigger
-- functions that set inherited from it.

-- ---------------------------------------------------------------------------
-- A. Intentionally public (anon) RPCs -- pre-authentication entry points.
-- ---------------------------------------------------------------------------

revoke execute on function public.authenticate_player(text, text) from public, anon, authenticated, service_role;
grant execute on function public.authenticate_player(text, text) to anon;

revoke execute on function public.register_player(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.register_player(text, text, text) to anon;

-- Login-page public stats (players/businesses/online counts) are shown
-- before a session exists, and remain harmless to read while logged in.
revoke execute on function public.get_public_simulation_stats() from public, anon, authenticated, service_role;
grant execute on function public.get_public_simulation_stats() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- B. Authenticated player-facing RPCs -- called by the app's own
--    per-request, session-JWT-carrying client (src/lib/supabase-server.ts).
--    Also granted to service_role (see the file header for why).
-- ---------------------------------------------------------------------------

revoke execute on function public.accept_contract_atomic(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.accept_contract_atomic(uuid, uuid) to authenticated, service_role;

revoke execute on function public.assign_employee_atomic(uuid, uuid, uuid, text, integer, numeric, text) from public, anon, authenticated, service_role;
grant execute on function public.assign_employee_atomic(uuid, uuid, uuid, text, integer, numeric, text) to authenticated, service_role;

revoke execute on function public.assign_extraction_slot_worker_atomic(uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.assign_extraction_slot_worker_atomic(uuid, uuid, uuid) to authenticated, service_role;

revoke execute on function public.assign_manufacturing_line_worker_atomic(uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.assign_manufacturing_line_worker_atomic(uuid, uuid, uuid) to authenticated, service_role;

-- Used inside the mail_thread_participants RLS policy
-- (mail_thread_participants_select_visible_thread); PostgREST/RLS policy
-- evaluation checks EXECUTE against the *querying* role, so this must stay
-- authenticated-executable for player mail queries to work at all.
revoke execute on function public.can_access_mail_thread(uuid) from public, anon, authenticated, service_role;
grant execute on function public.can_access_mail_thread(uuid) to authenticated, service_role;

revoke execute on function public.cancel_market_buy_order(uuid) from public, anon, authenticated, service_role;
grant execute on function public.cancel_market_buy_order(uuid) to authenticated, service_role;

revoke execute on function public.create_loan_for_player(uuid, numeric, numeric, text) from public, anon, authenticated, service_role;
grant execute on function public.create_loan_for_player(uuid, numeric, numeric, text) to authenticated, service_role;

revoke execute on function public.create_player_mail(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.create_player_mail(uuid, text, text) to authenticated, service_role;

revoke execute on function public.delete_mail_thread_for_player(uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_mail_thread_for_player(uuid) to authenticated, service_role;

revoke execute on function public.execute_complete_active_travel_if_due() from public, anon, authenticated, service_role;
grant execute on function public.execute_complete_active_travel_if_due() to authenticated, service_role;

revoke execute on function public.execute_inventory_transfer(text, uuid, uuid, text, uuid, uuid, text, integer, integer, numeric, integer, uuid, numeric) from public, anon, authenticated, service_role;
grant execute on function public.execute_inventory_transfer(text, uuid, uuid, text, uuid, uuid, text, integer, integer, numeric, integer, uuid, numeric) to authenticated, service_role;

revoke execute on function public.execute_market_purchase(uuid, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.execute_market_purchase(uuid, integer, uuid) to authenticated, service_role;

revoke execute on function public.fire_employee_atomic(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.fire_employee_atomic(uuid, uuid) to authenticated, service_role;

revoke execute on function public.fulfill_market_buy_order(uuid, integer, text, uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.fulfill_market_buy_order(uuid, integer, text, uuid, uuid, uuid) to authenticated, service_role;

revoke execute on function public.get_bank_account_balance(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_bank_account_balance(uuid) to authenticated, service_role;

-- Read by both the authenticated app (finance dashboard, business getters)
-- and the tick-npc-purchases Edge Function (ad-budget checks via the
-- service-role client) -- needs both.
revoke execute on function public.get_business_account_balance(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_business_account_balance(uuid) to authenticated, service_role;

revoke execute on function public.get_mail_character_names(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.get_mail_character_names(uuid[]) to authenticated, service_role;

revoke execute on function public.get_market_average_unit_prices(text[]) from public, anon, authenticated, service_role;
grant execute on function public.get_market_average_unit_prices(text[]) to authenticated, service_role;

revoke execute on function public.get_online_player_previews(integer) from public, anon, authenticated, service_role;
grant execute on function public.get_online_player_previews(integer) to authenticated, service_role;

revoke execute on function public.get_player_account_balances(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_player_account_balances(uuid) to authenticated, service_role;

revoke execute on function public.get_player_businesses_with_balances(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_player_businesses_with_balances(uuid, text, uuid) to authenticated, service_role;

revoke execute on function public.get_player_profile_preview(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_player_profile_preview(uuid) to authenticated, service_role;

revoke execute on function public.get_player_public_businesses(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_player_public_businesses(uuid) to authenticated, service_role;

revoke execute on function public.get_unread_mail_count(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_unread_mail_count(uuid) to authenticated, service_role;

revoke execute on function public.hire_employee_atomic(uuid, uuid, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.hire_employee_atomic(uuid, uuid, text, text, text, text) to authenticated, service_role;

revoke execute on function public.mark_chat_read(timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.mark_chat_read(timestamptz) to authenticated, service_role;

revoke execute on function public.mark_mail_thread_read(uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.mark_mail_thread_read(uuid, timestamptz) to authenticated, service_role;

revoke execute on function public.pay_loan_from_checking(uuid, uuid, numeric, text) from public, anon, authenticated, service_role;
grant execute on function public.pay_loan_from_checking(uuid, uuid, numeric, text) to authenticated, service_role;

revoke execute on function public.place_market_buy_order(text, uuid, uuid, text, integer, integer, integer, numeric, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.place_market_buy_order(text, uuid, uuid, text, integer, integer, integer, numeric, timestamptz) to authenticated, service_role;

revoke execute on function public.remove_store_shelf_item_atomic(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.remove_store_shelf_item_atomic(uuid, uuid) to authenticated, service_role;

revoke execute on function public.reply_to_mail_thread(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.reply_to_mail_thread(uuid, text) to authenticated, service_role;

revoke execute on function public.search_mail_recipients(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.search_mail_recipients(text, uuid) to authenticated, service_role;

revoke execute on function public.send_chat_message(text) from public, anon, authenticated, service_role;
grant execute on function public.send_chat_message(text) to authenticated, service_role;

revoke execute on function public.settle_employee_wages_atomic(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.settle_employee_wages_atomic(uuid, uuid) to authenticated, service_role;

revoke execute on function public.sweep_buy_orders_for_new_listing(uuid) from public, anon, authenticated, service_role;
grant execute on function public.sweep_buy_orders_for_new_listing(uuid) to authenticated, service_role;

revoke execute on function public.touch_player_presence(uuid) from public, anon, authenticated, service_role;
grant execute on function public.touch_player_presence(uuid) to authenticated, service_role;

revoke execute on function public.transfer_between_own_accounts(uuid, uuid, uuid, numeric, text) from public, anon, authenticated, service_role;
grant execute on function public.transfer_between_own_accounts(uuid, uuid, uuid, numeric, text) to authenticated, service_role;

revoke execute on function public.transfer_between_own_businesses(uuid, uuid, uuid, numeric, text) from public, anon, authenticated, service_role;
grant execute on function public.transfer_between_own_businesses(uuid, uuid, uuid, numeric, text) to authenticated, service_role;

revoke execute on function public.transfer_between_personal_and_business(uuid, uuid, uuid, numeric, text, text) from public, anon, authenticated, service_role;
grant execute on function public.transfer_between_personal_and_business(uuid, uuid, uuid, numeric, text, text) to authenticated, service_role;

revoke execute on function public.unassign_employee_atomic(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.unassign_employee_atomic(uuid, uuid) to authenticated, service_role;

revoke execute on function public.unassign_extraction_slot_worker_atomic(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.unassign_extraction_slot_worker_atomic(uuid, uuid) to authenticated, service_role;

revoke execute on function public.unassign_manufacturing_line_worker_atomic(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.unassign_manufacturing_line_worker_atomic(uuid, uuid) to authenticated, service_role;

revoke execute on function public.upsert_store_shelf_item_atomic(uuid, uuid, text, integer, integer, numeric) from public, anon, authenticated, service_role;
grant execute on function public.upsert_store_shelf_item_atomic(uuid, uuid, text, integer, integer, numeric) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- C. Server-authoritative / internal helpers -- service_role only. These are
--    called exclusively via the service-role client (tick Edge Functions,
--    src/lib/supabase-service-role.ts callers) or are nested-only helpers
--    invoked from inside other SECURITY DEFINER functions (which never need
--    an explicit grant to work -- nested calls are privilege-checked against
--    the outer function's owner, not the original caller -- but are granted
--    service_role here anyway for admin/debug tooling and to document intent).
-- ---------------------------------------------------------------------------

revoke execute on function public._settle_buy_order_fill(public.market_buy_orders, integer, integer, uuid, text, uuid, numeric, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public._settle_buy_order_fill(public.market_buy_orders, integer, integer, uuid, text, uuid, numeric, uuid, text) to service_role;

revoke execute on function public.acquire_tick_lock(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.acquire_tick_lock(text, integer) to service_role;

revoke execute on function public.add_business_inventory_quantity(uuid, uuid, uuid, text, integer, integer, numeric) from public, anon, authenticated, service_role;
grant execute on function public.add_business_inventory_quantity(uuid, uuid, uuid, text, integer, integer, numeric) to service_role;

revoke execute on function public.append_business_account_entry(uuid, uuid, numeric, text, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.append_business_account_entry(uuid, uuid, numeric, text, text, text, uuid) to service_role;

revoke execute on function public.append_business_financial_event(uuid, uuid, text, numeric, text, integer, text, text, uuid, timestamptz, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.append_business_financial_event(uuid, uuid, text, numeric, text, integer, text, text, uuid, timestamptz, jsonb) to service_role;

revoke execute on function public.append_personal_transaction(uuid, uuid, numeric, text, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.append_personal_transaction(uuid, uuid, numeric, text, text, text, uuid) to service_role;

revoke execute on function public.execute_due_shipping_deliveries(integer) from public, anon, authenticated, service_role;
grant execute on function public.execute_due_shipping_deliveries(integer) to service_role;

revoke execute on function public.execute_due_travel_arrivals(integer) from public, anon, authenticated, service_role;
grant execute on function public.execute_due_travel_arrivals(integer) to service_role;

-- invoke_edge_function is only ever invoked by pg_cron (which runs the
-- scheduled job body as its own role, not anon/authenticated/service_role --
-- see migration 101 for its accompanying search_path fix); granting
-- service_role here is defensive/for admin tooling, not load-bearing for
-- the cron path itself.
revoke execute on function public.invoke_edge_function(text) from public, anon, authenticated, service_role;
grant execute on function public.invoke_edge_function(text) to service_role;

revoke execute on function public.post_business_journal_entry(uuid, jsonb, text, uuid, text, timestamptz, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.post_business_journal_entry(uuid, jsonb, text, uuid, text, timestamptz, jsonb) to service_role;

revoke execute on function public.release_tick_lock(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.release_tick_lock(text, uuid) to service_role;

-- No current caller anywhere in src/ (dead/future code per the internal
-- mail plan, Documents/Notes.md: "optionally send_system_mail(...) for
-- admin/service use"). Restrict to service_role as the safe default rather
-- than leaving it anon/authenticated-callable while unused.
revoke execute on function public.send_system_mail(uuid, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.send_system_mail(uuid, text, text, text) to service_role;

revoke execute on function public.settle_market_listing_npc_sale_atomic(uuid, integer, numeric, text, text, numeric, integer, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.settle_market_listing_npc_sale_atomic(uuid, integer, numeric, text, text, numeric, integer, timestamptz) to service_role;

-- Superseded as a direct Edge Function call by the batched
-- settle_store_inventory_sales_atomic (migration 092), but kept as a
-- standalone atomic settlement helper -- same service_role-only
-- classification as its batch sibling regardless of current call count.
revoke execute on function public.settle_store_inventory_sale_atomic(uuid, uuid, uuid, text, numeric, uuid, text, integer, numeric, numeric, text, text, numeric, integer, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.settle_store_inventory_sale_atomic(uuid, uuid, uuid, text, numeric, uuid, text, integer, numeric, numeric, text, text, numeric, integer, timestamptz) to service_role;

revoke execute on function public.settle_store_inventory_sales_atomic(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.settle_store_inventory_sales_atomic(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- D. Pure trigger functions -- no legitimate direct caller at all. Revoke
--    the accidental PUBLIC grant; no re-grant is needed or appropriate --
--    trigger firing does not check the triggering statement's role for
--    EXECUTE on the trigger function.
-- ---------------------------------------------------------------------------

revoke execute on function public.apply_entry_to_business_balance() from public, anon, authenticated, service_role;
revoke execute on function public.apply_transaction_to_bank_balance() from public, anon, authenticated, service_role;
revoke execute on function public.check_journal_entry_balanced() from public, anon, authenticated, service_role;
revoke execute on function public.prevent_player_role_self_escalation() from public, anon, authenticated, service_role;
revoke execute on function public.set_market_transaction_business_names() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Best-effort prevention of this gap recurring: this is the documented,
-- textbook way to flip Postgres's implicit "grant EXECUTE to PUBLIC on
-- function creation" default off for future functions role `postgres`
-- creates (all migrations run as postgres, per 097_baseline_schema_grants.sql's
-- own finding), and it demonstrably works for the equivalent table/sequence
-- case (097 uses the identical mechanism, confirmed applying correctly to
-- freshly-created tables during local testing for this migration).
--
-- IMPORTANT CAVEAT, found while verifying this migration locally: for
-- FUNCTIONS specifically (object type 'f'), this local Supabase Postgres 17
-- Docker image did NOT apply this default to a freshly created SQL function
-- in isolated testing -- the new function's `proacl` stayed NULL and it
-- remained PUBLIC-executable despite a correctly-stored matching
-- `pg_default_acl` row (`defaclrole = postgres, defaclnamespace = public,
-- defaclobjtype = 'f'`), tried with both GRANT- and REVOKE-based default
-- statements, with and without an explicit `FOR ROLE` clause, and with no
-- interfering event trigger found (checked pg_event_trigger -- the three
-- extension-install triggers here only fire on CREATE EXTENSION, and
-- pgrst_ddl_watch/pgrst_drop_watch only NOTIFY PostgREST, neither touches
-- grants). Root cause not identified; kept here anyway since it is the
-- documented-correct statement, is inert if genuinely ineffective, and may
-- behave differently against hosted Supabase's own Postgres build. Do NOT
-- treat this statement as the primary protection -- rely on
-- test/db/rpc-permissions.test.ts instead, which introspects actual grants
-- at test time (via _introspect_function_privileges(), migration 104) and
-- will fail if any SECURITY DEFINER function -- new or existing -- ends up
-- anon/PUBLIC-reachable without being added to test/db/rpc-allowlist.ts,
-- independent of whether this default-privilege mechanism took effect.
-- ---------------------------------------------------------------------------

alter default privileges for role postgres in schema public
  revoke execute on functions from public;
