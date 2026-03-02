# contracts Domain

## Owns
- `public.contracts`
- Contract lifecycle state transitions (`open` → `accepted`/`in_progress` → `fulfilled`/`cancelled`/`expired`)
- Contract payout bookkeeping through business ledger writes on fulfillment

## Public API
- `getContracts`
- `getContractById`
- `createContract`
- `acceptContract`
- `cancelContract`
- `fulfillContract`
- Validation schemas from `validations.ts`

## Off Limits
- Do not mutate non-contract domain state except approved integration points:
  - read owned business context
  - consume business inventory for fulfillment
  - write business account entries for contract payout
