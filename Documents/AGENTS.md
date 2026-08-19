# AGENTS.md — Quick Reference

This file is a living, fast-to-read snapshot for whichever AI agent picks up work on
LifeCraftOnline next. It is not the canonical architecture doc (that's `AI_GUIDE.md`)
and not a dated history (that's `changelog.md`) — it's the "what should I already know
before I start" cheat sheet. Keep it current: update it whenever you learn something
a future session would otherwise have to re-derive.

## Read order for a new session
1. This file.
2. `Documents/AI_GUIDE.md` — architecture, domain rules, data-flow contracts. Read the
   relevant domain's `DOMAIN.md` too if one exists.
3. `Documents/changelog.md` — what actually changed recently and why, newest first.
4. `Documents/Notes.md` — feature plans (currently: internal mail system design).
5. `Documents/economy-audit-2026-03-09.md` — balancing proposals. **Not applied** to
   `src/config/*` as of the last check — treat its numbers as proposed, not live.

## Current dependency baseline (updated 2026-08-15)
```
next               16.3.1
react / react-dom  19.2.8
typescript         6.0.2   (bumped from 5.9.2 — verified clean typecheck + build)
@supabase/ssr      0.12.4
@supabase/supabase-js  2.112.3
zustand            5.0.15
zod                4.4.3
react-hook-form    7.85.0
tailwindcss        3.4.18  (intentionally held — Tailwind 4 is a config migration, not done)
```
Verified via clean `node_modules` + `package-lock.json` reinstall, `npm run typecheck`,
and `npm run build` — all passed with no errors. If a future bump touches TypeScript
again, re-run both before trusting it; TS majors are the most likely to surface new
`tsc --noEmit` failures in this codebase's strict-ish config.

## Non-obvious facts worth not re-discovering
- **Auth is a custom JWT cookie**, not default Supabase session persistence. See
  `src/lib/session.ts` / `src/lib/supabase-server.ts`. Don't assume `supabase.auth`
  browser session helpers work here.
- **Service-role client lives in its own file** (`src/lib/supabase-service-role.ts`)
  specifically so it never pulls in `next/headers` — several domain service files
  (`businesses/service.ts`, `banking/service.ts`) are imported by client components,
  and importing `next/headers` transitively into that graph breaks the client build.
- **Mutation pattern**: optimistic update via `runOptimisticUpdate` (`src/stores/optimistic.ts`)
  → fire API call → `syncMutationViews(...)` (`src/stores/mutation-sync.ts`) to refetch
  affected slices. If a page's data looks frozen after an action, check both the
  optimistic/resync call site AND the realtime subscription gating before assuming the
  DB write failed.
- **Realtime subscriptions are gated** by `activeRealtimeModules` (route-based) and
  `trackedBusinessDetailIds` (which business detail panels are actually loaded into the
  store right now) in `src/providers/realtime-provider.tsx` — NavBarFix made business
  selection render in-place without changing the URL, so pathname-only gating misses
  that case; this has bitten the codebase before (changelog 2026-08-15, item 6).
- **Hosted Supabase cannot `ALTER DATABASE ... SET app.settings.*`** — the tick
  cron→edge-function base URL is controlled by a **hardcoded fallback** baked into
  `invoke_edge_function()`. If the linked Supabase project ref ever changes, that
  fallback must be fixed via a new migration; there's no config-based override on
  hosted projects. This has silently broken all ticks before (changelog 2026-08-15).
- **Client GETs must go through** `src/lib/client/api.ts` (which uses
  `src/lib/client/live-request.ts` to force `cache: "no-store"` on GETs) so
  realtime-triggered refreshes don't serve stale cached responses. Confirmed correct
  as of 2026-08-15 — this was ruled out as the cause of a reported stale-UI bug.
- Some RPCs are **service_role-only by design** (`append_personal_transaction`,
  `append_business_account_entry`, `append_business_financial_event`) — never grant
  these to `authenticated`; call only from server code via the service-role client.

## Open threads (update or remove as they resolve)
- **2026-08-19 — Migration 097 (baseline schema grants) not yet pushed to
  hosted.** A from-scratch local `supabase db reset` left `anon`/
  `authenticated`/`service_role` with zero base table privileges (every
  migration here runs as `postgres`, but this project's `pg_default_acl`
  only auto-grants full privileges to those roles for objects created by
  `supabase_admin`) — discovered while building the AccountingFixPlan Phase
  A finance test suite. Fixed locally by migration 097; run `npx supabase db
  push` before assuming hosted needs it too (it may already work there via
  the control plane's own grant mechanism, separate from migration
  history — not confirmed either way). See `changelog.md` (2026-08-19).
- **2026-08-17 — H7 batched NPC-sale settlement RPC unexercised against real
  data.** `settle_store_inventory_sales_atomic` (migration 092) and the
  tick-npc-purchases rewrite that calls it are deployed and running clean,
  but this environment has no store businesses yet, so every run so far has
  settled an empty batch (`storesProcessed: 0`). Worth a manual smoke test —
  create a store, stock a shelf, let a tick run, check `market_transactions`
  and `business_accounts` land correctly — before fully trusting it under
  real NPC traffic. See `changelog.md` (2026-08-17).
- **2026-08-17 — M6 admin role staleness.** `requireAdminUser` now trusts an
  `app_role` claim embedded in the session JWT at login instead of querying
  `players` per request. A role change (grant or revoke) only takes effect
  on that player's next login — up to `CUSTOM_SESSION_TTL_SECONDS` (48h)
  later — since there's no session-revocation mechanism. Fine for a single
  admin account pre-launch; revisit if/when there are multiple admins. Any
  admin session signed before this change lacks the claim and needs a
  re-login to be recognized as admin again.

## Resolved
- **2026-08-15 — NPC open-market purchases built but not deployed.** Confirmed
  resolved as of 2026-08-17: `tick-npc-market-purchases` is live on the hosted
  project, `tick_run_logs` shows it running `status: "ok"` on its `* * * * *`
  cadence. (Deployed sometime between 2026-08-15 and 2026-08-17; this note was
  stale.)
- **2026-08-15 — Stale UI until manual refresh.** Root cause was a race condition, not
  a missing resync call: `syncMutationViews` (fired after a mutation's own API call)
  and the realtime provider (fired off the DB's postgres_changes notification for the
  same table) both refetch the same slice independently, and with no ordering
  guarantee the slower response — even if staler — could land last and silently
  overwrite the newer one. Fixed with a shared per-slice generation counter,
  `src/stores/slice-fetch-guard.ts` (`runGuardedSliceFetch`/`SLICE_KEYS`), used by both
  `src/stores/mutation-sync.ts` and `src/providers/realtime-provider.tsx` — a fetch's
  result is only committed if no newer fetch for that same slice key has started since.
  Also fixed along the way: `BankingClient.tsx` had five independent submit flags
  instead of one shared lock (now unified under `allBusy`); `EmployeesClient.tsx`'s
  roster actions (reactivate/unassign/fire) had no in-flight guard at all; three
  manufacturing-line actions in `BusinessDetailsClient.tsx` never called
  `syncMutationViews`; `ProductionClient.tsx`'s `setRecipe`/`setRunning` used a raw
  `fetch()` and never resynced `businessDetails`. Full detail in `changelog.md`
  (2026-08-15 entry, "Fixed stale-UI-until-refresh bug"). **If a future session sees
  this symptom again**, first check whether a new mutation site was added that fetches
  a slice directly (via `fetchXPageData` or a raw `apiGet`) without going through
  `runGuardedSliceFetch`/`syncMutationViews` — that's the most likely way to
  reintroduce it.

## Package manager reinstall recipe (Windows/PowerShell)
```powershell
Remove-Item -Recurse -Force node_modules
Remove-Item -Force package-lock.json
npm install
npm run typecheck
npm run build
```
