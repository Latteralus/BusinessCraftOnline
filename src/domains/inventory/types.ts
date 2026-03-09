export type InventoryLocationType = "personal" | "business";

export type ShippingStatus = "in_transit" | "delivered" | "cancelled";

export type PersonalInventoryItem = {
  id: string;
  player_id: string;
  item_key: string;
  quantity: number;
  quality: number;
  updated_at: string;
  created_at: string;
};

export type BusinessInventoryItem = {
  id: string;
  owner_player_id: string;
  business_id: string;
  city_id: string;
  item_key: string;
  quantity: number;
  quality: number;
  reserved_quantity: number;
  unit_cost?: number | null;
  total_cost?: number | null;
  updated_at: string;
  created_at: string;
};

export type ShippingQueueItem = {
  id: string;
  owner_player_id: string;
  from_city_id: string;
  to_city_id: string;
  item_key: string;
  quantity: number;
  cost: number;
  dispatched_at: string;
  arrives_at: string;
  destination_type: InventoryLocationType;
  destination_id: string;
  status: ShippingStatus;
  created_at: string;
};

export type TransferItemsInput = {
  sourceType: InventoryLocationType;
  sourceBusinessId?: string;
  sourceCityId?: string;
  destinationType: InventoryLocationType;
  destinationBusinessId?: string;
  destinationCityId?: string;
  itemKey: string;
  quantity: number;
  quality: number;
  fundingAccountId?: string;
  shippingCost?: number;
  shippingMinutes?: number;
};

export type TransferOutcome = {
  transferType: "same_city" | "shipping";
  shippingQueueItem: ShippingQueueItem | null;
  shippingCost: number;
  shippingMinutes: number;
};
