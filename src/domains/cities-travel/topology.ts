import type { CityRegion } from "@/config/cities";
import type { City, TravelQuote, TravelTier } from "./types";

type TravelTierDetails = {
  minutes: number;
  cost: number;
  shippingCostPerUnit: number;
};

const TRAVEL_TIER_DETAILS: Record<TravelTier, TravelTierDetails> = {
  same_region: { minutes: 30, cost: 50, shippingCostPerUnit: 0.05 },
  adjacent_region: { minutes: 90, cost: 120, shippingCostPerUnit: 0.12 },
  cross_country: { minutes: 240, cost: 280, shippingCostPerUnit: 0.25 },
  far_cross_country: { minutes: 180, cost: 200, shippingCostPerUnit: 0.3 },
};

const ADJACENT_REGIONS: Record<CityRegion, CityRegion[]> = {
  Northeast: ["Midwest", "Southeast"],
  West: ["Southwest", "Mountain"],
  Midwest: ["Northeast", "South", "Mountain"],
  South: ["Midwest", "Southeast", "Southwest"],
  Southwest: ["West", "South", "Mountain"],
  Mountain: ["West", "Midwest", "Southwest"],
  Southeast: ["Northeast", "South"],
};

const FAR_CROSS_COUNTRY_PAIRS = new Set([
  "southeast:mountain",
  "mountain:southeast",
]);

function getRouteKey(fromRegion: CityRegion, toRegion: CityRegion) {
  return `${fromRegion.toLowerCase()}:${toRegion.toLowerCase()}`;
}

export function classifyTravelTier(from: City, to: City): TravelTier {
  if (from.id === to.id) {
    throw new Error("Origin and destination cannot be the same city.");
  }

  if (from.region === to.region) {
    return "same_region";
  }

  if (FAR_CROSS_COUNTRY_PAIRS.has(getRouteKey(from.region, to.region))) {
    return "far_cross_country";
  }

  if (ADJACENT_REGIONS[from.region].includes(to.region)) {
    return "adjacent_region";
  }

  return "cross_country";
}

export function getTravelTierDetails(tier: TravelTier): TravelTierDetails {
  return TRAVEL_TIER_DETAILS[tier];
}

export function calculateTravelQuote(from: City, to: City): TravelQuote {
  const tier = classifyTravelTier(from, to);
  const details = getTravelTierDetails(tier);

  return {
    tier,
    minutes: details.minutes,
    cost: details.cost,
  };
}

export function calculateShippingQuote(from: City, to: City, quantity: number) {
  const tier = classifyTravelTier(from, to);
  const details = getTravelTierDetails(tier);

  return {
    tier,
    minutes: details.minutes,
    costPerUnit: details.shippingCostPerUnit,
    totalCost: Number((quantity * details.shippingCostPerUnit).toFixed(2)),
  };
}
