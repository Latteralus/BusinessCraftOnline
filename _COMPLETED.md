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
