# AIReadme

Read this before making changes.

## Project Summary
- `LifeCraftOnline` is a Next.js App Router game/economy simulation.
- Frontend and API routes live in `src/`.
- Database schema, migrations, seed data, and edge functions live in `supabase/`.
- Shared game/economy logic also exists outside the app shell in `shared/`.
- The app uses Supabase for database + realtime + edge functions.
- The client state model is `Zustand`, not React Query.

## Current Technical Direction
- Primary client state is centralized in [`src/stores/game-store.ts`](/c:/Users/Chris/OneDrive/Desktop/LifeCraftOnline/src/stores/game-store.ts).
- Server-rendered page data is pushed into that store with [`src/providers/game-hydration-provider.tsx`](/c:/Users/Chris/OneDrive/Desktop/LifeCraftOnline/src/providers/game-hydration-provider.tsx).
- Realtime updates and fallback polling are managed by [`src/providers/realtime-provider.tsx`](/c:/Users/Chris/OneDrive/Desktop/LifeCraftOnline/src/providers/realtime-provider.tsx).
- Post-mutation resync is handled by [`src/stores/mutation-sync.ts`](/c:/Users/Chris/OneDrive/Desktop/LifeCraftOnline/src/stores/mutation-sync.ts).
- Optimistic updates are handled by [`src/stores/optimistic.ts`](/c:/Users/Chris/OneDrive/Desktop/LifeCraftOnline/src/stores/optimistic.ts).
- React Query was intentionally removed. Do not reintroduce it casually.
- Live client GET requests should go through [`src/lib/client/api.ts`](/c:/Users/Chris/OneDrive/Desktop/LifeCraftOnline/src/lib/client/api.ts) and its shared cache policy helper [`src/lib/client/live-request.ts`](/c:/Users/Chris/OneDrive/Desktop/LifeCraftOnline/src/lib/client/live-request.ts) so realtime-triggered refreshes do not silently serve stale cached state.

## Non-Negotiable Repo Rules
- Read `_AI_GUIDE.md` before touching code. It currently says:
- Read target domain `DOMAIN.md` before editing domain files.
- If a task touches multiple domains, call it out first.
- Import across domains only through `@/domains/<domain>/index`.
- Use migration files for schema changes.
- Keep business logic in domain services or tick functions, not route handlers/components.
- Keep economy constants in `src/config/*`.

## High-Level Layout
- `src/app/`: Next.js pages, layouts, API routes.
- `src/app/(authenticated)/`: authenticated pages and page data loaders.
- `src/app/api/`: route handlers. These should stay thin.
- `src/domains/`: main business logic layer by domain.
- `src/config/`: game constants and balancing values.
- `src/stores/`: Zustand store, hydration helpers, optimistic/resync utilities.
- `src/providers/`: hydration and realtime providers.
- `src/lib/`: Supabase clients, auth/session helpers, utility code.
- `supabase/migrations/`: authoritative schema/history.
- `supabase/functions/`: Deno edge functions for tick systems.
- `shared/`: shared simulation/config logic reused outside page code.

## State And Data Flow
### Server path
- Authenticated pages usually load initial data in [`src/app/(authenticated)/server-data.ts`](/c:/Users/Chris/OneDrive/Desktop/LifeCraftOnline/src/app/(authenticated)/server-data.ts).
- Each page wraps its client component in `GameHydrationProvider` and passes initial payload into the store.
- Business details pages also hydrate a keyed `businessDetails` entry.

### Client path
- Client components read slices with helpers like `useBankingSlice`, `useMarketSlice`, `useBusinessDetailsSlice`, etc.
- Realtime updates patch slices incrementally.
- Mutations often do:
- optimistic update
- API request
- `syncMutationViews(...)` to refetch affected views

### Important implication
- If you change page data shape, you usually need to update all of:
- server loader in `src/app/(authenticated)/server-data.ts`
- corresponding client fetcher in `src/lib/client/queries.ts`
- hydration payload passed by the page
- realtime refresh path if that state is kept live
- If a page is refreshed from realtime and the values still look frozen, inspect both the realtime subscription path and the client fetch cache policy before assuming the DB write failed.

## Current SSOTs
- Extraction base output per tick lives in [`shared/production/extraction.ts`](/c:/Users/Chris/OneDrive/Desktop/LifeCraftOnline/shared/production/extraction.ts). Do not hardcode extraction output rates in UI components or edge functions.
- Extraction dashboard/view math lives in [`src/domains/production/view.ts`](/c:/Users/Chris/OneDrive/Desktop/LifeCraftOnline/src/domains/production/view.ts). Prefer reusing helpers like `buildExtractionOperationsView()` and `getExtractionSlotThroughput()` instead of recomputing throughput/degraded-slot logic inside components.
- Upgrade runtime defaults and multiplier helpers live in [`shared/upgrades/runtime.ts`](/c:/Users/Chris/OneDrive/Desktop/LifeCraftOnline/shared/upgrades/runtime.ts). If app-side and edge-side upgrade math drift, check this file first.

## Authentication Model
- This app uses a custom JWT cookie, not default Supabase browser session persistence.
- Session cookie constants are in [`src/lib/session.ts`](/c:/Users/Chris/OneDrive/Desktop/LifeCraftOnline/src/lib/session.ts).
- Server auth is built in [`src/lib/supabase-server.ts`](/c:/Users/Chris/OneDrive/Desktop/LifeCraftOnline/src/lib/supabase-server.ts).
- The server client injects `Authorization: Bearer <custom_session>` when present.
- `client.auth.getUser()` is overridden server-side to read and verify the custom JWT.
- Middleware in [`middleware.ts`](/c:/Users/Chris/OneDrive/Desktop/LifeCraftOnline/middleware.ts) only guards `/login` and `/register` redirects; page/API auth checks still happen in loaders/route helpers.

## Supabase Clients
- Browser client: [`src/lib/supabase.ts`](/c:/Users/Chris/OneDrive/Desktop/LifeCraftOnline/src/lib/supabase.ts)
- Server client: [`src/lib/supabase-server.ts`](/c:/Users/Chris/OneDrive/Desktop/LifeCraftOnline/src/lib/supabase-server.ts)
- Route auth helpers: [`src/app/api/_shared/route-helpers.ts`](/c:/Users/Chris/OneDrive/Desktop/LifeCraftOnline/src/app/api/_shared/route-helpers.ts)

## Supabase / Database Workflow
- All schema changes must be new SQL migrations under `supabase/migrations/`.
- Do not hand-edit schema in random scripts or route handlers.
- The migrations directory is active and large; inspect recent migrations before making assumptions.
- Seed data is in `supabase/seed.sql`.
- Local Supabase ports from [`supabase/config.toml`](/c:/Users/Chris/OneDrive/Desktop/LifeCraftOnline/supabase/config.toml):
- API: `54321`
- DB: `54322`
- Studio: `54323`

## Edge Functions / Deno
- Edge functions live in `supabase/functions/`.
- They are Deno-based, not Node-based.
- Deno config is minimal: [`supabase/functions/deno.json`](/c:/Users/Chris/OneDrive/Desktop/LifeCraftOnline/supabase/functions/deno.json)
- Current npm script for edge checking:
- `npm run typecheck:edge`
- That runs `deno check --config supabase/functions/deno.json ...`
- Tick functions in this repo include:
- `tick-extraction`
- `tick-manufacturing`
- `tick-npc-purchases`
- `tick-shipping`
- `tick-travel`
- `tick-wages`
- If you change shared files consumed by an edge function, remember that hosted behavior will not change until the relevant function is redeployed.

## Supabase CLI Notes
- Local development expects the Supabase CLI to be available.
- Common local flow:
- `supabase start`
- `supabase functions serve`
- `supabase status`
- README notes that local cron-driven tick invocation depends on a shared tick secret.
- The helper script for that is:
- `powershell -ExecutionPolicy Bypass -File scripts/set-tick-secret.ps1`
- Some commands used historically in this repo:
- `npx supabase --version`
- `npx supabase projects list`
- `npx supabase migration list --linked`
- `npx supabase functions list --project-ref <ref>`
- `npx supabase functions deploy <name>`

## Tick / Cron Architecture
- The game simulation relies on Supabase Edge Functions invoked by database cron jobs.
- README documents production/local requirements for:
- `app.settings.edge_function_base_url`
- `app.settings.edge_function_auth`
- `app.settings.edge_function_tick_secret`
- Hosted alternative uses Vault for the tick secret.
- If working on anything tick-related, read README and recent migrations first.

## Frontend Architecture
- Next.js App Router.
- Authenticated shell is composed in [`src/app/(authenticated)/layout.tsx`](/c:/Users/Chris/OneDrive/Desktop/LifeCraftOnline/src/app/(authenticated)/layout.tsx).
- `Topbar` and `RealtimeProvider` live there.
- Most page clients are large, stateful UI files under `src/app/(authenticated)/*/*Client.tsx`.
- Styling is a mix of global CSS and inline styles.

## Domain Layer Expectations
- Business logic belongs in `src/domains/*`.
- Route handlers should orchestrate auth/validation and delegate to domains.
- UI components should not become the source of truth for business rules.
- If editing a domain that has `DOMAIN.md`, read it first.

## Important Current Maintenance Notes
- React Query is gone. Do not add `useQuery`/`useMutation` patterns unless the project is intentionally migrating architecture.
- The custom hydration layer matters. Be careful not to reintroduce stale hydration bugs.
- Optimistic updates were changed during this session:
- rollback is now explicit and patch-scoped
- whole-slice rollback is intentionally removed
- If you add optimistic flows, return a precise rollback closure instead of restoring an entire slice snapshot.
- Business details hydration was tightened during this session:
- it now uses structural content signatures, not only `updated_at` and array lengths

## Recommended Way To Approach Changes
1. Identify which domain(s) the task touches.
2. Read relevant `DOMAIN.md` files and the current page/API flow.
3. Check whether the feature’s data is loaded in:
- server loader
- client fetcher
- hydration payload
- realtime refresh path
- mutation resync path
4. Check whether the logic already has an SSOT in `shared/*`, `src/config/*`, or `src/domains/*/view.ts` before adding another copy.
5. Decide whether logic belongs in:
- domain service
- config file
- API route
- edge function
- component/store
6. If changing database behavior, add a migration.
7. If changing tick behavior, inspect both SQL scheduling and Deno edge function code.
8. Run the most relevant verification command.

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
- [`_AI_GUIDE.md`](/c:/Users/Chris/OneDrive/Desktop/LifeCraftOnline/_AI_GUIDE.md)
- [`README.md`](/c:/Users/Chris/OneDrive/Desktop/LifeCraftOnline/README.md)
- [`src/app/(authenticated)/server-data.ts`](/c:/Users/Chris/OneDrive/Desktop/LifeCraftOnline/src/app/(authenticated)/server-data.ts)
- [`src/stores/game-store.ts`](/c:/Users/Chris/OneDrive/Desktop/LifeCraftOnline/src/stores/game-store.ts)
- [`src/providers/game-hydration-provider.tsx`](/c:/Users/Chris/OneDrive/Desktop/LifeCraftOnline/src/providers/game-hydration-provider.tsx)
- [`src/providers/realtime-provider.tsx`](/c:/Users/Chris/OneDrive/Desktop/LifeCraftOnline/src/providers/realtime-provider.tsx)
- [`src/stores/mutation-sync.ts`](/c:/Users/Chris/OneDrive/Desktop/LifeCraftOnline/src/stores/mutation-sync.ts)
- [`src/stores/optimistic.ts`](/c:/Users/Chris/OneDrive/Desktop/LifeCraftOnline/src/stores/optimistic.ts)
- [`src/lib/supabase-server.ts`](/c:/Users/Chris/OneDrive/Desktop/LifeCraftOnline/src/lib/supabase-server.ts)
- [`supabase/config.toml`](/c:/Users/Chris/OneDrive/Desktop/LifeCraftOnline/supabase/config.toml)

## What Not To Assume
- Do not assume Supabase default auth/session patterns are in use.
- Do not assume page data lives only in component-local state.
- Do not assume a route handler is the right place for business logic.
- Do not assume React Query exists.
- Do not assume changing one loader is enough; this app often duplicates data assembly across server loader, client fetcher, and realtime refresh paths.
