// CityPlan Phase 5 - Route-Based Abstract Freight. Centralizes the tuning
// constants for route-derived travel/shipping timing and cost so pacing can
// be adjusted here without touching city_routes data or its schema (per the
// plan's own instruction).

// 1.0 = real-world driving pace (city_routes.baseline_drive_minutes is
// seeded at ~55mph). Scale this down later if game pacing needs shorter
// trips; the route data itself should not change.
export const LOGISTICS_TIME_SCALE = 1.0;

// Player travel fare: a flat per-mile rate with a floor so short hops
// (e.g. two adjacent cities) aren't effectively free.
export const TRAVEL_COST_PER_MILE = 0.1;
export const TRAVEL_MINIMUM_FARE = 40;

// Freight cost placeholder until per-item unit_weight_lb metadata exists
// (the trucking reach goal's "Item logistics metadata"). Every item is
// treated as weighing this many lb/unit so
// distanceMiles * chargeableWeightLb * baseRatePerLbMile stays in a sane
// dollar range today; swap this for real per-item weights once they land.
export const DEFAULT_CHARGEABLE_WEIGHT_LB_PER_UNIT = 0.1;

// Fallback only -- every seeded city_routes row already has
// base_freight_cost_per_lb_mile = 0.015 (migration 111).
export const DEFAULT_FREIGHT_RATE_PER_LB_MILE = 0.015;

export const MINIMUM_SHIPMENT_CHARGE = 5;
