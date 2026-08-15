# Changelog

Running history of notable changes to LifeCraftOnline — what was done, why, and anything important for later. Newest entries at the top. This is a project log, not a marketing changelog: include infra/security context and open follow-ups, not just feature names.

When adding an entry: date it, say what changed and why, link the relevant migration/commit/file, and note anything still open or worth watching.

---

## 2026-08-15 — Added NPC open-market purchases (second, lower-volume NPC channel), fixed a personal-listing sale bug found along the way

**New feature:** NPCs can now buy directly off the open market (`market_listings`), not just from store shelves. New edge function `supabase/functions/tick-npc-market-purchases/index.ts`, on the same 60s cadence as `tick-npc-purchases` but with its own subtick state row (`npc_market_subtick_state`, `state_key = 'open_market'`). Design intent: retailers stay the primary NPC sales channel; the open market gets background churn.
- **Volume:** spawned per **city** (not per store) using a new `NPC_OPEN_MARKET_SHOPPERS_PER_SUBTICK_BASE = 1` constant (vs. storefronts' `NPC_SHOPPERS_PER_SUBTICK_BASE = 8`), and allowed to roll zero shoppers in a given subtick — deliberately much lower than storefront traffic.
- **Item eligibility:** new `NPC_OPEN_MARKET_ELIGIBLE_ITEMS` allowlist in `shared/economy.ts` — only items a person would plausibly buy off a market stall as-is (water, flour, chips, red_wine, whiskey, corn_whiskey, chair, table). Excludes raw industrial inputs (ore, coal, crude oil, raw wood, crops, tools) that only make sense once manufactured into something usable — per the request, "water yes, crude oil no." This one array is the tuning point for eligibility.
- **Shopper behavior:** budgets, tiers, basket-size distribution, price/quality preference, and the demand curve are all reused unchanged from the storefront channel (`NPC_SHOPPER_TIERS`, `NPC_BASKET_SIZE_DISTRIBUTION`, etc.) — only volume and eligibility differ, per the request that "budget and purchase ranges should be the same."
- **New RPC** (migration [`082`](../supabase/migrations/20260815100000_082_settle_market_listing_npc_sale_atomic.sql)): `settle_market_listing_npc_sale_atomic`, mirroring `settle_store_inventory_sale_atomic`'s fully-atomic single-call shape (no buyer inventory side — NPCs consume the item outright). Unlike the storefront RPC, it handles **both** listing source types (business and personal). Charges the standard 3% `MARKET_TRANSACTION_FEE`, not the storefront's 5% `NPC_STOREFRONT_FEE` — it's an open-market fill, the seller's economics shouldn't change just because the buyer happened to be an NPC.
- **Schedule** (migration [`083`](../supabase/migrations/20260815110000_083_npc_open_market_purchases_schedule.sql)): new pg_cron job `tick-npc-market-purchases`, same `* * * * *` cadence as the storefront tick.
- **Market page UX:** the "Recent Trades" feed used to filter by `buyerType: "player"` to keep storefront-shelf NPC noise out of a seller's own trade history. Since storefront sales always have `listing_id = null` while both player-to-player and the new NPC open-market trades always have a real `listing_id`, switched the filter to a new `requireListing: true` option (`MarketTransactionFilter`, `getMarketTransactions`) — cleaner semantics, and now surfaces "your listing got bought by an NPC" without also flooding the feed with a busy store's shelf sales.

**Incidental bug found and fixed (migration [`081`](../supabase/migrations/20260815090000_081_fix_execute_market_purchase_personal_seller_credit.sql)):** while building the new RPC to handle personal-sourced listings correctly, found that `execute_market_purchase` (the player-buyer path) had silently lost its personal-inventory-seller credit branch in migration 066 (April 2026) — every "create or replace" since (068, 079) carried the regression forward. Since `business_accounts.business_id` is `NOT NULL` and a personal listing's `source_business_id` is null, **buying any personal-inventory-sourced listing has been throwing a constraint-violation error and rolling back since April.** Fixed by re-adding the checking-account credit path from migration 058, and restored `seller_source_type` on the `market_transactions` insert (066 had dropped that column from the insert list too, so every transaction since silently recorded the table default `'business'` regardless of actual source type).

Verified with a clean `npm run typecheck`, `npm run build`, and `npm run typecheck:edge` (now includes the new function).

**Still open — not yet deployed:** these are new migrations and a new edge function; none of it is live on the hosted project yet. Needs `npx supabase db push` (migrations 081–083) and `npx supabase functions deploy tick-npc-market-purchases` before any of this takes effect, plus verifying `tick_run_logs` shows `tick-npc-market-purchases` running with `status: "ok"` afterward.

---

## 2026-08-15 — Fixed stale-UI-until-refresh bug (sell/transfer actions not visually updating), dependency bump

**User-reported bug:** selling items and transferring items (and other business-page actions) didn't visually update until a hard page refresh. Root cause was **not** a missing resync call in the main sell/transfer paths — `MarketClient.tsx`, `InventoryClient.tsx`'s transfer flow, and the underlying domain services/routes were all already correct. The actual bug was a **race condition** in how fetched data gets written into the Zustand store:

- Every slice setter (`setBanking`, `setInventory`, `setMarket`, etc. in `game-store.ts`) is a blind overwrite with no ordering check.
- Two independent code paths fetch and write the same slice for the same mutation: the component's own `syncMutationViews(...)` resync (fired right after the mutation's API call resolves), and the realtime provider's postgres_changes-triggered refetch of the same table (fired independently off the DB commit notification). Nothing coordinated the two, so whichever HTTP response happened to land last won — regardless of which one was actually fresher. A manual refresh "fixed" it because it's a single clean load with no competing in-flight request.
- **Fix:** added `src/stores/slice-fetch-guard.ts` — a per-slice-key generation counter (`beginSliceFetch`/`isLatestSliceFetch`/`runGuardedSliceFetch`) shared between `src/stores/mutation-sync.ts` and `src/providers/realtime-provider.tsx`. Every slice fetch (businesses/banking/inventory/market/employees/contracts/production/`businessDetail:<id>`) now only commits its result if no newer fetch for that same key has been issued since. Both files were updated to route all their slice writes through this guard.

**Related fixes found in the same audit, all following the existing optimistic-update + `syncMutationViews` pattern:**
- `BankingClient.tsx` had five independent `*Submitting` flags gating five separate transfer/loan forms, so two forms could be submitted back-to-back and race each other's `banking` slice resync (on top of the guard fix above, this made Banking the easiest place to reproduce the bug — it's literally what the user called out). Collapsed all five buttons to share the existing `allBusy` flag.
- `EmployeesClient.tsx`'s roster row actions (`reactivate`, `unassign`, `fire`) had no in-flight guard at all, unlike `submitHire`/`submitAssign` in the same file. Added a shared `pendingRosterAction` lock across all three.
- `BusinessDetailsClient.tsx`'s three manufacturing-line actions (`unassignManufacturingWorker`, `setManufacturingLineRunning`, `retoolManufacturingLine`) patched the local business-detail entry but never called `syncMutationViews`, leaving the `employees` slice and the standalone `/production` page stale until an unrelated resync happened. Added the missing calls, matching `assignEmployeeToManufacturing` in the same file.
- `ProductionClient.tsx`'s `setRecipe`/`setRunning` used a raw `fetch()` instead of the `apiPatch`/`apiPost` wrappers and never called `syncMutationViews`, so a business's Operations tab (viewed via Businesses/`BusinessDetailsClient`) didn't reflect changes made from the Production page. Converted to the standard wrapper + resync pattern.

Verified with a clean `npm run typecheck` and `npm run build` after all changes.

**Dependency bump (same session):** updated `package.json` to Next 16.3.1, React/React DOM 19.2.8, TypeScript 6.0.2 (major bump from 5.9.2), `@supabase/ssr` 0.12.4, `@supabase/supabase-js` 2.112.3, `react-hook-form` 7.85.0, Zod 4.4.3, Zustand 5.0.15; Tailwind intentionally held at 3.4.18 (Tailwind 4 is a config migration, not attempted here). Verified via clean `node_modules`/`package-lock.json` reinstall, `npm run typecheck`, and `npm run build` — all passed.

**Still open:** the fixes were verified by code review, a clean typecheck, and a clean build — not by exercising the actual sell/transfer flows against a live dev server with concurrent actions. Recommend a manual smoke test (rapid-fire transfers on the Banking page, a sale on the Market page, firing multiple employees in quick succession) before considering this fully closed.

---

## 2026-08-15 — Verified critical fixes, closed out Bugs.md items 4–18, fixed broken registration/login

Follow-up session to the entry below. Reviewed all `Documents/*.md` files, fixed every open item in [`Bugs.md`](Bugs.md), and along the way found and fixed a live production bug that was silently breaking every new player's session.

**Verified (no changes needed):** Bugs.md items 1–3, previously marked "fixed but not verified," were confirmed correct by direct migration read: `append_personal_transaction`/`append_business_account_entry` are `service_role`-only with both call sites already using the service-role client; `players.role` self-escalation is blocked by `trg_players_prevent_role_escalation`; all four transfer/loan RPCs lock rows `FOR UPDATE` in a stable order before checking balances.

**High-priority fixes:**
- **Item 4** — `shared/economy.ts`: `NPC_SUBTICK_SECONDS` was `30` but the actual `pg_cron` schedule for `tick-npc-purchases` is `* * * * *` (60s, pg_cron's minimum granularity). This silently truncated the subtick window so `subTickIndex` only ever reached ~9 of the intended 0–19 range before resetting — roughly half the intended NPC shopper volume never ran. Fixed by changing the constant to `60`.
- **Item 5** — `tick-npc-purchases/index.ts`: the per-store loop had no error boundary, so one store throwing (e.g. an orphaned inventory row) zeroed out NPC traffic for every store after it in that pass. Wrapped the loop body in `try/catch` so a single store's failure is logged and skipped instead of aborting the run.
- **Item 6** — NavBarFix (`a9d6eec`) made business selection render `BusinessDetailsClient` in place on `/businesses` without changing the URL, but `realtime-provider.tsx` only activated business-detail realtime subscriptions when `pathname.startsWith("/businesses/")`, so finance/inventory/employee updates for the panel a player was actively viewing stopped subscribing. Fixed by also gating on whether the store's `businessDetails` slice has an active entry (`trackedBusinessDetailIds.length > 0`) while on `/businesses`, and having `BusinessesClient.handleBackToList` call `removeBusinessDetail(...)` so that signal stays accurate.
- **Item 7** — `settleEmployeeWages` posted the wage debit, then made two more separate network calls; if either failed, the debit had posted but `unpaid_wage_due` never cleared, so a retry could re-charge the same wage. New RPC `settle_employee_wages_atomic` (migration [`074`](../supabase/migrations/20260815020000_074_settle_employee_wages_atomic.sql)) makes the debit + debt-clear atomic, modeled on `assign_employee_atomic`'s locking. The restore-to-open-spot step is now a best-effort follow-up in application code with no financial side effect riding on it.

**Medium fixes:**
- **Item 8** — NPC sale settlement (`settleStoreInventorySale`) did an unlocked read-then-write against `business_inventory`/`store_shelf_items`, unlike the player-facing purchase RPC. Ported into a new locked RPC, `settle_store_inventory_sale_atomic` (migration [`075`](../supabase/migrations/20260815030000_075_settle_store_inventory_sale_atomic.sql)), mirroring `execute_market_purchase`'s `FOR UPDATE` pattern; the edge function now calls it instead of touching those tables directly.
- **Item 9** — `/api/realtime-auth` returned the raw session JWT without verifying it first. Now calls `verifyCustomJwt` and returns 401 on an invalid/expired token before handing it back.
- **Item 10** — Resolved as a side effect of item 7 (the dangerous "unhandled exception after the debit already posted" path no longer exists).
- **Item 11** — `pay_loan_from_checking` checked the checking balance against the raw requested amount before clamping to what was actually owed, so "pay off the rest of my loan" could be wrongly rejected. Migration [`076`](../supabase/migrations/20260815040000_076_fix_loan_overpayment_clamp_order.sql) reorders the clamp before the balance check.
- **Item 12** — `BusinessesClient.handleSelectBusiness` had no stale-response guard; a slow fetch for one business could overwrite a faster one for another. Added a request-token ref that discards stale resolutions.
- **Item 13** — `buyMarketListing`'s weighted-average cost-basis update on the buyer's inventory row happened in a second, separately-locked round trip after `execute_market_purchase` returned, so concurrent purchases could clobber each other's cost basis. Migration [`079`](../supabase/migrations/20260815070000_079_execute_market_purchase_cost_basis.sql) computes it inside the RPC's existing lock on that row instead; the redundant JS-side read/update was removed.

**Low fixes:**
- **Item 14** — `fire_employee_atomic` deleted an employee unconditionally, silently erasing any `unpaid_wage_due`. Migration [`077`](../supabase/migrations/20260815050000_077_fire_employee_unpaid_wage_guard.sql) blocks firing until wages are settled.
- **Item 15** — `append_business_financial_event` was left grantable to `authenticated` when its siblings were hardened in `072`. Migration [`078`](../supabase/migrations/20260815060000_078_restrict_business_financial_event_to_service_role.sql) restricts it to `service_role`; `insertBusinessFinancialEvents` now calls it via the service-role client.
- **Item 16** — Dropped the two `employees={... as any}` casts (`BusinessesClient.tsx`, `businesses/[id]/page.tsx`) in favor of one documented helper, `toBusinessDetailsClientEmployees`, in `business-details-state.ts`.
- **Item 17** — Deliberately **not changed**. The orphaned `/businesses/[id]/page.tsx` route is a consequence of NavBarFix's intentional in-place rendering, not a bug in itself; the route still works fine when hit directly, and item 6 already fixes the actual regression (realtime updates). Re-adding URL navigation would fight that UX choice and wasn't requested.
- **Item 18** — Renamed `/api/banking/business-transfer` → `/api/banking/personal-business-transfer` and `/api/banking/businesses-transfer` → `/api/banking/business-to-business-transfer` for clarity (they were never actually duplicates, just confusingly named); updated `src/lib/client/routes.ts` accordingly.

**Unplanned critical fix — new player registration and login were completely broken:**
While verifying the fix set end-to-end (registering a test player and checking `/api/auth/me`), found two stacked, previously-undetected bugs that together meant **every new player registration silently produced an unusable account**, and existing logins were equally broken:
1. `register_player`/`authenticate_player` call `crypt()`/`gen_salt()` unqualified under `set search_path = public`, but on this project `pgcrypto` is installed in the `extensions` schema (Supabase's current default), not `public`. Every registration attempt failed with `function gen_salt(unknown) does not exist`. Fixed by migration [`080`](../supabase/migrations/20260815080000_080_fix_register_login_pgcrypto_search_path.sql), adding `extensions` to both functions' search_path.
2. Once registration itself started working, the resulting session cookie failed on every subsequent authenticated request with PostgREST error `PGRST301: None of the keys was able to decode the JWT`. Root cause: `SUPABASE_JWT_SECRET` in `.env.local` did not match project `aroffxhnsjjdtqieeogx`'s actual legacy JWT secret — the value in place was UUID-shaped (36 chars), not the real ~64-byte base64 secret, almost certainly copied from the wrong dashboard field when `.env.local` was pointed at this project earlier today. Verified the mismatch by checking the candidate secret against the project's own anon-key signature (`jose.jwtVerify`) before writing anything. Corrected `SUPABASE_JWT_SECRET` in `.env.local` to the real value from Project Settings → Data API → JWT Settings; confirmed with a live register → `/api/auth/me` → login round trip against the local dev server, then deleted the test accounts.

**⚠️ Open follow-up, action needed:** `.env.local` is local-only (gitignored). If Vercel's dashboard-configured environment variables have their own `SUPABASE_JWT_SECRET` (set separately during the environment migration noted below), **production is very likely still broken the same way** and needs the same corrected value applied there. This could not be checked or fixed from this session — verify Vercel's env vars next.

**Also verified:** post-deploy `tick_run_logs` shows `tick-npc-purchases` running with `status: "ok"` after redeploying the edge function (`storesProcessed: 0` is expected — this environment has no store businesses yet, not an error).

**Still open (out of scope for this pass):** full economic-flow smoke testing (wage settlement, loan overpayment, NPC sale locking) under real concurrent load wasn't feasible from here without live player sessions — the fixes are verified by code/lock-order review and a clean build/typecheck, not by exercising the money flows themselves end-to-end.

---

## 2026-08-15 — Supabase environment setup, critical security hardening, docs consolidation

**Security fixes (migration [`072_critical_security_hardening.sql`](../supabase/migrations/20260815000000_072_critical_security_hardening.sql)):**
A security review (see [`Bugs.md`](Bugs.md)) found three critical, directly-exploitable issues:
1. `append_personal_transaction` / `append_business_account_entry` were granted `EXECUTE` to `authenticated` with no restriction on `transaction_type`/`category` — any player could call them directly via PostgREST with their own JWT and credit themselves arbitrary funds. Fixed by revoking `authenticated` access and restricting to `service_role`; the app now calls them through a dedicated service-role client (`src/lib/supabase-service-role.ts`).
2. The `players` RLS update policy allowed a player to PATCH their own `role` column to `admin`. Fixed with a `BEFORE UPDATE` trigger (`prevent_player_role_self_escalation`) that reverts any `role` change not made by `service_role`.
3. Double-spend race in `transfer_between_own_accounts`, `transfer_between_personal_and_business`, `transfer_between_own_businesses`, and `pay_loan_from_checking` — balance was read, then debited in a separate statement with no lock. Fixed by adding `SELECT ... FOR UPDATE` on the account/business/loan rows (in a stable lock order to avoid deadlocks) before the balance check.

Medium/low findings from the same review (NPC sale settlement locking, `/api/realtime-auth` returning the raw JWT, loan overpayment rejection, business-switching race, etc.) are **still open** — see [`Bugs.md`](Bugs.md) for the full list.

**Build fix:** The service-role client was initially added inside `src/lib/supabase-server.ts`, which imports `next/headers`. That file is transitively imported by `businesses/service.ts` and `banking/service.ts`, which are also imported by the client-side `RealtimeProvider` — so the change broke the production build ("You're importing a module that depends on next/headers... but you are using it in the Pages Router"). Fixed by moving the service-role client into its own file, `src/lib/supabase-service-role.ts`, with no `next/headers` dependency.

**Supabase project setup:** The user had not migrated or seeded Supabase since connecting the repo. What actually happened:
- The Supabase CLI was linked to project `aroffxhnsjjdtqieeogx` ("Latteralus's Project"). `.env.local` pointed at a *different*, dead project ref (`jckniouvmenfhellqddn`) that no longer resolves via DNS — confirmed stale.
- The linked project turned out to already contain a live, unrelated app's schema (38 tables — an aircraft/pilot career sim: `aircraft`, `flight_sessions`, `pilot_hour_totals`, `job_postings`, etc.), which is why the first migration push failed (`cities` already existed with an incompatible schema).
- With explicit confirmation from the user, wiped exactly those 38 tables + 1 stray function (`rls_auto_enable`) — not the `public` schema itself, to preserve Supabase's default role grants for `anon`/`authenticated`.
- Pushed all 85 migrations cleanly (`npx supabase db push`).
- Ran `supabase/seed.sql` (currently a placeholder; real starter data — 10 cities — comes from migration `003_cities` itself).
- Deployed all 6 tick edge functions (`npx supabase functions deploy`).
- Found and fixed a **real, previously-silent bug**: `invoke_edge_function()`'s hosted fallback URL was hardcoded to `jckniouvmenfhellqddn` — the same dead project ref from `.env.local`. Since hosted Supabase doesn't permit `ALTER DATABASE ... SET app.settings.*`, that hardcoded fallback was the only thing actually controlling where cron-triggered ticks went, meaning ticks would have silently failed indefinitely. Fixed in migration [`073_fix_stale_edge_function_base_url.sql`](../supabase/migrations/20260815010000_073_fix_stale_edge_function_base_url.sql).
- Set the tick cron→edge-function shared secret on both sides (`TICK_FUNCTION_SECRET` function secret + matching `edge_function_tick_secret` in Postgres Vault).
- Verified end-to-end: `tick_run_logs` shows real `status: "ok"` rows for `tick-extraction`, `tick-manufacturing`, `tick-npc-purchases`, and `tick-travel` firing on schedule.
- Updated `.env.local` to point at the correct project (`aroffxhnsjjdtqieeogx`) with valid keys.

**Docs:** Combined `_AI_GUIDE.md`, `AIReadme.md`, and `README.md` into a single [`Documents/AI_GUIDE.md`](AI_GUIDE.md); removed stale "Phase 0 scaffold" status text in favor of pointing at this changelog. Created this file.

**Open follow-ups:**
- Bugs.md items 4–7 (medium/low severity) are not yet addressed.
- `Documents/economy-audit-2026-03-09.md`'s rebalancing proposals have not been applied to `src/config/*` as far as this session found — treat its numbers as proposed, not current, until verified.
- Confirm Vercel's dashboard-configured environment variables also point at `aroffxhnsjjdtqieeogx` (this session fixed local `.env.local`, but Vercel env vars are configured separately and weren't directly inspectable from here).

---

## Earlier history (summarized from commit log)

The commit history before today (~180 commits, `2026-03-01` → `2026-05-01`) mostly uses terse messages ("Update", "Fix1", "Fast") without a structured changelog, so this section is a best-effort summary by date range and theme rather than a per-commit record. Treat it as a rough map, not a precise log — use `git log` directly for exact detail on any specific period.

- **2026-03-01 – 2026-03-03** — Initial scaffold and phased domain buildout: auth/characters, cities/travel, banking, businesses, employees, early production and market systems ("Phase 11", "Phase 12", "Phase 14", "Phase 17" and related commits).
- **2026-03-07 – 2026-03-09** — Heavy iteration: NPC shopper simulation, store shelves/storefronts, API layer and number-coercion fixes, employee tick logic, chat, market flow, inventory & upgrades, business dashboards, finance views, migration to a centralized game store (`LargeMigrationToGameStore`).
- **2026-03-10 – 2026-03-12** — Store/market UI polish, finance tab fixes, SSOT/utilities cleanup, chat fixes, and the internal mail system groundwork (`MailTime`) — see [`Notes.md`](Notes.md) for the mail system's design doc.
- **2026-04-28 – 2026-04-30** — Gap in commit history (2026-03-12 → 2026-04-28), then a cluster of fixes: performance passes, employee logic, an economy rebalance pass, wage/tick fixes, business-details controller fixes, buyer/COGS updates, upgrades and employees updates, finance/UI updates, and a storefront patch.
- **2026-05-01** — `NavBarFix`: changed business selection to render in-place without changing the URL. Per the security/bug review, this has a known regression — `RealtimeProvider` still gates business-detail realtime subscriptions on `pathname.startsWith("/businesses/")`, so realtime updates for the panel a player is actively viewing no longer subscribe. Not yet fixed (see `Bugs.md`).
- **2026-08-15** — See the detailed entry above.
