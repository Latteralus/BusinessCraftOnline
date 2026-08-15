All five review agents have reported back. Here's the consolidated picture, worst first.

NOTE (2026-08-15): Items 1–3 verified fixed; items 4–18 all fixed (item 17 deliberately left as-is, see rationale in changelog). See [`changelog.md`](changelog.md)'s "Verified critical fixes, closed out Bugs.md items 4–18" entry for what changed and why. This file is kept as-is below as the original review record.

🔴 Critical — exploitable for unlimited money / admin takeover
1. Money-duplication via direct Postgres RPC calls
append_personal_transaction and append_business_account_entry (in 20260430020000_068_harden_economy_rpc_and_shelf_atomic.sql) are granted EXECUTE to the authenticated role and only check that you own the account — they never restrict transaction_type or category. Any player holding their own valid JWT + the public anon key can POST straight to Supabase's REST RPC endpoint (bypassing your app entirely) with transaction_type: "manual_adjustment" and an arbitrary amount, crediting themselves infinite money. These functions were meant as internal helpers, not public API.

2. Self-promotion to admin
The RLS policy on players (20260302090000_001_players.sql:26) allows UPDATE where id = auth.uid() with no column restriction. Since role (player/admin) lives on that same table, any player can PATCH their own row's role to "admin" directly via PostgREST. requireAdminUser() trusts that column blindly, so this unlocks every admin route — including the one that manually triggers the NPC tick function.

3. Double-spend race in every transfer/loan RPC
transfer_between_own_accounts, transfer_between_personal_and_business, transfer_between_own_businesses, and pay_loan_from_checking all read a balance, then write a debit in a separate statement with no FOR UPDATE lock. Two concurrent requests draining the same account can both pass the balance check before either commits — an effective double-spend, since there's no aggregate CHECK constraint preventing a negative balance.

NOTE: The above 1, 2, and 3 have all been fixed but not verified. Verify when possible.

These three share one root cause: the app-layer checks in src/domains/**/service.ts are trustworthy, but the underlying Postgres grants/RLS policies aren't locked down to match, so anyone can talk to Supabase directly and skip your code entirely.

🟠 High — real gameplay/data-integrity bugs
4. NPC simulation runs at half speed, permanently — shared/economy.ts assumes a 30s subtick, but the cron (per 20260303020000_030_npc_tick_schedule_fix.sql) only fires every 60s (pg_cron's minimum granularity). The 10-minute tick-window reset fires after ~10 invocations instead of 20, so subTickIndex never reaches 10–19 — half the intended shopper volume never happens, silently, since the code "works," it's just running at the wrong cadence.

5. One bad store kills NPC traffic for every store after it, forever — tick-npc-purchases/index.ts advances and persists the subtick index before looping over stores, with no per-store try/catch. If one store throws (e.g. an orphaned inventory row), every store after it in that pass gets no shoppers that subtick — and because the index already advanced, it's never retried. A single bad row can quietly zero out traffic for large parts of the market indefinitely.

6. Realtime updates broke for the business detail view (NavBarFix regression) — realtime-provider.tsx gates business-detail subscriptions on pathname.startsWith("/businesses/"), but the NavBarFix commit changed business selection to render in-place without changing the URL. So finance/inventory/employee realtime updates for the panel a player is actively looking at never subscribe anymore — stale data until they navigate away and back.

7. Employee wages can be double-charged to the business — settleEmployeeWages (src/domains/employees/service.ts:516) does a debit, then a separate assignment restore, then a separate employee-row update, as three independent network calls with no transaction. If step 2 or 3 throws (e.g. a concurrent-assignment conflict), the wage debit has already posted but unpaid_wage_due never clears — the same wage gets paid again on retry. This is a leftover hand-rolled path that the April "atomic RPC" refactor missed.

🟡 Medium
NPC sale settlement isn't row-locked, unlike the player-facing purchase RPC — a player creating/cancelling a listing at the same moment an NPC buys can produce a lost-update on shared inventory rows.
/api/realtime-auth returns the raw session JWT (from the httpOnly cookie) in a JSON body to any caller, without even verifying it first — defeats the point of httpOnly and turns any future XSS into full session theft.
restoreSettledEmployeeToOpenSpot still uses an unlocked read-then-conditional-update pattern instead of the new atomic assignment RPCs; a conflict throws an unhandled exception after the wage debit in #7 above has already posted.
Loan overpayment is wrongly rejected — pay_loan_from_checking checks the balance against the raw requested amount before clamping to what's actually owed, so "pay off the rest of my loan" can fail even when affordable.
Fast business-switching race in BusinessesClient.tsx — no request token guards handleSelectBusiness, so a slow fetch for business A can overwrite a faster fetch for business B, and a failed fetch for A can null out the panel even if B loaded fine.
Buyer inventory cost-basis update race in buyMarketListing — the weighted-average cost recompute happens outside the purchase RPC's locks, so concurrent purchases can corrupt COGS accounting.
⚪ Low / minor
fire_employee_atomic deletes an employee without checking unpaid_wage_due first — firing someone silently erases their debt (pre-existing behavior, not a new regression).
append_business_financial_event is similarly over-permissive to #1, letting a player fabricate revenue/COGS events to spoof business valuation/KPIs (can't create spendable money though).
employees={selectedDetail.employees as any} in the new NavBarFix code path hides a real type mismatch.
The old /businesses/[id]/page.tsx route is now dead/orphaned — selecting a business no longer updates the URL, so refresh/back-button loses your place.
business-transfer vs businesses-transfer are two real, differently-behaved routes (not a dangerous duplicate) — just a confusing naming collision worth renaming.