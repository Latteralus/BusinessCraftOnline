# Changelog

Running history of notable changes to LifeCraftOnline — what was done, why, and anything important for later. Newest entries at the top. This is a project log, not a marketing changelog: include infra/security context and open follow-ups, not just feature names.

When adding an entry: date it, say what changed and why, link the relevant migration/commit/file, and note anything still open or worth watching.

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
