// Documented, explicit allowlist for the RPC-permission regression suite
// (rpc-permissions.test.ts). This mirrors the classification established in
// supabase/migrations/20260819040000_100_function_execute_privilege_hardening.sql
// exactly -- if that migration's grants change, update this list in the same
// change so the regression test keeps enforcing the current intended state
// instead of silently drifting from it.
//
// Keyed by bare function name (no schema/args) -- none of these functions
// are overloaded, so name-only matching is unambiguous and avoids brittle
// signature-string parsing against pg_get_function_identity_arguments.

/** A. Callable by `anon` (pre-login / public-facing). */
export const ANON_ALLOWED_FUNCTIONS = [
  "authenticate_player",
  "register_player",
  "get_public_simulation_stats",
] as const;

/**
 * B. Callable by `authenticated` -- player-facing RPCs invoked through the
 * app's own per-request, session-JWT-carrying client. Also includes
 * get_public_simulation_stats and get_business_account_balance, which are
 * intentionally dual-granted (see A and C respectively).
 */
export const AUTHENTICATED_ALLOWED_FUNCTIONS = [
  "get_public_simulation_stats",
  "accept_contract_atomic",
  "assign_employee_atomic",
  "assign_extraction_slot_worker_atomic",
  "assign_manufacturing_line_worker_atomic",
  "can_access_mail_thread",
  "cancel_market_buy_order",
  "create_loan_for_player",
  "create_player_mail",
  "delete_mail_thread_for_player",
  "execute_complete_active_travel_if_due",
  "execute_inventory_transfer",
  "execute_market_purchase",
  "fire_employee_atomic",
  "fulfill_market_buy_order",
  "get_bank_account_balance",
  "get_business_account_balance",
  "get_mail_character_names",
  "get_market_average_unit_prices",
  "get_online_player_previews",
  "get_player_account_balances",
  "get_player_businesses_with_balances",
  "get_player_profile_preview",
  "get_player_public_businesses",
  "get_unread_mail_count",
  "hire_employee_atomic",
  "mark_chat_read",
  "mark_mail_thread_read",
  "pay_loan_from_checking",
  "place_market_buy_order",
  "remove_store_shelf_item_atomic",
  "reply_to_mail_thread",
  "search_mail_recipients",
  "send_chat_message",
  "settle_employee_wages_atomic",
  "sweep_buy_orders_for_new_listing",
  "touch_player_presence",
  "transfer_between_own_accounts",
  "transfer_between_own_businesses",
  "transfer_between_personal_and_business",
  "unassign_employee_atomic",
  "unassign_extraction_slot_worker_atomic",
  "unassign_manufacturing_line_worker_atomic",
  "upsert_store_shelf_item_atomic",
  // Not part of the anon/authenticated Advisor audit (already scoped
  // correctly by their own migrations, 067/094) but confirmed
  // authenticated-only -- included so the regression test covers them too.
  "get_storefront_transaction_aggregate",
  "get_storefront_transaction_aggregates_by_business",
] as const;

/**
 * C/D. SECURITY DEFINER functions that must NEVER be directly executable by
 * `anon` or `authenticated` -- internal financial mutation helpers, tick/
 * lock helpers, nested-only helpers, and pure trigger functions. This is
 * the list the SupabaseReport audit exists to protect; if a future
 * migration accidentally grants one of these to anon/authenticated, the
 * regression test must fail.
 */
export const SERVER_ONLY_SECURITY_DEFINER_FUNCTIONS = [
  "_materialize_city_stockpile_ids",
  "_settle_buy_order_fill",
  "acquire_tick_lock",
  "add_business_inventory_quantity",
  "append_business_account_entry",
  "append_business_financial_event",
  "append_personal_transaction",
  "apply_entry_to_business_balance",
  "apply_transaction_to_bank_balance",
  "check_journal_entry_balanced",
  "execute_due_shipping_deliveries",
  "execute_due_travel_arrivals",
  "invoke_edge_function",
  "materialize_all_active_city_stockpiles",
  "materialize_city_stockpiles_due",
  "post_business_journal_entry",
  "prevent_player_role_self_escalation",
  "release_tick_lock",
  "run_government_daily_update",
  "send_system_mail",
  "set_market_transaction_business_names",
  "settle_market_listing_npc_sale_atomic",
  "settle_store_inventory_sale_atomic",
  "settle_store_inventory_sales_atomic",
] as const;

const anonAllowedSet = new Set<string>(ANON_ALLOWED_FUNCTIONS);
const authenticatedAllowedSet = new Set<string>(AUTHENTICATED_ALLOWED_FUNCTIONS);

export function isAnonAllowed(functionName: string): boolean {
  return anonAllowedSet.has(functionName);
}

export function isAuthenticatedAllowed(functionName: string): boolean {
  return authenticatedAllowedSet.has(functionName);
}
