# market Domain

## Owns
- `public.market_listings`
- `public.market_transactions`
- Listing lifecycle (`active` → `filled`/`cancelled`/`expired`)
- Player/NPC purchase settlement for listing-backed sales

## Public API
- `getMarketListings`
- `createMarketListing`
- `cancelMarketListing`
- `buyMarketListing`
- `recordNpcPurchase`
- Validation schemas exported from `validations.ts`

## Off Limits
- Do not mutate non-market domain tables except approved integration points:
  - reserve/consume seller inventory rows when creating or filling listings
  - write seller business account entries for credits/fees
