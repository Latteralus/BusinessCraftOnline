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
