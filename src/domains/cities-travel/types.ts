import type { CityRegion } from "@/config/cities";

export type City = {
  id: string;
  name: string;
  state: string;
  region: CityRegion;
  slug: string;
  available_resources: string[];
  population_baseline: number | null;
  business_tax_rate: number | null;
  property_cost_index: number;
  utility_cost_index: number;
  base_labor_index: number;
  latitude: number | null;
  longitude: number | null;
  is_active: boolean;
  created_at: string;
};

export type CityResourceModifier = {
  id: string;
  city_id: string;
  resource_key: string;
  abundance_multiplier: number;
  notes: string | null;
  updated_at: string;
};

export type CityRoute = {
  id: string;
  from_city_id: string;
  to_city_id: string;
  road_distance_miles: number;
  baseline_drive_minutes: number;
  base_freight_cost_per_lb_mile: number | null;
  toll_cost: number;
  is_active: boolean;
  created_at: string;
};

export type WorldEconomicState = {
  id: number;
  labor_index: number;
  consumer_demand_index: number;
  municipal_consumption_index: number;
  transport_cost_index: number;
  inflation_index: number;
  economic_day: number;
  last_government_update_at: string | null;
  updated_at: string;
};

export type CityEconomicState = {
  city_id: string;
  population: number;
  population_growth_index: number;
  labor_supply_index: number;
  labor_demand_index: number;
  consumer_demand_index: number;
  municipal_consumption_index: number;
  economic_activity_index: number;
  economic_day: number;
  last_government_update_at: string | null;
  updated_at: string;
};

export type EconomicEventType =
  | "population_boom"
  | "labor_shortage"
  | "recession"
  | "construction_surge"
  | "drought"
  | "energy_shock"
  | "migration_inflow";

export type WorldEvent = {
  id: string;
  event_type: EconomicEventType;
  display_name: string;
  modifiers: Record<string, number>;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  created_at: string;
};

export type CityEvent = {
  id: string;
  city_id: string;
  event_type: EconomicEventType;
  display_name: string;
  modifiers: Record<string, number>;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
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
