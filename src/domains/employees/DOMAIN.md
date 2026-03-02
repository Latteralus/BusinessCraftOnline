# employees Domain

## Owns
- `employees`
- `employee_assignments`
- `employee_skills`

This domain owns employee lifecycle and assignment state:
- Hiring and firing
- Assignment and unassignment to owned businesses
- Shift timer state and re-activation
- Employee skill records and wage snapshot-at-assignment

## Public API
- `getPlayerEmployees()`
- `getEmployeeById()`
- `getEmployeeSummary()`
- `hireEmployee()`
- `assignEmployee()`
- `reactivateEmployee()`
- `unassignEmployee()`
- `fireEmployee()`
- Validation schemas from `validations.ts`

## Off Limits
- Do not write to `businesses`, `business_accounts`, or `business_upgrades`.
- Do not write to `bank_accounts`, `transactions`, or `loans`.
- Do not implement production-tick or wage-tick processing here.
- Do not import deep files from other domains. Use public exports only.
