# cities-travel Domain

## Owns
- `cities`
- `city_resource_modifiers`
- `city_routes`
- `city_economic_state`
- `world_economic_state`
- `city_events`
- `world_events`
- `travel_log`
- `shipping_queue`

## Public API
- `getCities()`
- `getCityById()`
- `getCityResourceModifiers()`
- `getCityRoutes()`
- `getRouteBetweenCities()`
- `getCityEconomicState()`
- `getWorldEconomicState()`
- `getActiveCityEvents()`
- `getActiveWorldEvents()`
- `getActiveTravel()`
- `startTravel()`
- `cancelTravel()`
- `completeTravel()`
- `canPurchaseBusiness()`
- `calculateTravelQuote()`

## Depends On
- `auth-character` public API from `index.ts` only (used at API route composition layer)

## Off Limits
- Do not query/write tables owned by other domains inside `service.ts`

## Rules
- Travel status is authoritative in `travel_log`
- One active travel row per player at a time (`status = traveling`)
- While active travel exists, business purchase checks must return `canPurchaseBusiness = false`
- `city_resource_modifiers.abundance_multiplier` affects extraction *quantity* only, never quality (see `shared/cities/resources.ts`, consumed by `tick-extraction`). Do not fold it into any QL calculation.
- `city_routes` is currently reference data only (distance/drive-time/freight-cost matrix). Player travel and shipping quotes still use the region-tier system in `topology.ts` — `city_routes` is not wired into `calculateTravelQuote`/`calculateShippingQuote` yet (CityPlan Phase 5 will do that when abstract freight moves to route-based timing).
- `cities`, `city_resource_modifiers`, and `city_routes` have no RLS write policy for `authenticated` — they change only via migration, matching `cities`' existing pattern. Do not add player-facing write paths without deliberately reconsidering this.
- `city_economic_state` and `world_economic_state` (CityPlan Phase 2) are dynamic but still not player-writable — they change only via the `run_government_daily_update` RPC (`service_role`-only, migration 112), invoked at most once per 24h economic day by `tick-government-daily`. Do not write to them from route handlers or client mutations.
- `city_events`/`world_events` are time-bounded, typed-modifier-payload rows started/ended by the same daily RPC. No event rows are seeded yet — the tables are architecture, not live content, for Phase 2 (mirrors how Phase 1 left `city_routes` as reference-only data ahead of Phase 5).
- The labor formulas (`cityLaborPressure`, `effectiveCityLaborIndex`, `expectedWage`) live in `shared/cities/labor.ts`, mirroring `shared/cities/resources.ts`'s SSOT pattern. Nothing calls `getExpectedWage` yet — wiring it into employee hiring/candidate wage generation is deferred (see `Documents/changelog.md`, CityPlan Phase 2 entry).
