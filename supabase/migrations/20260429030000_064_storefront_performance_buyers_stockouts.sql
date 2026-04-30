-- Add buyers_count and stock_out_count to storefront performance snapshots.
-- buyers_count: number of unique NPC shoppers who made at least one purchase in this subtick.
-- stock_out_count: number of shelf positions that hit zero stock during this subtick.

ALTER TABLE market_storefront_performance_snapshots
  ADD COLUMN IF NOT EXISTS buyers_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stock_out_count INTEGER NOT NULL DEFAULT 0;
