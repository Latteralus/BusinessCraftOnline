# Multiplayer Business PBBG Review - Improvement Areas

Date: 2026-03-07
Scope: Auth/session flow, API mutation paths, Supabase SQL RPCs/migrations, and tick workers.

## Critical

2. Tick edge functions are publicly triggerable (auth disabled + no in-function auth).
- Evidence:
  - `supabase/config.toml:20-36` sets `verify_jwt = false` for all tick functions.
  - `supabase/functions/tick-extraction/index.ts:121` (`Deno.serve`) has no request auth guard.
  - `supabase/functions/tick-shipping/index.ts:4` and `supabase/functions/tick-travel/index.ts:4` same pattern.
- Risk: Anyone who knows the function URL can force-run economy ticks, causing load spikes and economy manipulation cadence.
- Improve:
  - Enable JWT verification for tick endpoints, or enforce a shared secret/signed header inside each function.
  - Restrict invocation to pg_cron/service role paths only.
  - Add idempotency windows/locks per tick name to prevent burst re-entry.

## High

3. Non-atomic business creation can leave partial state.
- Evidence:
  - `src/domains/businesses/service.ts:192-227` inserts business, then inserts opening credit, then startup debit as separate operations.
- Risk: Partial failure can leave a created business missing one or both ledger entries.
- Improve:
  - Replace with one SQL RPC that inserts business + opening ledger rows in one transaction.
  - Return full created payload from RPC.

4. Non-atomic upgrade purchase can apply upgrade level without guaranteed debit.
- Evidence:
  - `src/domains/businesses/service.ts:292-334` checks balance, updates/inserts upgrade, then writes debit entry separately.
- Risk: Race/failure can create free upgrades or inconsistent balances.
- Improve:
  - Move balance check + upgrade write + debit ledger into one SQL function with locking.

5. Market transaction table allows inserts from any authenticated user.
- Evidence:
  - `supabase/migrations/20260302190000_022_market_listings.sql:102-105` policy `market_transactions_insert_authenticated` has only `auth.uid() is not null`.
- Risk: Malicious clients can forge transaction history rows (integrity/analytics pollution).
- Improve:
  - Remove direct authenticated insert policy.
  - Allow writes only through secure definer RPC/service role paths.

## Medium

6. Broad internal error-message leakage in API responses.
- Evidence:
  - Multiple routes return `error.message` to clients (example: `src/app/api/market/[id]/buy/route.ts:39-41`, `src/app/api/banking/transfer/route.ts:32-34`, `src/app/api/auth/register/route.ts:36`).
- Risk: Exposes internal schema/rpc details and validation internals useful for probing.
- Improve:
  - Return stable public error codes/messages.
  - Log full internal details server-side only.

7. Weak claim validation in custom JWT verification path.
- Evidence:
  - `src/lib/auth-jwt.ts:33` calls `jwtVerify(token, secret)` without explicit `issuer`/`audience` checks.
- Risk: Accepts any token signed by secret even if claims are for another context.
- Improve:
  - Enforce expected claims in verification (`issuer: supabase`, `audience: authenticated`, strict subject format).

8. Auth helper overrides `supabase.auth.getUser` with `as any`, reducing type safety and maintainability.
- Evidence:
  - `src/lib/supabase-server.ts:26-43` monkey-patches auth client method and returns `as any`.
- Risk: Easy to drift from expected behavior and hide integration bugs.
- Improve:
  - Wrap auth in explicit `getAuthedUser()` helper type instead of mutating SDK object.
  - Keep SDK methods intact.

## Reliability and Performance Improvements

1. Reduce N+1 query patterns in extraction tick.
- Evidence: `supabase/functions/tick-extraction/index.ts:151-293` fetches business/employee/assignment/tool data per slot.
- Improve:
  - Batch-read by ids up front and process from in-memory maps.
  - Consider SQL-side batch procedure for deterministic tick throughput.

2. Add explicit concurrency controls for high-frequency APIs.
- Apply request idempotency keys for purchase/transfer endpoints.
- Add `pg_advisory_xact_lock` or equivalent lock strategy in critical RPCs where cadence matters.

3. Improve observability and abuse detection.
- Add per-function rate telemetry and caller identity markers.
- Alert on unusual tick invocation frequency and high error bursts.

## Testing Gaps (Highest Priority)

1. Integration tests for atomic invariants:
- market buy: listing qty/reserved, seller/buyer ledgers, inventory movement.
- inventory transfer (same city vs shipping): exact debit behavior and arrival delivery.
- business creation and upgrade purchase rollback behavior on injected failures.

2. Security tests:
- unauthorized invocation attempts against tick endpoints.
- forged insert attempts into `market_transactions`.

3. Concurrency tests:
- simultaneous purchase of same listing.
- simultaneous upgrade purchases and repeated transfer requests.

## Suggested Execution Order

1. Fix shipping charge settlement atomically.
2. Lock down tick function invocation.
3. Convert create business and upgrade purchase to transactional RPCs.
4. Tighten market transaction insert policy.
5. Standardize API error surfaces and add integration tests.
