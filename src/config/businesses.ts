export const BUSINESS_TYPES = [
  "mine",
  "farm",
  "water_company",
  "logging_camp",
  "oil_well",
  "sawmill",
  "metalworking_factory",
  "food_processing_plant",
  "winery_distillery",
  "carpentry_workshop",
  "general_store",
  "specialty_store",
] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const BUSINESS_ENTITY_TYPES = [
  "sole_proprietorship",
  "llc",
] as const;

export type BusinessEntityType = (typeof BUSINESS_ENTITY_TYPES)[number];

export const STARTUP_COSTS: Record<BusinessType, number> = {
  mine: 3500,
  farm: 2500,
  water_company: 2000,
  logging_camp: 3000,
  oil_well: 4500,
  sawmill: 4000,
  metalworking_factory: 5500,
  food_processing_plant: 3500,
  winery_distillery: 5000,
  carpentry_workshop: 4500,
  general_store: 4000,
  specialty_store: 3500,
};

export const BUSINESS_UPGRADE_KEYS_BY_TYPE: Record<BusinessType, readonly string[]> = {
  mine: ["extraction_efficiency", "worker_capacity", "tool_durability", "ore_quality"],
  farm: ["crop_yield", "water_efficiency", "seed_efficiency", "worker_capacity"],
  water_company: ["extraction_efficiency", "worker_capacity"],
  logging_camp: ["extraction_efficiency", "worker_capacity", "tool_durability"],
  oil_well: ["extraction_efficiency", "worker_capacity", "tool_durability"],
  sawmill: ["production_efficiency", "worker_capacity", "equipment_quality", "input_reduction"],
  metalworking_factory: [
    "production_efficiency",
    "worker_capacity",
    "equipment_quality",
    "input_reduction",
  ],
  food_processing_plant: [
    "production_efficiency",
    "worker_capacity",
    "equipment_quality",
    "input_reduction",
  ],
  winery_distillery: [
    "production_efficiency",
    "worker_capacity",
    "equipment_quality",
    "input_reduction",
  ],
  carpentry_workshop: [
    "production_efficiency",
    "worker_capacity",
    "equipment_quality",
    "input_reduction",
  ],
  general_store: ["storefront_appeal", "listing_capacity", "customer_service"],
  specialty_store: ["storefront_appeal", "listing_capacity", "customer_service"],
};

export const BUSINESS_UPGRADE_BASE_COSTS = {
  extraction_efficiency: 500,
  worker_capacity: 2000,
  tool_durability: 1500,
  ore_quality: 1000,
  crop_yield: 400,
  water_efficiency: 600,
  seed_efficiency: 800,
  production_efficiency: 600,
  equipment_quality: 1200,
  input_reduction: 1800,
  storefront_appeal: 800,
  listing_capacity: 1000,
  customer_service: 1500,
} as const;

export const BUSINESS_UPGRADE_KEYS = [
  "extraction_efficiency",
  "worker_capacity",
  "tool_durability",
  "ore_quality",
  "crop_yield",
  "water_efficiency",
  "seed_efficiency",
  "production_efficiency",
  "equipment_quality",
  "input_reduction",
  "storefront_appeal",
  "listing_capacity",
  "customer_service",
] as const;

export type BusinessUpgradeKey = (typeof BUSINESS_UPGRADE_KEYS)[number];

export const EXTRACTION_BASE_RATE_PER_MINUTE = 1;
export const MANUFACTURING_TICK_MINUTES = 10;
