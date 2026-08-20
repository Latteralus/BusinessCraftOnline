# government Domain

New in CityPlan Phase 3. Will also own `government_contracts` and
`government_contract_providers` once Phase 4 (Government Procurement
Contracts) is built -- kept as a separate domain from the existing
`contracts` domain (player/B2B contracts, unrelated system) specifically so
"government contract" and "player contract" never share a namespace or a
service file.

## Owns
- `city_stockpiles`

## Public API
- `getCityStockpiles()` -- raw rows (last-materialized checkpoint values)
- `getProjectedCityStockpiles()` -- rows plus a read-time-projected
  `current_quantity`/`status`, without writing (see
  `shared/cities/stockpiles.ts`)

## Depends On
- `cities-travel` public API from `index.ts` only (`getCities`,
  `getCityEconomicState`, `getWorldEconomicState`, `getActiveCityEvents`) --
  needed to project a stockpile's current effective stock at read time.

## Off Limits
- Do not query/write tables owned by other domains inside `service.ts`
  except through `cities-travel`'s public API as above.
- `city_stockpiles` is not player-writable. It changes only via the
  `materialize_city_stockpiles_due` / `materialize_all_active_city_stockpiles`
  RPCs (both `service_role`-only, migration 114), invoked by
  `tick-city-stockpiles` (every 5 minutes) and by
  `run_government_daily_update()`'s daily pass (migration 115). Do not add a
  player-facing write path without deliberately reconsidering this -- Phase 4
  will introduce the first legitimate stock-mutating path (contract
  delivery), and even that will go through a dedicated atomic RPC, not a
  direct table write from a route handler.

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
