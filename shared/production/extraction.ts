export const TOOL_ITEM_TYPES = ["pickaxe", "axe", "drill_bit"] as const;

export type SharedToolItemType = (typeof TOOL_ITEM_TYPES)[number];

export const TOOL_BASE_DURABILITY = {
  pickaxe: 60,
  axe: 60,
  drill_bit: 60,
} as const satisfies Record<SharedToolItemType, number>;

export const EXTRACTION_SLOT_STATUSES = ["active", "idle", "resting", "tool_broken", "retooling"] as const;

export type SharedExtractionSlotStatus = (typeof EXTRACTION_SLOT_STATUSES)[number];

export const EXTRACTION_BUSINESS_TYPES = [
  "mine",
  "farm",
  "water_company",
  "logging_camp",
  "oil_well",
] as const;

export type SharedExtractionBusinessType = (typeof EXTRACTION_BUSINESS_TYPES)[number];

export const EXTRACTION_OUTPUT_ITEM_BY_BUSINESS = {
  mine: "iron_ore",
  farm: "wheat",
  water_company: "water",
  logging_camp: "raw_wood",
  oil_well: "crude_oil",
} as const satisfies Record<SharedExtractionBusinessType, string>;

export const EXTRACTION_REQUIRED_TOOL_BY_BUSINESS = {
  mine: "pickaxe",
  logging_camp: "axe",
  oil_well: "drill_bit",
} as const satisfies Partial<Record<SharedExtractionBusinessType, SharedToolItemType>>;

export const EXTRACTION_MISSING_TOOL_OUTPUT_MULTIPLIER_BY_BUSINESS = {
  mine: 1,
} as const satisfies Partial<Record<SharedExtractionBusinessType, number>>;

export const EXTRACTION_TOOL_OUTPUT_BONUS_BY_BUSINESS = {
  mine: 2,
} as const satisfies Partial<Record<SharedExtractionBusinessType, number>>;

export const EXTRACTION_UPGRADE_KEY_BY_BUSINESS = {
  mine: "extraction_efficiency",
  farm: "crop_yield",
  water_company: "extraction_efficiency",
  logging_camp: "extraction_efficiency",
  oil_well: "extraction_efficiency",
} as const satisfies Record<SharedExtractionBusinessType, string>;

export const EXTRACTION_SKILL_KEY_BY_BUSINESS = {
  mine: "mining",
  farm: "farming",
  water_company: "logistics",
  logging_camp: "logging",
  oil_well: "logistics",
} as const satisfies Record<SharedExtractionBusinessType, string>;

export const EXTRACTION_XP_PER_TICK = 5;
export const EXTRACTION_XP_PER_LEVEL = 100;

export const FARM_WATER_ITEM_KEY = "water";
export const FARM_WATER_PER_TICK = 1;
