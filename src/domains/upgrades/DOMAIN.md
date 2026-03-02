# upgrades Domain

## Owns
- `upgrade_definitions` (read-mostly system table seeded by migration)

This domain owns upgrade metadata and formula calculators. Business-owned upgrade state
(`business_upgrades`) remains owned by the businesses domain.

## Public API
- `getUpgradeDefinitions()`
- `getUpgradeDefinitionByKey()`
- `getUpgradeDefinitionsForBusinessType()`
- `calculateUpgradePreview()`
- Validation schemas from `validations.ts`

## Off Limits
- Do not write to `business_upgrades` or `business_accounts` (owned by businesses).
- Do not write to banking-owned tables (`bank_accounts`, `transactions`, `loans`).
- Do not include tick processing logic in this domain.
