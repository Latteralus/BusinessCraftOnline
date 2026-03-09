-- Allow market listings to be fully consumed by setting quantity to 0.
-- Active listings are still created with positive quantities by application validation.

alter table public.market_listings
  drop constraint if exists market_listings_quantity_check;

alter table public.market_listings
  add constraint market_listings_quantity_check
  check (quantity >= 0);
