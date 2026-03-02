# businesses Domain

## Owns
- `businesses`
- `business_accounts` (ledger entries)
- `business_upgrades`

This domain owns business registration/purchase checks, business ledger balance derivation,
and business upgrade purchasing.

## Public API
- `getPlayerBusinesses()`
- `getBusinessesWithBalances()`
- `getBusinessDetail()`
- `getBusinessSummary()`
- `createBusiness()`
- `purchaseUpgrade()`
- `addBusinessAccountEntry()`
- Validation schemas from `validations.ts`

## Off Limits
- Do not query/write banking-owned tables (`bank_accounts`, `transactions`, `loans`).
- Do not query/write auth-owned tables except read-only ownership/city checks through public APIs.
- Do not implement travel logic here; call cities-travel public API helpers only.
