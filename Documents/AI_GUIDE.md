# LifeCraftOnline — AI & Developer Guide

Read this before touching code. It replaces the old `_AI_GUIDE.md`, `AIReadme.md`, and `README.md` (now combined here).

## Project Summary
- `LifeCraftOnline` is a Next.js App Router game/economy simulation.
- Frontend and API routes live in `src/`.
- Database schema, migrations, seed data, and edge functions live in `supabase/`.
- Shared game/economy logic also exists outside the app shell in `shared/`.
- The app uses Supabase for database + realtime + edge functions.
- The client state model is `Zustand`, not React Query (React Query was intentionally removed — do not reintroduce it casually).

## Non-Negotiable Repo Rules
- Read the target domain's `DOMAIN.md` before editing domain files.
- If a task touches multiple domains, call it out first.
- Import across domains only through `@/domains/<domain>/index`.
- Use migration files for schema changes. Never hand-edit schema in the dashboard or in random scripts.
- Keep business logic in domain services or tick functions, not route handlers/components.
- Keep economy constants in `src/config/*`.

## High-Level Layout
- `src/app/`: Next.js pages, layouts, API routes.
- `src/app/(authenticated)/`: authenticated pages and page data loaders.
- `src/app/api/`: route handlers. These should stay thin.
- `src/domains/`: main business logic layer, organized by domain.
- `src/config/`: game constants and balancing values.
- `src/stores/`: Zustand store, hydration helpers, optimistic/resync utilities.
- `src/providers/`: hydration and realtime providers.
- `src/lib/`: Supabase clients, auth/session helpers, utility code.
- `supabase/migrations/`: authoritative schema/history.
- `supabase/functions/`: Deno edge functions for tick systems.
- `shared/`: shared simulation/config logic reused outside the app shell (also imported directly by edge functions).

## State And Data Flow

### Server path
- Authenticated pages usually load initial data in `src/app/(authenticated)/server-data.ts`.
- Each page wraps its client component in `GameHydrationProvider` and passes the initial payload into the store.
- Business details pages also hydrate a keyed `businessDetails` entry.

### Client path
- Client components read slices with helpers like `useBankingSlice`, `useMarketSlice`, `useBusinessDetailsSlice`, etc.
- Realtime updates patch slices incrementally.
- Mutations typically: apply an optimistic update → fire the API request → call `syncMutationViews(...)` to refetch affected views.
- Optimistic flows should return a precise, patch-scoped rollback closure rather than restoring an entire slice snapshot.
- Live client GET requests should go through `src/lib/client/api.ts` and its shared cache-policy helper `src/lib/client/live-request.ts`, so realtime-triggered refreshes don't silently serve stale cached state.

### Important implication
- If you change page data shape, you usually need to update all of:
  - the server loader in `src/app/(authenticated)/server-data.ts`
  - the corresponding client fetcher in `src/lib/client/queries.ts`
  - the hydration payload passed by the page
  - the realtime refresh path, if that state is kept live
- If a page is refreshed from realtime and the values still look frozen, inspect both the realtime subscription path and the client fetch cache policy before assuming the DB write failed.

## Current SSOTs
- Extraction base output per tick lives in `shared/production/extraction.ts`. Do not hardcode extraction output rates in UI components or edge functions.
- Extraction dashboard/view math lives in `src/domains/production/view.ts`. Prefer reusing helpers like `buildExtractionOperationsView()` and `getExtractionSlotThroughput()` instead of recomputing throughput/degraded-slot logic inside components.
- Upgrade runtime defaults and multiplier helpers live in `shared/upgrades/runtime.ts`. If app-side and edge-side upgrade math drift, check this file first.

## Authentication Model
- This app uses a custom JWT cookie, not default Supabase browser session persistence.
- Session cookie constants are in `src/lib/session.ts`.
- Server auth is built in `src/lib/supabase-server.ts`. The server client injects `Authorization: Bearer <custom_session>` when present, and `client.auth.getUser()` is overridden server-side to read and verify the custom JWT.
- The service-role client (`src/lib/supabase-service-role.ts`) is kept in a **separate file with no `next/headers` import** on purpose — several domain service files (e.g. `businesses/service.ts`, `banking/service.ts`) are also imported by client components for read-only queries, and importing `next/headers` transitively into that module graph breaks the client build. Only use the service-role client for RPCs explicitly locked to `service_role` (see Supabase / Database Workflow below).
- Middleware in `middleware.ts` only guards `/login` and `/register` redirects; page/API auth checks still happen in loaders/route helpers (`requireAuthedUser` / `requireAdminUser` in `src/app/api/_shared/route-helpers.ts`).

## Supabase Clients
- Browser client: `src/lib/supabase.ts`
- Server client (user-scoped, RLS-enforced): `src/lib/supabase-server.ts`
- Service-role client (bypasses RLS — internal helpers only): `src/lib/supabase-service-role.ts`
- Route auth helpers: `src/app/api/_shared/route-helpers.ts`

## Supabase / Database Workflow
- All schema changes must be new SQL migrations under `supabase/migrations/`. Do not hand-edit schema in the dashboard or in ad hoc scripts.
- The migrations directory is active and large; inspect recent migrations before making assumptions about current schema.
- Seed data: city/item/upgrade rows are inserted directly by their owning migrations (e.g. cities in migration `003_cities`), not `supabase/seed.sql` — that file is currently just a placeholder for future dev-only seed rows.
- Some RPCs are intentionally restricted to `service_role` and must never be granted to `authenticated` — e.g. `append_personal_transaction` and `append_business_account_entry` are internal ledger-append helpers, not public API. If a player could call them directly via PostgREST with their own JWT, they could credit themselves arbitrary funds. Call these only from server code, using the service-role client.
- Local Supabase ports from `supabase/config.toml`: API `54321`, DB `54322`, Studio `54323`.

## Edge Functions / Deno
- Edge functions live in `supabase/functions/`. They are Deno-based, not Node-based.
- Deno config: `supabase/functions/deno.json`.
- Type-check them with `npm run typecheck:edge` (runs `deno check --config supabase/functions/deno.json ...`).
- Tick functions in this repo: `tick-extraction`, `tick-manufacturing`, `tick-npc-purchases`, `tick-shipping`, `tick-travel`, `tick-wages`.
- If you change shared files consumed by an edge function, hosted behavior will not change until that function is redeployed (`npx supabase functions deploy <name>`, or omit the name to deploy all).

## Tick / Cron Architecture
- The simulation relies on Postgres `pg_cron` jobs calling `invoke_edge_function(function_name)`, which does an async `net.http_post` to the hosted edge function with an `x-tick-secret` header.
- `invoke_edge_function` resolves its target base URL and secret in this order:
  1. `current_setting('app.settings.edge_function_base_url' / '...tick_secret', true)` — a database-level override.
  2. If unset, a **hardcoded fallback URL** baked into the function body, and the tick secret from Postgres Vault (`vault.decrypted_secrets` row named `edge_function_tick_secret`).
- **Hosted Supabase does not allow `ALTER DATABASE ... SET app.settings.*`** (permission denied for that role), so the database-level override in step 1 is not available on hosted projects in practice. This means the hardcoded fallback URL is what actually matters — if the project's ref ever changes (new project, migrated project, etc.), that fallback must be corrected via a new migration (`create or replace function invoke_edge_function...`), because there is no other way to fix it. See changelog 2026-08-15 for a case where this fallback pointed at a dead, unrelated project ref for a long time.
- To (re)configure the tick secret used by both sides:
  - Edge function side: `npx supabase secrets set TICK_FUNCTION_SECRET="..."`
  - Database side: `select vault.create_secret('...', 'edge_function_tick_secret', 'Tick secret');`
  - Both values must match exactly.
- Local dev fallback (Docker): base URL defaults to `http://host.docker.internal:54321/functions/v1/`, and the tick secret can be set locally with `ALTER DATABASE postgres SET app.settings.edge_function_tick_secret = '...'` (permitted locally, unlike on hosted).
- Helper script: `powershell -ExecutionPolicy Bypass -File scripts/set-tick-secret.ps1` updates `.env.local` and `supabase/functions/.env.local` together for local dev.
- Verify ticks are actually running with: `select tick_name, status, started_at, error_message from tick_run_logs order by started_at desc limit 20;`

## Supabase CLI Notes
- Local flow: `supabase start`, `supabase functions serve`, `supabase status`.
- Useful commands against the linked hosted project:
  - `npx supabase migration list` — compare local vs. remote applied migrations.
  - `npx supabase db push` — apply pending local migrations to the linked remote project.
  - `npx supabase db query --linked "<sql>"` or `--file <path>` — run arbitrary read/write SQL against the linked project (no local Docker required).
  - `npx supabase functions deploy` — deploy all edge functions; add a name to deploy just one.
  - `npx supabase secrets set NAME=value` — set an edge function secret.
  - `npx supabase projects list` / `npx supabase projects api-keys --project-ref <ref>` — confirm which project is actually linked and fetch its keys.
- `npx supabase db dump` and `npx supabase db diff` require Docker Desktop; they will fail with a clear error if it isn't running. `db query` does not require Docker.
- Before assuming a linked project is empty or "yours," list its tables (`select table_name from information_schema.tables where table_schema = 'public'`) — a project can already be in use for something else.

## Frontend Architecture
- Next.js App Router.
- The authenticated shell is composed in `src/app/(authenticated)/layout.tsx`; `Topbar` and `RealtimeProvider` live there.
- Most page clients are large, stateful UI files under `src/app/(authenticated)/*/*Client.tsx`.
- Styling is a mix of global CSS and inline styles.

## Domain Layer Expectations
- Business logic belongs in `src/domains/*`.
- Route handlers should orchestrate auth/validation and delegate to domains.
- UI components should not become the source of truth for business rules.
- If editing a domain that has a `DOMAIN.md`, read it first.

## Recommended Way To Approach Changes
1. Identify which domain(s) the task touches.
2. Read the relevant `DOMAIN.md` file(s) and the current page/API flow.
3. Check whether the feature's data is loaded in the server loader, client fetcher, hydration payload, realtime refresh path, and mutation resync path.
4. Check whether the logic already has an SSOT in `shared/*`, `src/config/*`, or `src/domains/*/view.ts` before adding another copy.
5. Decide whether the logic belongs in a domain service, config file, API route, edge function, or component/store.
6. If changing database behavior, add a migration.
7. If changing tick behavior, inspect both the SQL scheduling and the Deno edge function code.
8. Run the most relevant verification command (see below).
9. Add an entry to `Documents/changelog.md` once the change is done, especially for anything touching security, schema, or infra.

## Useful Commands
- Install deps: `npm install`
- Dev server: `npm run dev`
- Build: `npm run build`
- TypeScript check: `npm run typecheck`
- Edge function type check: `npm run typecheck:edge`
- Start local Supabase: `supabase start`
- Serve edge functions locally: `supabase functions serve`
- Check local Supabase status: `supabase status`

## Files Worth Reading Early
- This file.
- The relevant domain's `DOMAIN.md`, e.g. `src/domains/<domain>/DOMAIN.md`.
- `Documents/changelog.md` — running history of what's been done and why.
- `Documents/Bugs.md` — security review findings; check for still-open items before assuming the economy RPCs are safe.
- `Documents/economy-audit-2026-03-09.md` — economy balancing analysis and proposed rebalancing; check whether proposals have been applied before citing its numbers as current.
- `Documents/Notes.md` — feature plans (currently: the internal mail system plan).
- `src/stores/game-store.ts`, `src/providers/game-hydration-provider.tsx`, `src/providers/realtime-provider.tsx`, `src/stores/mutation-sync.ts`, `src/stores/optimistic.ts`.
- `src/lib/supabase-server.ts`, `src/lib/supabase-service-role.ts`.
- `supabase/config.toml`.

## What Not To Assume
- Do not assume Supabase's default auth/session patterns are in use — this app uses a custom JWT cookie.
- Do not assume page data lives only in component-local state.
- Do not assume a route handler is the right place for business logic.
- Do not assume React Query exists.
- Do not assume changing one loader is enough; this app often duplicates data assembly across the server loader, client fetcher, and realtime refresh paths.
- Do not assume a linked Supabase project is empty, or is the project the deployed app actually uses — verify both.
- Do not assume `Documents/economy-audit-2026-03-09.md`'s numbers reflect the current live config — check `src/config/*` and recent migrations first.
