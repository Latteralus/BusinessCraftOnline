# production Domain

## Owns
- `extraction_slots`
- `tool_durability`
- `manufacturing_jobs`

This domain owns extraction slot orchestration, tool installation/durability state, and
production status aggregation for extraction businesses, plus manufacturing job
recipe/run-state management.

## Public API
- `ensureExtractionSlots()`
- `getProductionStatus()`
- `assignExtractionSlot()`
- `unassignExtractionSlot()`
- `installToolForSlot()`
- `setExtractionSlotStatus()`
- `getManufacturingStatus()`
- `setManufacturingRecipe()`
- `startManufacturing()`
- `stopManufacturing()`
- Validation schemas from `validations.ts`

## Off Limits
- Do not write to businesses-owned tables (`businesses`, `business_accounts`, `business_upgrades`).
- Do not write to employees-owned tables (`employees`, `employee_assignments`, `employee_skills`).
- Do not write to upgrades-owned tables (`upgrade_definitions`).
- Do not run tick logic in this domain (tick functions own scheduled processing).
