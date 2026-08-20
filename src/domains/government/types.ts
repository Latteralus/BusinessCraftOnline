import type { StockpileStatus } from "../../../shared/cities/stockpiles";

export type CityStockpile = {
  id: string;
  city_id: string;
  item_key: string;
  stored_quantity: number;
  target_quantity: number;
  reorder_point: number;
  critical_point: number;
  base_consumption_per_hour: number;
  minimum_quality: number;
  last_materialized_at: string;
  next_reorder_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

// Adds a read-time projection of the stockpile's *current* effective stock
// (see shared/cities/stockpiles.ts) without requiring a fresh materialize
// write for every read -- stored_quantity/last_materialized_at above remain
// the last-written checkpoint, current_quantity is the projected value.
export type ProjectedCityStockpile = CityStockpile & {
  current_quantity: number;
  status: StockpileStatus;
};

export type { StockpileStatus };
