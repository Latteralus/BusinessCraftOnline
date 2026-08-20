import {
  DEFAULT_CHARGEABLE_WEIGHT_LB_PER_UNIT,
  DEFAULT_FREIGHT_RATE_PER_LB_MILE,
  LOGISTICS_TIME_SCALE,
  MINIMUM_SHIPMENT_CHARGE,
  TRAVEL_COST_PER_MILE,
  TRAVEL_MINIMUM_FARE,
} from "@/config/logistics";
import type { CityRoute, ShippingQuote, TravelQuote } from "./types";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// CityPlan Phase 5: shipmentTravelMinutes = route.baselineDriveMinutes *
// LOGISTICS_TIME_SCALE, shared by player travel and abstract shipping (and
// later trucking) so all three carriers agree on how long a route takes.
export function calculateRouteTravelMinutes(route: CityRoute): number {
  return Math.round(route.baseline_drive_minutes * LOGISTICS_TIME_SCALE);
}

export function calculateRouteTravelQuote(
  route: CityRoute,
  transportCostIndex: number
): TravelQuote {
  const minutes = calculateRouteTravelMinutes(route);
  const baseCost =
    Math.max(TRAVEL_MINIMUM_FARE, route.road_distance_miles * TRAVEL_COST_PER_MILE) +
    route.toll_cost;

  return {
    minutes,
    cost: round2(baseCost * transportCostIndex),
    distanceMiles: route.road_distance_miles,
  };
}

// freightCost = max(minimumShipmentCharge, distanceMiles * chargeableWeightLb
// * baseRatePerLbMile) * world.transportCostIndex, per the plan. No item
// carries a real unit_weight_lb yet (reach goal), so
// DEFAULT_CHARGEABLE_WEIGHT_LB_PER_UNIT stands in for it -- "start simple,
// use item weights later" per the plan's own wording.
export function calculateRouteShippingQuote(
  route: CityRoute,
  quantity: number,
  transportCostIndex: number
): ShippingQuote {
  const minutes = calculateRouteTravelMinutes(route);
  const chargeableWeightLb = quantity * DEFAULT_CHARGEABLE_WEIGHT_LB_PER_UNIT;
  const ratePerLbMile = route.base_freight_cost_per_lb_mile ?? DEFAULT_FREIGHT_RATE_PER_LB_MILE;
  const baseCost =
    Math.max(MINIMUM_SHIPMENT_CHARGE, route.road_distance_miles * chargeableWeightLb * ratePerLbMile) +
    route.toll_cost;
  const totalCost = round2(baseCost * transportCostIndex);

  return {
    minutes,
    totalCost,
    costPerUnit: quantity > 0 ? round2(totalCost / quantity) : 0,
    distanceMiles: route.road_distance_miles,
  };
}
