# Completed Work

## Phase 0 — Project Scaffold
Status: Completed

Completed items:
- Next.js + TypeScript + Tailwind scaffold initialized
- Supabase project structure created (`supabase/migrations`, `supabase/functions`, `supabase/seed.sql`, `supabase/config.toml`)
- Core domain folder structure created under `src/domains/*`
- Base config files seeded under `src/config/*`
- Root guidance files initialized (`_AI_GUIDE.md`, `.env.example`, `README.md`)
- Baseline migration placeholder added (`supabase/migrations/20260301000000_init.sql`)
- Build and typecheck verified

## Phase 1 — auth-character
Status: Implemented (pending migration apply + human confirmation)

Completed items:
- Added auth-character migrations:
  - `supabase/migrations/20260302090000_001_players.sql`
  - `supabase/migrations/20260302090100_002_characters.sql`
- Implemented auth-character domain:
  - `src/domains/auth-character/DOMAIN.md`
  - `src/domains/auth-character/types.ts`
  - `src/domains/auth-character/validations.ts`
  - `src/domains/auth-character/service.ts`
  - `src/domains/auth-character/index.ts`
- Added Supabase server client helper: `src/lib/supabase-server.ts`
- Added auth and character API routes:
  - `/api/auth/register`
  - `/api/auth/login`
  - `/api/auth/logout`
  - `/api/auth/me`
  - `/api/character`
- Added session middleware: `middleware.ts`
- Added Phase 1 pages:
  - `/register`
  - `/login`
  - `/character-setup`
  - `/dashboard`
- Verified `npm run typecheck` and `npm run build` pass

## Phase 2 — cities-travel
Status: Implemented (pending migration apply + human confirmation)

Completed items:
- Added cities-travel migrations:
  - `supabase/migrations/20260302100000_003_cities.sql`
  - `supabase/migrations/20260302100100_004_travel.sql`
  - `supabase/migrations/20260302100200_005_shipping_queue.sql`
- Implemented cities-travel domain:
  - `src/domains/cities-travel/DOMAIN.md`
  - `src/domains/cities-travel/types.ts`
  - `src/domains/cities-travel/validations.ts`
  - `src/domains/cities-travel/service.ts`
  - `src/domains/cities-travel/index.ts`
- Added cities-travel API routes:
  - `/api/cities`
  - `/api/travel`
  - `/api/travel/quote`
- Added Phase 2 page:
  - `/travel`
- Integrated travel status into dashboard:
  - `/dashboard` shows current city and travel status
- Updated middleware protected paths to include `/travel`
- Verified `npm run typecheck` passes

## Locked Domains
- (none)

## Next Domain Target
- `businesses` (Phase 5) after Phase 4 confirmation

## Phase 3 — banking
Status: Implemented (pending migration apply + human confirmation)

Completed items:
- Added banking migrations:
  - `supabase/migrations/20260302110000_006_bank_accounts.sql`
  - `supabase/migrations/20260302110100_007_transactions.sql`
  - `supabase/migrations/20260302110200_008_loans.sql`
- Added banking config constants:
  - `src/config/banking.ts`
- Implemented banking domain:
  - `src/domains/banking/DOMAIN.md`
  - `src/domains/banking/types.ts`
  - `src/domains/banking/validations.ts`
  - `src/domains/banking/service.ts`
  - `src/domains/banking/index.ts`
- Added banking API routes:
  - `/api/banking/accounts`
  - `/api/banking/transfer`
  - `/api/banking/transactions`
  - `/api/banking/loan`
  - `/api/banking/loan/payment`
- Added Phase 3 page:
  - `/banking`
- Integrated banking snapshot into dashboard and linked Banking page
- Updated middleware protected paths to include `/banking`
- Verified `npm run typecheck` and `npm run build` pass

## Phase 4 — inventory
Status: Implemented (pending migration apply + human confirmation)

Completed items:
- Added inventory migrations:
  - `supabase/migrations/20260302120000_009_personal_inventory.sql`
  - `supabase/migrations/20260302120100_010_business_inventory.sql`
- Added shipping config constants:
  - `src/config/cities.ts` (`SHIPPING_COST_PER_UNIT_BY_TIER`)
- Implemented inventory domain:
  - `src/domains/inventory/DOMAIN.md`
  - `src/domains/inventory/types.ts`
  - `src/domains/inventory/validations.ts`
  - `src/domains/inventory/service.ts`
  - `src/domains/inventory/index.ts`
- Added inventory API routes:
  - `/api/inventory`
  - `/api/inventory/transfer`
- Added Phase 4 page:
  - `/inventory`
- Updated middleware protected paths to include `/inventory`
- Verified `npm run typecheck` and `npm run build` pass

## Phase 5 — businesses
Status: Implemented (pending migration apply + human confirmation)

Completed items:
- Added businesses migrations:
  - `supabase/migrations/20260302130000_011_businesses.sql`
  - `supabase/migrations/20260302130100_012_business_accounts.sql`
  - `supabase/migrations/20260302130200_013_business_upgrades.sql`
- Expanded businesses config constants and enums:
  - `src/config/businesses.ts`
- Implemented businesses domain:
  - `src/domains/businesses/DOMAIN.md`
  - `src/domains/businesses/types.ts`
  - `src/domains/businesses/validations.ts`
  - `src/domains/businesses/service.ts`
  - `src/domains/businesses/index.ts`
- Added businesses API routes:
  - `/api/businesses`
  - `/api/businesses/[id]`
  - `/api/businesses/[id]/upgrade`
- Added Phase 5 page:
  - `/businesses`
- Integrated business summary cards/links into dashboard:
  - `/dashboard` now shows businesses summary and link to `/businesses`
- Updated protected paths to include `/businesses`
- Updated root nav links to include `/businesses`
- Verified `npm run typecheck` and `npm run build` pass

## Phase 6 — employees
Status: Implemented (pending migration apply + human confirmation)

Completed items:
- Added employees migrations:
  - `supabase/migrations/20260302140000_014_employees.sql`
  - `supabase/migrations/20260302140100_015_employee_assignments.sql`
  - `supabase/migrations/20260302140200_016_employee_skills.sql`
- Expanded employees config constants and enums:
  - `src/config/employees.ts`
- Implemented employees domain:
  - `src/domains/employees/DOMAIN.md`
  - `src/domains/employees/types.ts`
  - `src/domains/employees/validations.ts`
  - `src/domains/employees/service.ts`
  - `src/domains/employees/index.ts`
- Added employees API routes:
  - `/api/employees`
  - `/api/employees/[id]`
  - `/api/employees/assign`
  - `/api/employees/reactivate`
  - `/api/employees/unassign`
- Added Phase 6 page:
  - `/employees`
- Integrated employee summary into dashboard:
  - `/dashboard` now shows employee counts and link to `/employees`
- Updated protected paths to include `/employees`
- Updated root nav links to include `/employees`
- Verified `npm run typecheck` and `npm run build` pass

## Phase 7 — upgrades
Status: Implemented (pending migration apply + human confirmation)

Completed items:
- Added upgrades migration:
  - `supabase/migrations/20260302150000_017_upgrade_definitions.sql`
- Expanded upgrades formula config and calculators:
  - `src/config/upgrades.ts`
- Implemented upgrades domain:
  - `src/domains/upgrades/DOMAIN.md`
  - `src/domains/upgrades/types.ts`
  - `src/domains/upgrades/validations.ts`
  - `src/domains/upgrades/service.ts`
  - `src/domains/upgrades/index.ts`
- Added upgrades API routes:
  - `/api/upgrades`
  - `/api/upgrades/preview`
- Integrated upgrades domain into business purchase flow:
  - `src/domains/businesses/service.ts` now sources upgrade cost/constraints from upgrades definitions
- Updated businesses UI upgrade selection and previews:
  - `src/app/businesses/page.tsx`
- Verified `npm run typecheck` and `npm run build` pass

## Phase 8 — production + tick-extraction
Status: Implemented (pending migration apply + human confirmation)

Completed items:
- Added production migrations:
  - `supabase/migrations/20260302160000_018_extraction_slots.sql`
  - `supabase/migrations/20260302160100_019_tool_durability.sql`
- Added production config constants and extraction mappings:
  - `src/config/production.ts`
- Implemented production domain:
  - `src/domains/production/DOMAIN.md`
  - `src/domains/production/types.ts`
  - `src/domains/production/validations.ts`
  - `src/domains/production/service.ts`
  - `src/domains/production/index.ts`
- Added production API routes:
  - `/api/production`
  - `/api/production/slots/assign`
  - `/api/production/slots/unassign`
  - `/api/production/slots/tool`
  - `/api/production/slots/status`
- Implemented extraction tick function behavior:
  - `supabase/functions/tick-extraction/index.ts`
- Verified `npm run typecheck` and `npm run build` pass

## Phase 9 — manufacturing + production UI
Status: Implemented (pending migration apply + human confirmation)

Completed items:
- Added manufacturing migration:
  - `supabase/migrations/20260302170000_020_manufacturing_jobs.sql`
- Expanded production config constants and recipe mappings:
  - `src/config/production.ts`
- Expanded production domain manufacturing contracts/services:
  - `src/domains/production/DOMAIN.md`
  - `src/domains/production/types.ts`
  - `src/domains/production/validations.ts`
  - `src/domains/production/service.ts`
  - `src/domains/production/index.ts`
- Added production manufacturing API route:
  - `/api/production/manufacturing`
- Added Phase 9 production page:
  - `/production`
- Integrated navigation and route protection for production page:
  - `src/app/page.tsx`
  - `src/app/dashboard/page.tsx`
  - `middleware.ts`
- Implemented manufacturing tick function behavior:
  - `supabase/functions/tick-manufacturing/index.ts`
- Verified `npm run typecheck` and `npm run build` pass

## Phase 10 — market tick NPC purchases integration
Status: Implemented (pending migration apply + human confirmation)

Completed items:
- Implemented NPC purchase processing in tick function:
  - `supabase/functions/tick-npc-purchases/index.ts`
- Added store business filtering, listing-attempt scaling, and demand/conversion simulation
- Added pricing against item ceilings with quality and customer-service adjustments
- Added inventory decrement and cleanup for sold quantities
- Added business ledger entries for sale credits and market fee debits:
  - `public.business_accounts` writes with `npc_sale` and `market_fee` categories
- Verified regression checks:
  - `npm run typecheck`
  - `npm run build`

## Phase 11 — contracts domain + API + tick + UI
Status: Implemented (pending migration apply + human confirmation)

Completed items:
- Added contracts migration:
  - `supabase/migrations/20260302180000_021_contracts.sql`
- Implemented contracts domain:
  - `src/domains/contracts/DOMAIN.md`
  - `src/domains/contracts/types.ts`
  - `src/domains/contracts/validations.ts`
  - `src/domains/contracts/service.ts`
  - `src/domains/contracts/index.ts`
- Added contracts API routes:
  - `/api/contracts`
  - `/api/contracts/[id]`
  - `/api/contracts/[id]/accept`
  - `/api/contracts/[id]/cancel`
  - `/api/contracts/[id]/fulfill`
- Integrated contract settlement logic into manufacturing tick:
  - `supabase/functions/tick-manufacturing/index.ts`
- Added Phase 11 contracts page:
  - `/contracts`
- Integrated navigation and route protection for contracts page:
  - `src/app/page.tsx`
  - `src/app/dashboard/page.tsx`
  - `middleware.ts`
- Verified `npm run typecheck` and `npm run build` pass

## Phase 12 — market listings + API + UI + NPC listing consumption
Status: Implemented (pending migration apply + human confirmation)

Completed items:
- Added market schema migration:
  - `supabase/migrations/20260302190000_022_market_listings.sql`
- Implemented market domain:
  - `src/domains/market/DOMAIN.md`
  - `src/domains/market/types.ts`
  - `src/domains/market/validations.ts`
  - `src/domains/market/service.ts`
  - `src/domains/market/index.ts`
- Added market API routes:
  - `/api/market`
  - `/api/market/[id]/buy`
  - `/api/market/[id]/cancel`
- Refactored NPC purchase tick to consume active market listings:
  - `supabase/functions/tick-npc-purchases/index.ts`
- Added Phase 12 market page:
  - `/market`
- Integrated navigation and route protection for market page:
  - `src/app/page.tsx`
  - `src/app/dashboard/page.tsx`
  - `middleware.ts`
- Verified `npm run typecheck` and `npm run build` pass

## Phase 13 — sub-tick shopper simulation + demand curve + feed fidelity
Status: Implemented (pending migration apply + human confirmation)

Completed items:
- Added sub-tick state and transaction fidelity migration:
  - `supabase/migrations/20260302200000_023_market_subtick_state.sql`
- Extended market config and types for shopper behavior + demand windows:
  - `src/config/market.ts`
  - `src/domains/market/types.ts`
- Extended market domain services with sub-tick state persistence and enriched transaction metadata:
  - `src/domains/market/service.ts`
  - `src/domains/market/index.ts`
- Extended market API listing endpoint for transaction feed reads:
  - `src/app/api/market/route.ts`
- Implemented deterministic NPC sub-tick shopper loop with:
  - demand-curve-scaled shopper counts
  - weighted shopper tiers + budgets
  - strict item price-ceiling enforcement
  - 5% price-band quality preference selection
  - shopper/sub-tick transaction attribution
  - `supabase/functions/tick-npc-purchases/index.ts`
- Added minimal UI feed updates to market + dashboard:
  - `src/app/market/page.tsx`
  - `src/app/dashboard/page.tsx`
- Verified `npm run typecheck` and `npm run build` pass

## Phase 14 — economy automation ticks (wages, shipping, travel)
Status: Implemented (pending migration apply + human confirmation)

Completed items:
- Added wage automation migration for unpaid gating + hourly idempotency markers:
  - `supabase/migrations/20260302210000_024_economy_automation_wages.sql`
- Added wage automation tick function:
  - `supabase/functions/tick-wages/index.ts`
  - hourly wage debits from `business_accounts`
  - insufficient-funds flow marks employee `unpaid`
  - auto-unassigns unpaid workers (no firing)
- Added shipping delivery tick function:
  - `supabase/functions/tick-shipping/index.ts`
  - delivers due `shipping_queue` rows to personal/business inventory
  - marks delivered shipments
- Added travel arrival tick function:
  - `supabase/functions/tick-travel/index.ts`
  - finalizes due `travel_log` rows as arrived
  - updates `characters.current_city_id`
- Enforced unpaid worker assignment/reactivation gate:
  - `src/domains/employees/service.ts`
- Added minimal dashboard automation visibility (unpaid workers + due shipping/travel counters):
  - `src/app/dashboard/page.tsx`
- Verified `npm run typecheck` and `npm run build` pass

## Phase 15 — storefront management (ad budget + traffic multipliers)
Status: Implemented (pending migration apply + human confirmation)

Completed items:
- Added storefront settings schema migration:
  - `supabase/migrations/20260302220000_025_market_storefront_settings.sql`
- Extended market domain types, validations, and services for storefront settings:
  - `src/domains/market/types.ts`
  - `src/domains/market/validations.ts`
  - `src/domains/market/service.ts`
  - `src/domains/market/index.ts`
- Added dedicated storefront API route:
  - `src/app/api/market/storefront/route.ts`
- Extended market API listing route to optionally include storefront payloads:
  - `src/app/api/market/route.ts`
- Integrated storefront controls into market UI:
  - `src/app/market/page.tsx`
- Added dashboard storefront summary indicators:
  - `src/app/dashboard/page.tsx`
- Integrated storefront factors into NPC demand simulation and ad spend debits:
  - `supabase/functions/tick-npc-purchases/index.ts`
  - `src/config/market.ts`
- Verified `npm run typecheck` and `npm run build` pass

## Phase 16 — economy observability (tick logs + storefront metrics + admin summaries)
Status: Implemented (pending migration apply + human confirmation)

Completed items:
- Added observability migration with admin role + analytics tables:
  - `supabase/migrations/20260302230000_026_economy_observability.sql`
  - Adds `players.role` (`player|admin`) with default `player`
  - Adds `tick_run_logs` with indexes + authenticated read policy
  - Adds `market_storefront_performance_snapshots` with owner/admin read policies
- Extended auth-character and market contracts for analytics typing:
  - `src/domains/auth-character/types.ts`
  - `src/domains/market/types.ts`
  - `src/domains/market/service.ts`
  - `src/domains/market/index.ts`
- Added admin-safe analytics endpoint (role-gated admin summary):
  - `src/app/api/analytics/route.ts`
- Instrumented tick functions to write structured run logs:
  - `supabase/functions/tick-wages/index.ts`
  - `supabase/functions/tick-shipping/index.ts`
  - `supabase/functions/tick-travel/index.ts`
  - `supabase/functions/tick-npc-purchases/index.ts`
- Added storefront performance snapshot writes in NPC market tick:
  - `supabase/functions/tick-npc-purchases/index.ts`
- Added dashboard analytics cards (tick health + storefront ROI posture + admin extras):
  - `src/app/dashboard/page.tsx`
- Verified `npm run typecheck` and `npm run build` pass

## Phase 17 — full front-end overhaul (global shell + cohesive UI)
Status: Implemented (pending human confirmation)

Completed items:
- Added shared visual foundation and responsive shell inspired by `Documents/Example.html`:
  - `src/app/globals.css`
  - `src/app/layout.tsx`
- Added reusable UI primitives for future incremental composition:
  - `src/components/ui/primitives.tsx`
- Updated route-level UX shell and page framing while preserving all game logic and API behavior:
  - `src/app/page.tsx`
  - `src/app/login/page.tsx`
  - `src/app/register/page.tsx`
  - `src/app/character-setup/page.tsx`
  - `src/app/dashboard/page.tsx`
  - `src/app/businesses/page.tsx`
  - `src/app/inventory/page.tsx`
  - `src/app/market/page.tsx`
  - `src/app/employees/page.tsx`
  - `src/app/production/page.tsx`
  - `src/app/contracts/page.tsx`
  - `src/app/travel/page.tsx`
  - `src/app/banking/page.tsx`
- Preserved existing gameplay interactions and API contracts across all updated pages.
- Verified `npm run typecheck` and `npm run build` pass after overhaul.
