# inventory Domain

## Owns
- `personal_inventory`
- `business_inventory`

Inventory owns item storage, item movement, and shipping enqueue logic for cross-city transfers.

## Depends On
- `auth-character` (player + current city context in API composition)
- `cities-travel` (route timing/cost quote and shipping queue ownership)
- `banking` (funding validation in API composition)

## Public API
- `getPersonalInventory()`
- `getBusinessInventory()`
- `getShippingQueue()`
- `transferItems()`
- `transferItemsSchema`

## Off Limits
Do not query/write tables owned by other domains.

- Do not write directly to `shipping_queue` from routes/components.
- Do not place transfer rules in API handlers or UI components.
