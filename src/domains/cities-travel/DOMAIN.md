# cities-travel Domain

## Owns
- `cities`
- `city_resource_modifiers`
- `city_routes`
- `travel_log`
- `shipping_queue`

## Public API
- `getCities()`
- `getCityById()`
- `getCityResourceModifiers()`
- `getCityRoutes()`
- `getRouteBetweenCities()`
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
