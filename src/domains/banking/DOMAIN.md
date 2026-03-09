# banking Domain

## Owns
- `bank_accounts`
- `transactions`
- `loans`

Banking owns all personal money movement and personal loan lifecycle logic.

## Depends On
- `auth-character` (for player identity and business level checks in API composition)

## Public API
- `ensurePersonalAccounts()`
- `getAccountsWithBalances()`
- `getTransactionHistory()`
- `transferBetweenOwnAccounts()`
- `transferBetweenPersonalAndBusiness()`
- `transferBetweenOwnBusinesses()`
- `getActiveLoan()`
- `applyForLoan()`
- `payLoan()`
- `getBankingSnapshot()`

## Off Limits
Do not query/write tables owned by other domains.

- Do not mutate balance columns in-place (ledger-only accounting).
- Do not store separate computed balances in banking tables.
