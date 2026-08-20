# government Domain

New in CityPlan Phase 3 (`city_stockpiles`). CityPlan Phase 4
(Government Procurement Contracts) added `government_contract_providers` and
`government_contracts` -- kept as a separate domain from the existing
`contracts` domain (player/B2B contracts, unrelated system) specifically so
"government contract" and "player contract" never share a namespace or a
service file.

## Owns
- `city_stockpiles`
- `government_contract_providers`
- `government_contracts`

## Public API
- `getCityStockpiles()` -- raw rows (last-materialized checkpoint values)
- `getProjectedCityStockpiles()` -- rows plus a read-time-projected
  `current_quantity`/`status`, without writing (see
  `shared/cities/stockpiles.ts`)
- `getGovernmentContractProviders()` -- one row per active city
  (`provider_type: 'city'`) plus the static federal placeholder
- `getGovernmentContracts()` -- filterable list (city/provider/status/
  awarded business), bounded default limit
- `getGovernmentContractById()`
- `awardGovernmentContract()` -- a player claims an `available` contract with
  one of their businesses (`award_government_contract_atomic`, migration 119)
- `deliverGovernmentContract()` -- delivers goods against an awarded
  contract, replenishing the destination `city_stockpiles` row and paying the
  business (`deliver_government_contract_atomic`, migration 119)

## Depends On
- `cities-travel` public API from `index.ts` only (`getCities`,
  `getCityEconomicState`, `getWorldEconomicState`, `getActiveCityEvents`) --
  needed to project a stockpile's current effective stock at read time.
- `_shared/ownership` (`ensureOwnedBusiness`) -- Phase 4 needs to verify the
  calling player owns the business being used to award/deliver a contract.
  This is the domain's first dependency on `businesses` and is intentional,
  not a violation of the "no cross-domain table access" rule below (it goes
  through the shared ownership helper, not a direct `businesses` query).

## Off Limits
- Do not query/write tables owned by other domains inside `service.ts`
  except through `cities-travel`'s public API and `_shared/ownership` as
  above.
- `city_stockpiles` is not player-writable except through
  `deliver_government_contract_atomic` (the first legitimate stock-mutating
  path, per Phase 3's own forward note) -- it changes only via that RPC or
  the `materialize_*`/`create_replenishment_contracts_for_due_stockpiles`
  RPCs (all `service_role`-only, migrations 114/118), invoked by
  `tick-city-stockpiles` (every 5 minutes, now
  `materialize_and_replenish_city_stockpiles_due`) and by
  `run_government_daily_update()`'s daily pass (migration 118).
- `government_contracts`/`government_contract_providers` are not
  player-writable except through `award_government_contract_atomic` and
  `deliver_government_contract_atomic` (migration 119). Automatic
  replenishment contract creation is `service_role`-only
  (`create_replenishment_contracts_for_due_stockpiles`) -- there is no
  player-facing "create a government contract" path, by design (per the
  plan: "Contracts emerge from low stock; they are not random quests").

## Rules
- `city_stockpiles.stored_quantity`/`last_materialized_at` are a checkpoint,
  not the current truth -- always read through `getProjectedCityStockpiles()`
  (or the equivalent SQL math) rather than trusting `stored_quantity`
  directly, since it can be arbitrarily stale between materialization
  events.
- The stockpile item taxonomy deliberately reuses Phase 1's 9 raw-resource
  keys (`city_resource_modifiers`) rather than inventing a new one.
- Event-driven consumption multipliers use the `stockpile_<item_key>`
  modifier key convention on `city_events` (mirrors Phase 2's index-name-keyed
  convention). No event currently sets this key -- dormant until a future
  event does, same "architecture ready, not yet live content" pattern as
  Phase 2's event system.
- A stockpile can have at most one *live* (`available`/`awarded`/
  `in_progress`) `government_contracts` row at a time -- enforced by a
  partial unique index (`idx_government_contracts_stockpile_live`, migration
  117), not just an application-side check, so concurrent replenishment
  sweeps can never create duplicates.
- Only `provider_type = 'city'` providers get automatic replenishment
  contracts. The federal provider (`federal:us`) stays a static placeholder
  in this pass -- no recurring tick, no auto-created contracts, no effect on
  city/world economic indices. See CityPlan.md's "Federal Contract Provider -
  Initial Placeholder" for the intended future shape (agency-keyed,
  multi-city, larger contracts).
- `government_contracts.unit_price` for auto-created replenishment contracts
  comes from a small SQL-side mirror of `shared/economy.ts`'s
  `NPC_PRICE_CEILINGS` (`_government_item_base_price`, migration 118) --
  plpgsql can't import the TS module. Keep the two in sync by hand if those
  ceilings change for any of the 9 raw-resource keys; same tradeoff
  `shared/cities/stockpiles.ts` already documents for its own SQL mirror.
- Cross-city delivery is not a new freight system -- a player must already
  have moved qualifying inventory into a business located in the contract's
  destination city (e.g. via the existing `execute_inventory_transfer`
  shipping path) before `deliverGovernmentContract()` will accept it;
  otherwise it returns `{ok: false, reason: 'wrong_city'}`. That shipping
  path is now route-based (CityPlan Phase 5 -- see `cities-travel`'s
  `DOMAIN.md`), so moving contract goods into the destination city takes
  real route distance/time instead of the old region-tier estimate.
  Player-owned trucking (the reach goal) is not built yet.
