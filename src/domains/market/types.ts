export const MARKET_LISTING_STATUSES = ["active", "filled", "cancelled", "expired"] as const;
export type MarketListingStatus = (typeof MARKET_LISTING_STATUSES)[number];

export type MarketListing = {
  id: string;
  owner_player_id: string;
  source_business_id: string;
  source_inventory_id: string | null;
  city_id: string;
  item_key: string;
  quality: number;
  quantity: number;
  reserved_quantity: number;
  unit_price: number;
  listing_type: "sell";
  status: MarketListingStatus;
  expires_at: string | null;
  filled_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  business?: { name: string };
};

export type MarketTransaction = {
  id: string;
  listing_id: string | null;
  seller_player_id: string;
  buyer_player_id: string | null;
  buyer_type: "player" | "npc";
  seller_business_id: string;
  seller_business_name: string | null;
  buyer_business_id: string | null;
  buyer_business_name: string | null;
  city_id: string;
  item_key: string;
  quality: number;
  quantity: number;
  unit_price: number;
  gross_total: number;
  market_fee: number;
  net_total: number;
  shopper_name: string | null;
  shopper_tier: string | null;
  shopper_budget: number | null;
  sub_tick_index: number | null;
  tick_window_started_at: string | null;
  created_at: string;
};

export type MarketTransactionFilter = {
  buyerType?: "player" | "npc";
};

export type NpcShopperTierKey = "small" | "medium" | "large";

export type NpcMarketSubtickState = {
  state_key: string;
  tick_window_started_at: string;
  sub_tick_index: number;
  updated_at: string;
};

export type MarketStorefrontSetting = {
  id: string;
  owner_player_id: string;
  business_id: string;
  ad_budget_per_tick: number;
  traffic_multiplier: number;
  is_ad_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type TickRunStatus = "ok" | "error";

export type TickRunLog = {
  id: string;
  tick_name: string;
  status: TickRunStatus;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  processed_count: number;
  metrics: Record<string, unknown>;
  error_message: string | null;
  created_at: string;
};

export type MarketStorefrontPerformanceSnapshot = {
  id: string;
  owner_player_id: string;
  business_id: string;
  city_id: string;
  tick_window_started_at: string | null;
  sub_tick_index: number | null;
  shoppers_generated: number;
  sales_count: number;
  units_sold: number;
  gross_revenue: number;
  fee_total: number;
  ad_spend: number;
  traffic_multiplier: number;
  demand_multiplier: number;
  captured_at: string;
};

export type StorefrontPerformanceBusinessSummary = {
  business_id: string;
  business_name: string;
  ad_spend: number;
  gross_revenue: number;
  fee_total: number;
  net_revenue: number;
  sales_count: number;
  units_sold: number;
  shoppers_generated: number;
  roi: number | null;
};

export type StorefrontPerformanceSummary = {
  window_hours: number;
  captured_from: string;
  captured_to: string;
  ad_spend: number;
  gross_revenue: number;
  fee_total: number;
  net_revenue: number;
  sales_count: number;
  units_sold: number;
  shoppers_generated: number;
  roi: number | null;
  businesses: StorefrontPerformanceBusinessSummary[];
};

export type TickHealthSummary = {
  window_hours: number;
  captured_from: string;
  captured_to: string;
  total_runs: number;
  error_runs: number;
  success_rate: number;
  recent_runs: TickRunLog[];
  by_tick: Array<{
    tick_name: string;
    total_runs: number;
    error_runs: number;
    success_rate: number;
    average_duration_ms: number;
    last_status: TickRunStatus;
    last_finished_at: string;
  }>;
};

export type AdminEconomySummary = {
  tick_health: TickHealthSummary;
  storefront_performance: {
    window_hours: number;
    captured_from: string;
    captured_to: string;
    snapshots: number;
    ad_spend: number;
    gross_revenue: number;
    fee_total: number;
    net_revenue: number;
    sales_count: number;
    units_sold: number;
    shoppers_generated: number;
    roi: number | null;
  };
};

export type MarketListingFilter = {
  cityId?: string;
  itemKey?: string;
  status?: MarketListingStatus;
  ownOnly?: boolean;
};

export type CreateMarketListingInput = {
  sourceBusinessId: string;
  itemKey: string;
  quality: number;
  quantity: number;
  unitPrice: number;
  expiresAt?: string;
};

export type CancelMarketListingInput = {
  listingId: string;
};

export type BuyMarketListingInput = {
  listingId: string;
  quantity: number;
  buyerBusinessId: string;
};

export type RecordNpcPurchaseInput = {
  listingId: string;
  quantity: number;
};

export type MarketStorefrontFilter = {
  businessId?: string;
};

export type UpdateMarketStorefrontSettingsInput = {
  businessId: string;
  adBudgetPerTick: number;
  trafficMultiplier: number;
  isAdEnabled: boolean;
};
