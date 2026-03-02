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
};

export type MarketTransaction = {
  id: string;
  listing_id: string | null;
  seller_player_id: string;
  buyer_player_id: string | null;
  buyer_type: "player" | "npc";
  seller_business_id: string;
  buyer_business_id: string | null;
  city_id: string;
  item_key: string;
  quality: number;
  quantity: number;
  unit_price: number;
  gross_total: number;
  market_fee: number;
  net_total: number;
  created_at: string;
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
  buyerBusinessId?: string;
};

export type RecordNpcPurchaseInput = {
  listingId: string;
  quantity: number;
};
