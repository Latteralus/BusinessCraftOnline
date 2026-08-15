-- append_business_financial_event was left granted to `authenticated` when the
-- other internal ledger-append RPCs (append_personal_transaction,
-- append_business_account_entry) were restricted to service_role in
-- 072_critical_security_hardening.sql. It only checks business ownership, not
-- what account_code/reference_type/amount is used, so a player could call it
-- directly via PostgREST to fabricate revenue/COGS/inventory events and spoof
-- their own business's financial dashboard/KPIs (it can't create spendable
-- cash, since it never touches transactions/business_accounts balances, but
-- it is over-permissive relative to its siblings). Restrict it the same way;
-- the app's only caller (insertBusinessFinancialEvents in
-- src/domains/businesses/financial-events.ts) now uses the service-role client.

revoke execute on function public.append_business_financial_event(
  uuid, uuid, text, numeric, text, integer, text, text, uuid, timestamptz, jsonb
) from authenticated;

grant execute on function public.append_business_financial_event(
  uuid, uuid, text, numeric, text, integer, text, text, uuid, timestamptz, jsonb
) to service_role;
