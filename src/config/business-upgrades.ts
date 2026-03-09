import type { BusinessType } from "./businesses";

export const UPGRADE_EFFECT_KINDS = [
  "multiplier",
  "reduction_multiplier",
  "flat_slots",
  "flat_quality",
  "price_tolerance",
  "traffic_multiplier",
  "conversion_multiplier",
] as const;

export type UpgradeEffectKind = (typeof UPGRADE_EFFECT_KINDS)[number];

export const UPGRADE_FAMILIES = [
  "extraction",
  "capacity",
  "durability",
  "quality",
  "manufacturing",
  "store",
] as const;

export type UpgradeFamily = (typeof UPGRADE_FAMILIES)[number];

export const UPGRADE_PROJECT_CATEGORIES = [
  "equipment",
  "facility",
  "systems",
  "staffing",
  "storefront",
] as const;

export type UpgradeProjectCategory = (typeof UPGRADE_PROJECT_CATEGORIES)[number];

export const UPGRADE_STAGES = ["early", "mid", "late", "specialization"] as const;
export type UpgradeStage = (typeof UPGRADE_STAGES)[number];

export const UPGRADE_UI_FORMATS = [
  "percent_up",
  "percent_down",
  "flat_integer",
  "quality_points",
] as const;

export type UpgradeUiFormat = (typeof UPGRADE_UI_FORMATS)[number];

export const UPGRADE_DOWNTIME_POLICIES = ["none", "partial", "full"] as const;
export type UpgradeDowntimePolicy = (typeof UPGRADE_DOWNTIME_POLICIES)[number];

export type BusinessUpgradeDefinition = {
  key: BusinessUpgradeKey;
  family: UpgradeFamily;
  displayName: string;
  shortDescription: string;
  immersiveLabel: string;
  projectCategory: UpgradeProjectCategory;
  appliesTo: readonly BusinessType[];
  effectKind: UpgradeEffectKind;
  baseCost: number;
  costMultiplier: number;
  baseEffect: number;
  gainMultiplier: number;
  installTimeMinutes: number;
  downtimePolicy: UpgradeDowntimePolicy;
  stage: UpgradeStage;
  maxLevel: number | null;
  isInfinite: boolean;
  uiFormat: UpgradeUiFormat;
  effectLabel: string;
};

export const BUSINESS_UPGRADE_KEYS = [
  "extraction_efficiency",
  "worker_capacity",
  "tool_durability",
  "ore_quality",
  "crop_yield",
  "water_efficiency",
  "production_efficiency",
  "equipment_quality",
  "input_reduction",
  "storefront_appeal",
  "listing_capacity",
  "customer_service",
] as const;

export type BusinessUpgradeKey = (typeof BUSINESS_UPGRADE_KEYS)[number];

export const BUSINESS_UPGRADE_DEFINITIONS: Record<BusinessUpgradeKey, BusinessUpgradeDefinition> = {
  extraction_efficiency: {
    key: "extraction_efficiency",
    family: "extraction",
    displayName: "Extraction Efficiency",
    shortDescription: "Improves extraction output per tick.",
    immersiveLabel: "Flow routing, drill pacing, and load-out tuning.",
    projectCategory: "equipment",
    appliesTo: ["mine", "water_company", "logging_camp", "oil_well"],
    effectKind: "multiplier",
    baseCost: 900,
    costMultiplier: 1.35,
    baseEffect: 1.08,
    gainMultiplier: 1.05,
    installTimeMinutes: 45,
    downtimePolicy: "partial",
    stage: "early",
    maxLevel: null,
    isInfinite: true,
    uiFormat: "percent_up",
    effectLabel: "Output multiplier",
  },
  worker_capacity: {
    key: "worker_capacity",
    family: "capacity",
    displayName: "Worker Capacity",
    shortDescription: "Adds production positions and floor capacity.",
    immersiveLabel: "Additional staging area, lane access, and crew coverage.",
    projectCategory: "facility",
    appliesTo: [
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
    ],
    effectKind: "flat_slots",
    baseCost: 2200,
    costMultiplier: 1.4,
    baseEffect: 1,
    gainMultiplier: 1.1,
    installTimeMinutes: 180,
    downtimePolicy: "partial",
    stage: "mid",
    maxLevel: 6,
    isInfinite: false,
    uiFormat: "flat_integer",
    effectLabel: "Additional worker slots",
  },
  tool_durability: {
    key: "tool_durability",
    family: "durability",
    displayName: "Tool Durability",
    shortDescription: "Extends tool lifetime before breakage.",
    immersiveLabel: "Maintenance benches, hardened bits, and spare-part discipline.",
    projectCategory: "systems",
    appliesTo: ["mine", "logging_camp", "oil_well"],
    effectKind: "multiplier",
    baseCost: 1650,
    costMultiplier: 1.35,
    baseEffect: 1.1,
    gainMultiplier: 1.04,
    installTimeMinutes: 60,
    downtimePolicy: "none",
    stage: "mid",
    maxLevel: null,
    isInfinite: true,
    uiFormat: "percent_up",
    effectLabel: "Tool durability multiplier",
  },
  ore_quality: {
    key: "ore_quality",
    family: "quality",
    displayName: "Ore Quality",
    shortDescription: "Improves mined material quality.",
    immersiveLabel: "Sorting deck improvements and deeper seam selection.",
    projectCategory: "equipment",
    appliesTo: ["mine"],
    effectKind: "flat_quality",
    baseCost: 1300,
    costMultiplier: 1.35,
    baseEffect: 4,
    gainMultiplier: 1.1,
    installTimeMinutes: 90,
    downtimePolicy: "partial",
    stage: "mid",
    maxLevel: null,
    isInfinite: true,
    uiFormat: "quality_points",
    effectLabel: "Quality bonus",
  },
  crop_yield: {
    key: "crop_yield",
    family: "extraction",
    displayName: "Crop Yield",
    shortDescription: "Improves farm output per cycle.",
    immersiveLabel: "Irrigation timing, row spacing, and harvest organization.",
    projectCategory: "systems",
    appliesTo: ["farm"],
    effectKind: "multiplier",
    baseCost: 700,
    costMultiplier: 1.32,
    baseEffect: 1.08,
    gainMultiplier: 1.05,
    installTimeMinutes: 30,
    downtimePolicy: "none",
    stage: "early",
    maxLevel: null,
    isInfinite: true,
    uiFormat: "percent_up",
    effectLabel: "Output multiplier",
  },
  water_efficiency: {
    key: "water_efficiency",
    family: "durability",
    displayName: "Water Efficiency",
    shortDescription: "Reduces water consumed by the farm.",
    immersiveLabel: "Retention trenches, pump controls, and irrigation discipline.",
    projectCategory: "systems",
    appliesTo: ["farm"],
    effectKind: "reduction_multiplier",
    baseCost: 900,
    costMultiplier: 1.35,
    baseEffect: 0.92,
    gainMultiplier: 1.08,
    installTimeMinutes: 45,
    downtimePolicy: "partial",
    stage: "early",
    maxLevel: null,
    isInfinite: true,
    uiFormat: "percent_down",
    effectLabel: "Water use multiplier",
  },
  production_efficiency: {
    key: "production_efficiency",
    family: "manufacturing",
    displayName: "Production Efficiency",
    shortDescription: "Increases manufacturing output quantity.",
    immersiveLabel: "Feed pacing, floor flow, and cycle timing improvements.",
    projectCategory: "equipment",
    appliesTo: [
      "sawmill",
      "metalworking_factory",
      "food_processing_plant",
      "winery_distillery",
      "carpentry_workshop",
    ],
    effectKind: "multiplier",
    baseCost: 1000,
    costMultiplier: 1.35,
    baseEffect: 1.08,
    gainMultiplier: 1.05,
    installTimeMinutes: 60,
    downtimePolicy: "partial",
    stage: "early",
    maxLevel: null,
    isInfinite: true,
    uiFormat: "percent_up",
    effectLabel: "Output multiplier",
  },
  equipment_quality: {
    key: "equipment_quality",
    family: "quality",
    displayName: "Equipment Quality",
    shortDescription: "Raises output quality for manufacturing.",
    immersiveLabel: "Alignment, finish consistency, and tighter process tolerances.",
    projectCategory: "equipment",
    appliesTo: [
      "sawmill",
      "metalworking_factory",
      "food_processing_plant",
      "winery_distillery",
      "carpentry_workshop",
    ],
    effectKind: "flat_quality",
    baseCost: 1500,
    costMultiplier: 1.35,
    baseEffect: 4,
    gainMultiplier: 1.1,
    installTimeMinutes: 90,
    downtimePolicy: "partial",
    stage: "mid",
    maxLevel: null,
    isInfinite: true,
    uiFormat: "quality_points",
    effectLabel: "Quality bonus",
  },
  input_reduction: {
    key: "input_reduction",
    family: "manufacturing",
    displayName: "Input Reduction",
    shortDescription: "Reduces material wasted in recipes.",
    immersiveLabel: "Waste capture, tighter cuts, and cleaner batch discipline.",
    projectCategory: "systems",
    appliesTo: [
      "sawmill",
      "metalworking_factory",
      "food_processing_plant",
      "winery_distillery",
      "carpentry_workshop",
    ],
    effectKind: "reduction_multiplier",
    baseCost: 1900,
    costMultiplier: 1.4,
    baseEffect: 0.96,
    gainMultiplier: 1.08,
    installTimeMinutes: 120,
    downtimePolicy: "partial",
    stage: "mid",
    maxLevel: null,
    isInfinite: true,
    uiFormat: "percent_down",
    effectLabel: "Input use multiplier",
  },
  storefront_appeal: {
    key: "storefront_appeal",
    family: "store",
    displayName: "Storefront Appeal",
    shortDescription: "Increases NPC traffic to the store.",
    immersiveLabel: "Window refresh, signage, lighting, and exterior cleanup.",
    projectCategory: "storefront",
    appliesTo: ["general_store", "specialty_store"],
    effectKind: "traffic_multiplier",
    baseCost: 950,
    costMultiplier: 1.35,
    baseEffect: 1.05,
    gainMultiplier: 1.03,
    installTimeMinutes: 45,
    downtimePolicy: "partial",
    stage: "early",
    maxLevel: null,
    isInfinite: true,
    uiFormat: "percent_up",
    effectLabel: "Traffic multiplier",
  },
  listing_capacity: {
    key: "listing_capacity",
    family: "capacity",
    displayName: "Listing Capacity",
    shortDescription: "Adds more shelf and listing capacity.",
    immersiveLabel: "Shelving expansion, stockroom routing, and denser merchandising.",
    projectCategory: "facility",
    appliesTo: ["general_store", "specialty_store"],
    effectKind: "flat_slots",
    baseCost: 1200,
    costMultiplier: 1.35,
    baseEffect: 1,
    gainMultiplier: 1.1,
    installTimeMinutes: 120,
    downtimePolicy: "partial",
    stage: "mid",
    maxLevel: 10,
    isInfinite: false,
    uiFormat: "flat_integer",
    effectLabel: "Additional listings",
  },
  customer_service: {
    key: "customer_service",
    family: "store",
    displayName: "Customer Service",
    shortDescription: "Improves conversion and pricing resilience.",
    immersiveLabel: "Counter layout, checkout speed, and trained floor staff.",
    projectCategory: "staffing",
    appliesTo: ["general_store", "specialty_store"],
    effectKind: "conversion_multiplier",
    baseCost: 1700,
    costMultiplier: 1.35,
    baseEffect: 1.03,
    gainMultiplier: 1.02,
    installTimeMinutes: 30,
    downtimePolicy: "none",
    stage: "mid",
    maxLevel: null,
    isInfinite: true,
    uiFormat: "percent_up",
    effectLabel: "Conversion multiplier",
  },
};

export function getBusinessUpgradeDefinition(
  key: BusinessUpgradeKey
): BusinessUpgradeDefinition | null {
  return BUSINESS_UPGRADE_DEFINITIONS[key] ?? null;
}

export function getBusinessUpgradeDefinitions(): BusinessUpgradeDefinition[] {
  return BUSINESS_UPGRADE_KEYS.map((key) => BUSINESS_UPGRADE_DEFINITIONS[key]);
}

export function getBusinessUpgradeDefinitionsForBusinessType(
  businessType: BusinessType
): BusinessUpgradeDefinition[] {
  return getBusinessUpgradeDefinitions().filter((definition) =>
    definition.appliesTo.includes(businessType)
  );
}

export function getBusinessUpgradeKeysForBusinessType(
  businessType: BusinessType
): BusinessUpgradeKey[] {
  return getBusinessUpgradeDefinitionsForBusinessType(businessType).map((definition) => definition.key);
}
