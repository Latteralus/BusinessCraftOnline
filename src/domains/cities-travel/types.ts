import type { CityRegion } from "@/config/cities";

export type City = {
  id: string;
  name: string;
  state: string;
  region: CityRegion;
  slug: string;
  available_resources: string[];
  created_at: string;
};

export type TravelStatus = "traveling" | "arrived" | "cancelled";

export type TravelLog = {
  id: string;
  player_id: string;
  from_city_id: string;
  to_city_id: string;
  departs_at: string;
  arrives_at: string;
  cost: number;
  status: TravelStatus;
  created_at: string;
};

export type ShippingStatus = "in_transit" | "delivered" | "cancelled";

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
  destination_type: "personal" | "business";
  destination_id: string;
  status: ShippingStatus;
  created_at: string;
};

export type TravelTier =
  | "same_region"
  | "adjacent_region"
  | "cross_country"
  | "far_cross_country";

export type TravelQuote = {
  tier: TravelTier;
  minutes: number;
  cost: number;
};

export type StartTravelInput = {
  playerId: string;
  fromCityId: string;
  toCityId: string;
  cost: number;
  arrivesAt: string;
};

export type StartTravelRequest = {
  toCityId: string;
};
