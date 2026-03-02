# cities-travel Domain

## Owns
- `cities`
- `travel_log`
- `shipping_queue`

## Public API
- `getCities()`
- `getCityById()`
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
