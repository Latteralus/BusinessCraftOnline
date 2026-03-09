import type { BusinessType, BusinessUpgradeKey } from "@/config/businesses";
import type { EmployeeSkillKey } from "@/config/employees";
import {
  EXTRACTION_BUSINESS_TYPES as SHARED_EXTRACTION_BUSINESS_TYPES,
  EXTRACTION_OUTPUT_ITEM_BY_BUSINESS as SHARED_EXTRACTION_OUTPUT_ITEM_BY_BUSINESS,
  EXTRACTION_REQUIRED_TOOL_BY_BUSINESS as SHARED_EXTRACTION_REQUIRED_TOOL_BY_BUSINESS,
  EXTRACTION_SKILL_KEY_BY_BUSINESS as SHARED_EXTRACTION_SKILL_KEY_BY_BUSINESS,
  EXTRACTION_SLOT_STATUSES as SHARED_EXTRACTION_SLOT_STATUSES,
  EXTRACTION_UPGRADE_KEY_BY_BUSINESS as SHARED_EXTRACTION_UPGRADE_KEY_BY_BUSINESS,
  EXTRACTION_XP_PER_LEVEL,
  EXTRACTION_XP_PER_TICK,
  FARM_WATER_ITEM_KEY,
  FARM_WATER_PER_TICK,
  TOOL_BASE_DURABILITY as SHARED_TOOL_BASE_DURABILITY,
  TOOL_ITEM_TYPES as SHARED_TOOL_ITEM_TYPES,
} from "../../shared/production/extraction";

export {
  EXTRACTION_XP_PER_LEVEL,
  EXTRACTION_XP_PER_TICK,
  FARM_WATER_ITEM_KEY,
  FARM_WATER_PER_TICK,
};

export const EXTRACTION_SLOT_STATUSES = SHARED_EXTRACTION_SLOT_STATUSES;
export const EXTRACTION_BUSINESS_TYPES = SHARED_EXTRACTION_BUSINESS_TYPES;
export const TOOL_ITEM_TYPES = SHARED_TOOL_ITEM_TYPES;

export type ExtractionSlotStatus = (typeof EXTRACTION_SLOT_STATUSES)[number];

export type ExtractionBusinessType = (typeof EXTRACTION_BUSINESS_TYPES)[number];

export const EXTRACTION_OUTPUT_ITEM_BY_BUSINESS: Record<ExtractionBusinessType, string> =
  SHARED_EXTRACTION_OUTPUT_ITEM_BY_BUSINESS;

export type ToolItemType = (typeof TOOL_ITEM_TYPES)[number];

export const EXTRACTION_REQUIRED_TOOL_BY_BUSINESS: Partial<Record<ExtractionBusinessType, ToolItemType>> =
  SHARED_EXTRACTION_REQUIRED_TOOL_BY_BUSINESS;

export const EXTRACTION_UPGRADE_KEY_BY_BUSINESS: Record<ExtractionBusinessType, BusinessUpgradeKey> =
  SHARED_EXTRACTION_UPGRADE_KEY_BY_BUSINESS;

export const EXTRACTION_SKILL_KEY_BY_BUSINESS: Record<ExtractionBusinessType, EmployeeSkillKey> =
  SHARED_EXTRACTION_SKILL_KEY_BY_BUSINESS;

export const TOOL_BASE_DURABILITY: Record<ToolItemType, number> = SHARED_TOOL_BASE_DURABILITY;

export const MANUFACTURING_STATUSES = ["active", "idle"] as const;
export type ManufacturingStatus = (typeof MANUFACTURING_STATUSES)[number];

export const MANUFACTURING_BUSINESS_TYPES = [
  "sawmill",
  "metalworking_factory",
  "food_processing_plant",
  "winery_distillery",
  "carpentry_workshop",
] as const;

export type ManufacturingBusinessType = (typeof MANUFACTURING_BUSINESS_TYPES)[number];

export type ManufacturingRecipe = {
  key: string;
  businessType: ManufacturingBusinessType;
  displayName: string;
  skillKey: EmployeeSkillKey;
  inputs: Array<{ itemKey: string; quantity: number }>;
  outputItemKey: string;
  baseOutputQuantity: number;
};

export const MANUFACTURING_RECIPES: readonly ManufacturingRecipe[] = [
  {
    key: "sawmill_planks",
    businessType: "sawmill",
    displayName: "Wood Planks",
    skillKey: "carpentry",
    inputs: [{ itemKey: "raw_wood", quantity: 2 }],
    outputItemKey: "wood_plank",
    baseOutputQuantity: 1,
  },
  {
    key: "metal_iron_bars",
    businessType: "metalworking_factory",
    displayName: "Iron Bars",
    skillKey: "metalworking",
    inputs: [
      { itemKey: "iron_ore", quantity: 2 },
      { itemKey: "coal", quantity: 1 },
    ],
    outputItemKey: "iron_bar",
    baseOutputQuantity: 1,
  },
  {
    key: "food_flour",
    businessType: "food_processing_plant",
    displayName: "Flour",
    skillKey: "food_production",
    inputs: [{ itemKey: "wheat", quantity: 2 }],
    outputItemKey: "flour",
    baseOutputQuantity: 1,
  },
  {
    key: "winery_red_wine",
    businessType: "winery_distillery",
    displayName: "Red Wine",
    skillKey: "brewing",
    inputs: [{ itemKey: "red_grape", quantity: 3 }],
    outputItemKey: "red_wine",
    baseOutputQuantity: 1,
  },
  {
    key: "carpentry_chair",
    businessType: "carpentry_workshop",
    displayName: "Chair",
    skillKey: "carpentry",
    inputs: [
      { itemKey: "wood_plank", quantity: 2 },
      { itemKey: "wood_handle", quantity: 1 },
    ],
    outputItemKey: "chair",
    baseOutputQuantity: 1,
  },
];

export const MANUFACTURING_RECIPE_KEYS = MANUFACTURING_RECIPES.map((recipe) => recipe.key) as [
  string,
  ...string[]
];

export function getManufacturingRecipeByKey(recipeKey: string): ManufacturingRecipe | null {
  return MANUFACTURING_RECIPES.find((recipe) => recipe.key === recipeKey) ?? null;
}

export function getManufacturingRecipesForBusinessType(
  businessType: BusinessType
): ManufacturingRecipe[] {
  return MANUFACTURING_RECIPES.filter((recipe) => recipe.businessType === businessType);
}

export function isManufacturingBusinessType(type: BusinessType): type is ManufacturingBusinessType {
  return MANUFACTURING_BUSINESS_TYPES.includes(type as ManufacturingBusinessType);
}

export function isExtractionBusinessType(type: BusinessType): type is ExtractionBusinessType {
  return EXTRACTION_BUSINESS_TYPES.includes(type as ExtractionBusinessType);
}
