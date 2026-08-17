Database & Resource Audit
Supabase Performance Audit
A full pass over LifeCraftOnline's data layer — client hooks, API routes, edge-function ticks, and schema — to find what's burning Free-tier reads, writes, bandwidth, and compute, ranked by expected impact.

Scope src/, supabase/functions, supabase/migrations
Date 2026-08-17
Findings 25
3
Critical findings
8
High findings
227.5k
Cron tick invocations / month, baseline
5 / 7
Tick functions running every 1 minute
7
Unbounded tables, zero retention jobs
Critical (3)
High (8)
Medium (10)
Low (4)
Architecture
Quick reference
Critical
3 findings
Unbounded cost that scales with either player count or game age (or both), sitting directly in a hot, frequently-hit path. These are the patterns most likely to exhaust Free-tier compute or connection budget as the game grows, even without a traffic spike.

Online-player preview RPC scans every player's entire ledger history, every 60 seconds, per open tab
C1
get_online_player_previews runs a SUM(...) GROUP BY player_id over the entire transactions table and the entire business_accounts table — for every player in the database, not just the online ones — before joining down to the online subset. It's called from /api/app-shell, which every open browser tab polls every 60 seconds via the Topbar heartbeat.

supabase/migrations/20260309110000_043_player_presence_and_online_previews.sql:66-146
src/app/api/app-shell/route.ts:22-52
src/components/layout/Topbar.tsx:196-243 — 60s setInterval
Impact: cost = O(all players × all-time ledger rows), re-paid every 60 seconds per concurrently open tab. This is the one query in the codebase whose cost compounds along two independent growth axes at once — it will get slower for every player, on every poll, as the game simply stays alive.
Five tick functions run every 60 seconds with unbatched per-row upgrade-effect lookups
C2
tick-extraction, tick-manufacturing, tick-npc-purchases, tick-npc-market-purchases, and tick-travel all run on a 1-minute pg_cron cadence — about 216,000 invocations/month before any player action. Three of them call the shared getResolvedBusinessUpgradeEffects helper once per row (per active slot / per active line / per store) instead of once per business per tick. Internally that helper re-runs its own project-completion select-and-write loop and two more table scans on every call.

supabase/functions/_shared/business-upgrades.ts:188-219 (called per-row, not cached across the loop)
supabase/functions/tick-extraction/index.ts:311-455 — 8-12+ round trips per active slot
supabase/functions/tick-manufacturing/index.ts:317-535 — per input item, per line
supabase/migrations/20260310120500_056_...sql, 20260815110000_083_...sql — final cron cadence
for (const slot of activeSlots) {
  await getResolvedBusinessUpgradeEffects(client, slot.business_id) // re-fetches + re-derives, every row
  ...8+ more per-slot queries...
}
Impact: a tick with 50 active manufacturing lines spread across 50 businesses can issue 500-800+ DB round trips inside a single 60-second invocation. This is the largest steady-state read/write volume driver in the whole system, and it runs continuously regardless of whether any player is online.
Realtime provider tears down and reconnects every channel on route navigation
C3
The single useEffect that owns all realtime subscriptions lists activeRealtimeModules (derived from pathname, changes on every navigation) in its dependency array, alongside the owned-business, bank-account, and tracked-business-detail id lists. Any of these changing removes every channel and reconnects from scratch — including a fresh /api/realtime-auth token fetch — before resubscribing to what can be 15-20+ channels.

src/providers/realtime-provider.tsx:120-798 — effect body
src/providers/realtime-provider.tsx:763-798 — dependency array including pathname-derived state
src/providers/realtime-provider.tsx:756-761 — full teardown
Impact: ordinary in-app navigation (not just business/account changes) repeatedly burns through realtime connection and channel-churn budget — the exact usage a free-tier realtime plan caps hardest.
High
8 findings
Real, measurable waste on hot paths — the most-visited page in the app, every mutation, every NPC tick — but each individually bounded rather than compounding across two growth axes like the critical tier.

Every mutation refetches 3-5 whole page-data bundles, undeduplicated against realtime's own refetch of the same data
H1
syncMutationViews is called after nearly every write (market listing, transfer, hire, contract) and each flag it sets (businesses, banking, inventory, market) triggers its own multi-request page-data fetcher — creating one market listing alone fires roughly 17 separate GET requests. The realtime provider then independently refetches the same slices when the resulting DB change arrives over the socket. slice-fetch-guard.ts explicitly documents this race; it prevents a stale response from winning, but does not cancel or dedupe the redundant in-flight request.

src/stores/mutation-sync.ts
src/stores/slice-fetch-guard.ts:1-9 — documents the known double-fetch
src/app/(authenticated)/market/MarketClient.tsx:321-327
Impact: single largest over-fetch pattern in the client; effectively doubles read cost for any slice touched by both a mutation and a realtime event landing close together.
Realtime channels are allocated per-row instead of per-table
H2
One channel per owned business (business-balances-*), one per bank account (transactions-*), one per tracked business-detail panel (12 chained postgres_changes handlers each), one per extraction slot. A player with 15 businesses opens 15+ simultaneous dedicated channels.

src/providers/realtime-provider.tsx:592-745
Impact: scales channel count linearly with a player's business/account count — real risk of hitting Free-tier concurrent-channel caps for engaged players.
Mail realtime channels are unfiltered — every player's mail activity is broadcast to every connected client
H3
mail-threads-* and mail-messages-* subscribe to event: "*" on the full table with no row filter, relying on the client to discard rows it doesn't own after they've already been pushed over the wire.

src/providers/realtime-provider.tsx:528-542
Impact: broadcast bandwidth scales with total platform mail activity, not the individual player's — and pushes other players' mail metadata to clients that immediately throw it away.
tick-wages loads every employee and every assignment in the database, unfiltered, every 15 minutes
H4
Both the employees select and the employee_assignments select omit any status/business filter — the entire tables are pulled into memory purely to build a membership Set for a later check.

supabase/functions/tick-wages/index.ts:52-67, 108
const { data: employees } = await client
  .from("employees").select("*").order("created_at") // no .eq("status", ...)
const { data: assignments } = await client
  .from("employee_assignments").select("employee_id") // no filter at all
Impact: this becomes a full-table scan of both tables every 15 minutes forever, scaling with total historical playerbase rather than active employee count.
The business-detail page re-fetches the same business row 5-6+ times per load
H5
loadBusinessDetailsEntry fetches the business once, then calls getProductionStatus, getBusinessUpgrades, getBusinessUpgradeProjects, and getBusinessFinanceDashboard in parallel — each of which independently re-verifies ownership with its own businesses select instead of accepting the row already in scope. business_upgrades/business_upgrade_projects get re-scanned 3-4 times the same way.

src/lib/business-details-data.ts:50-236
src/domains/businesses/service.ts:392-486 — same pattern in purchaseUpgrade
Impact: this is the most-visited page in the app (every business click) — the redundancy multiplies read cost several-fold on the single hottest read path.
Inventory valuation scans the entire marketplace on every finance-dashboard load
H6
getMarketAverageUnitPrices queries every active listing across all players and all cities for the requested item keys, with no scope, no limit, and no cache — just to estimate an average asking price for one business's inventory valuation.

src/domains/businesses/finance.ts:417-441
Impact: query cost grows with total marketplace size, not the viewing business's inventory, and re-runs on every dashboard visit.
NPC purchase ticks issue one settlement RPC per individual shopper purchase
H7
Both tick-npc-purchases and tick-npc-market-purchases nest a per-purchase RPC call inside shopper × basket-size × store/city loops, each RPC itself performing several internal ledger and inventory inserts — every 60 seconds.

supabase/functions/tick-npc-purchases/index.ts:563
supabase/functions/tick-npc-market-purchases/index.ts:393
Impact: write-call volume is O(stores × shoppers × basket size) every minute — the dominant write-side cost in the tick pipeline.
No retention on seven append-only or per-tick-write tables
H8
No pg_cron job, scheduled function, or migration deletes/archives old rows anywhere in the codebase. market_storefront_performance_snapshots is written once per store per tick even when zero sales occurred — at just 50 active stores that's ~72,000 rows/day on its own.

tick_run_logs — 1 row per tick run × 7 functions at 1-15 min cadence
market_storefront_performance_snapshots — written unconditionally every tick, tick-npc-purchases/index.ts:441-457
market_transactions, business_accounts, business_financial_events, chat_messages, transactions
Impact: pure unbounded storage growth toward the 500MB Free-tier cap, independent of and in addition to the read/compute concerns above.
Medium
10 findings
Real inefficiencies, bounded by a single request or a single table, that are worth fixing but won't independently threaten the Free-tier budget on their own.

Five list endpoints have no pagination at all
M1
getContracts, getPlayerEmployees, getStoreShelfItems, getPersonalInventory, and getBusinessInventory return full, unbounded result sets — inconsistent with getMarketListings/getTransactionHistory, which already paginate correctly nearby in the same files.

src/domains/contracts/service.ts:76-99, employees/service.ts:236-263
src/domains/stores/service.ts:19-37, inventory/service.ts:144-179
Unread mail badge count fetches every thread and message instead of a count aggregate
M2
getUnreadMailCount pulls all unread thread rows, then all messages in those threads, to derive one integer in JS — getUnreadChatCount right next to it does this correctly with select("id", { count: "exact", head: true }). Runs on the same 60s heartbeat as C1.

src/domains/mail/service.ts:292-326 vs chat/service.ts:32-61
Scattered N+1 write loops on hot paths
M3
consumeInventoryCostByRowId re-selects then writes per quality tier instead of one batched write (every sale/fulfillment); applyCompletedUpgradeProjects does 3 round trips per ready project plus a full-table select both before and after; reconcileBusinessInventoryReservations runs a 3-query sweep and up to N individual updates before every single market-listing creation and inventory transfer; getStorefrontPerformanceSummary calls a per-business RPC in a loop instead of one grouped aggregate.

src/domains/businesses/financial-events.ts:62-90
src/domains/upgrades/projects.ts:30-88
src/domains/inventory/service.ts:49-142
src/domains/market/service.ts:862-963
A legacy shadow table is re-derived and rewritten every manufacturing tick
M4
syncLegacyManufacturingJobForBusiness keeps manufacturing_jobs in sync with the real manufacturing_lines table purely for backward compatibility, re-querying and re-writing it once per touched business, every minute. The retool pass separately re-queries business_id for line ids it already had from the prior select in the same function.

supabase/functions/tick-manufacturing/index.ts:140-192, 265-292
Static reference data is re-queried from Supabase on every page load
M5
getCities hits the near-static cities table fresh on every businesses/inventory/market page load for every user — deduplicated only within a single request via React cache(), never across requests or users.

src/domains/cities-travel/service.ts:9-17
Admin role check hits the database on every admin request
M6
requireAdminUser runs a select("*") on players for every admin-gated request just to read role, despite the app already issuing its own self-signed JWTs where role could be embedded as a claim at login.

src/app/api/_shared/route-helpers.ts:31-44
No client-side cache or request dedup layer exists at all
M7
cache: "no-store" is force-applied to every GET request; there is no React Query, SWR, or equivalent. Seven independent page-data fetchers each separately re-request apiRoutes.businesses.root with nothing shared between them.

src/lib/client/live-request.ts:3, src/lib/client/queries.ts
Realtime provider makes direct browser-to-Supabase calls that bypass the API layer
M8
getManufacturingStatus and getBusinessesWithBalances (via RPC) are called straight from the browser client on postgres_changes events, duplicating server-route logic in a second code path and widening the H1 double-fetch race.

src/providers/realtime-provider.tsx:389-420
manufacturing_lines has no index on the columns tick-manufacturing filters every minute
M9
pending_recipe_key / retool_complete_at are queried every 60 seconds by the retool pass but have no supporting index — cheap today at low row counts, a sequential scan once business count grows.

supabase/migrations/20260309223000_053_production_line_retooling.sql:74-82
Hard row caps silently drop data instead of erroring
M10
tick-npc-purchases caps business_inventory/store_shelf_items reads at .limit(200); tick-npc-market-purchases caps market_listings at .limit(2000). Both will start silently excluding rows once the game scales past these caps — stores stop restocking correctly, or some cities stop receiving NPC traffic — with no error or log signal.

Low
4 findings
Small, bounded redundancies and maintainability issues — worth cleaning up opportunistically, not urgent.

Redundant single-row lookups scattered across services
L1
getEmployeeWithDetails issues 3 employees selects for one lookup; installToolForSlot fetches the parent business twice; fulfillContract fetches the same business_inventory rows once to check availability and again to consume them.

src/domains/employees/service.ts:337-355, production/service.ts:705-758, contracts/service.ts:191-232
Per-row inserts/updates instead of a batch
L2
ensurePersonalAccounts inserts each missing account type individually; several tick-wages employee updates issue one write per employee instead of a batched upsert.

src/domains/banking/service.ts:75-124, supabase/functions/tick-wages/index.ts:110-180
Dead-code stub components
L3
PageAutoRefresh.tsx and AuthenticatedShellDataLayer.tsx are no-op stubs, unreferenced anywhere in src. No runtime cost — cleanup only.

src/components/realtime/PageAutoRefresh.tsx, AuthenticatedShellDataLayer.tsx
Supabase server client construction bypasses the shared helper in ~15 routes
L4
Several route handlers construct createSupabaseServerClient inline instead of going through requireAuthedUser/handleAuthedRequest. No material perf cost — consistency issue only.

src/app/api/banking/accounts/route.ts:7, banking/loan/route.ts:13,43, market/storefront/performance/route.ts:6, analytics/route.ts:17, and others
Architectural recommendations
Structural changes that address multiple findings above at once, ranked by expected leverage.

1
Replace live SUM() ledger aggregation with a maintained running balance
Add a balance column updated transactionally on write (or a periodically refreshed materialized view) for get_business_account_balance, get_bank_account_balance, and get_online_player_previews — turns O(history) reads into O(1). This single change directly resolves C1, and reduces the per-employee/per-store balance checks in tick-wages and tick-npc-purchases.

Resolves C1 — likely the single largest cost driver in the audit
2
Batch upgrade-effect resolution once per business per tick
Pre-fetch getResolvedBusinessUpgradeEffects for every business touched by a tick in one .in("business_id", [...]) query, build a lookup map, and pass it into the per-row loop instead of re-querying per row.

Shrinks C2's round-trip count by an order of magnitude across three tick functions
3
Decouple realtime channel lifecycle from route/pathname
Split the subscription effect so channel setup only depends on auth/session identity, not navigation. Consolidate per-business/per-account channels into fewer, filter-scoped channels — e.g. a single player-scoped channel using .in() rather than N separate channels per business or account.

Resolves C3 and H2 together
4
Introduce a client-side cache with staleTime, even a lightweight custom one
Give mutation-triggered and realtime-triggered refetches of the same slice a shared in-flight-request cache so they collapse into one request instead of racing, and so navigation between pages doesn't force a full re-fetch of data already in the store.

Resolves H1, reduces M7 and M8
5
Add scheduled retention for the unbounded log/snapshot tables
A daily pg_cron job deleting or rolling up rows older than N days in tick_run_logs and market_storefront_performance_snapshots would remove nearly all of their storage growth with no gameplay impact — these aren't audit-trail data the way ledgers are.

Resolves the bulk of H8
6
Re-examine whether five tick functions actually need 1-minute cadence
Migration 083's own commentary notes that shopper volume — not cron cadence — is what should govern NPC purchase rate. That reasoning likely extends to tick-extraction and tick-travel too: dropping to a 2-5 minute cadence would cut cron-driven invocation volume by 60-80% without necessarily changing game feel, if the per-tick work scales to compensate.

Directly cuts the 227.5k/month baseline invocation count
7
Cache small, near-static reference tables at the module or edge level
cities and similar small reference tables change rarely enough to serve from an in-memory cache with a multi-minute TTL instead of hitting Supabase on every page load.

Resolves M5, small win on every page load
Quick reference
All 25 findings in one table, for triage.

ID	Severity	Finding	Location
C1	Critical	Full-ledger scan polled every 60s per tab	043_player_presence...sql
C2	Critical	Per-row upgrade-effect lookups in 3 tick fns	_shared/business-upgrades.ts
C3	Critical	Realtime full reconnect on every navigation	realtime-provider.tsx
H1	High	Mutation refetch races realtime refetch	mutation-sync.ts
H2	High	Per-business/per-account realtime channels	realtime-provider.tsx
H3	High	Unfiltered mail realtime broadcast	realtime-provider.tsx
H4	High	tick-wages fetches whole employee tables	tick-wages/index.ts
H5	High	Business row re-fetched 5-6x per page load	business-details-data.ts
H6	High	Global market scan on every finance load	businesses/finance.ts
H7	High	Per-purchase RPC fan-out in NPC ticks	tick-npc-*/index.ts
H8	High	No retention on 7 growth tables	supabase/migrations
M1	Medium	5 endpoints missing pagination	domains/*/service.ts
M2	Medium	Mail unread count fetches full rows	mail/service.ts
M3	Medium	Scattered N+1 write loops	financial-events.ts + 3 more
M4	Medium	Legacy shadow table rewritten every tick	tick-manufacturing/index.ts
M5	Medium	Static cities table re-queried every load	cities-travel/service.ts
M6	Medium	Admin role checked via DB, not JWT claim	route-helpers.ts
M7	Medium	No client cache/dedup layer anywhere	live-request.ts
M8	Medium	Direct browser Supabase calls bypass API	realtime-provider.tsx
M9	Medium	Missing index on retool filter columns	053_production_line...sql
M10	Medium	Hard caps silently drop rows at scale	tick-npc-*/index.ts
L1	Low	Redundant single-row lookups	employees, production, contracts
L2	Low	Per-row inserts instead of batch	banking/service.ts + tick-wages
L3	Low	Dead-code stub components	components/realtime/*
L4	Low	Inconsistent client construction	~15 API routes
lifecraftonline · supabase audit · generated 2026-08-17