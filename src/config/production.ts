import type { BusinessType, BusinessUpgradeKey } from "@/config/businesses";
import type { EmployeeSkillKey } from "@/config/employees";
import {
  EXTRACTION_BUSINESS_TYPES as SHARED_EXTRACTION_BUSINESS_TYPES,
  EXTRACTION_OUTPUT_ITEM_BY_BUSINESS as SHARED_EXTRACTION_OUTPUT_ITEM_BY_BUSINESS,
  EXTRACTION_MISSING_TOOL_OUTPUT_MULTIPLIER_BY_BUSINESS as SHARED_EXTRACTION_MISSING_TOOL_OUTPUT_MULTIPLIER_BY_BUSINESS,
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
import {
  MANUFACTURING_BUSINESS_TYPES as SHARED_MANUFACTURING_BUSINESS_TYPES,
  MANUFACTURING_RECIPE_KEYS as SHARED_MANUFACTURING_RECIPE_KEYS,
  MANUFACTURING_RECIPES as SHARED_MANUFACTURING_RECIPES,
  MANUFACTURING_STATUSES as SHARED_MANUFACTURING_STATUSES,
  getManufacturingInputQuantityPerTick,
  getManufacturingOutputQuantityPerTick,
  getManufacturingRecipeByKey as getSharedManufacturingRecipeByKey,
  getManufacturingRecipesForBusinessType as getSharedManufacturingRecipesForBusinessType,
  type SharedManufacturingBusinessType,
  type SharedManufacturingRecipe,
} from "../../shared/production/manufacturing";

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

export const EXTRACTION_MISSING_TOOL_OUTPUT_MULTIPLIER_BY_BUSINESS: Partial<Record<ExtractionBusinessType, number>> =
  SHARED_EXTRACTION_MISSING_TOOL_OUTPUT_MULTIPLIER_BY_BUSINESS;

export type ToolItemType = (typeof TOOL_ITEM_TYPES)[number];

export const EXTRACTION_REQUIRED_TOOL_BY_BUSINESS: Partial<Record<ExtractionBusinessType, ToolItemType>> =
  SHARED_EXTRACTION_REQUIRED_TOOL_BY_BUSINESS;

export const EXTRACTION_UPGRADE_KEY_BY_BUSINESS: Record<ExtractionBusinessType, BusinessUpgradeKey> =
  SHARED_EXTRACTION_UPGRADE_KEY_BY_BUSINESS;

export const EXTRACTION_SKILL_KEY_BY_BUSINESS: Record<ExtractionBusinessType, EmployeeSkillKey> =
  SHARED_EXTRACTION_SKILL_KEY_BY_BUSINESS;

export const TOOL_BASE_DURABILITY: Record<ToolItemType, number> = SHARED_TOOL_BASE_DURABILITY;

export const PRODUCTION_RETOOL_DURATION_MINUTES = 10;

export type ExtractionProductOption = {
  itemKey: string;
  displayName: string;
};

export const EXTRACTION_PRODUCT_OPTIONS_BY_BUSINESS: Record<ExtractionBusinessType, readonly ExtractionProductOption[]> = {
  mine: [
    { itemKey: "iron_ore", displayName: "Iron Ore" },
    { itemKey: "copper_ore", displayName: "Copper Ore" },
    { itemKey: "coal", displayName: "Coal" },
  ],
  farm: [
    { itemKey: "wheat", displayName: "Wheat" },
    { itemKey: "potato", displayName: "Potatoes" },
    { itemKey: "red_grape", displayName: "Red Grapes" },
  ],
  water_company: [{ itemKey: "water", displayName: "Water" }],
  logging_camp: [{ itemKey: "raw_wood", displayName: "Raw Wood" }],
  oil_well: [{ itemKey: "crude_oil", displayName: "Crude Oil" }],
};

export const EXTRACTION_LINE_LABEL_BY_BUSINESS: Record<ExtractionBusinessType, string> = {
  mine: "Shaft",
  farm: "Field",
  water_company: "Slot",
  logging_camp: "Camp",
  oil_well: "Well",
};

export const EXTRACTION_RETOOL_COST_BY_BUSINESS: Record<ExtractionBusinessType, number> = {
  mine: 450,
  farm: 180,
  water_company: 0,
  logging_camp: 0,
  oil_well: 0,
};

export const MANUFACTURING_STATUSES = SHARED_MANUFACTURING_STATUSES;
export type ManufacturingStatus = (typeof MANUFACTURING_STATUSES)[number];

export const MANUFACTURING_BUSINESS_TYPES = SHARED_MANUFACTURING_BUSINESS_TYPES;

export type ManufacturingBusinessType = (typeof MANUFACTURING_BUSINESS_TYPES)[number];

export type ManufacturingRecipe = Omit<SharedManufacturingRecipe, "businessType" | "skillKey"> & {
  businessType: ManufacturingBusinessType;
  skillKey: EmployeeSkillKey;
};

export const MANUFACTURING_RETOOL_COST_BY_BUSINESS: Record<ManufacturingBusinessType, number> = {
  sawmill: 300,
  metalworking_factory: 650,
  food_processing_plant: 400,
  winery_distillery: 550,
  carpentry_workshop: 500,
};

export const MANUFACTURING_RECIPES: readonly ManufacturingRecipe[] =
  SHARED_MANUFACTURING_RECIPES as readonly ManufacturingRecipe[];

export const MANUFACTURING_RECIPE_KEYS = SHARED_MANUFACTURING_RECIPE_KEYS;

export function getManufacturingRecipeByKey(recipeKey: string): ManufacturingRecipe | null {
  return getSharedManufacturingRecipeByKey(recipeKey) as ManufacturingRecipe | null;
}

export function getManufacturingRecipesForBusinessType(
  businessType: BusinessType
): ManufacturingRecipe[] {
  return getSharedManufacturingRecipesForBusinessType(
    businessType as SharedManufacturingBusinessType
  ) as ManufacturingRecipe[];
}

export function getExtractionProductOptionsForBusinessType(
  businessType: BusinessType
): ExtractionProductOption[] {
  if (!isExtractionBusinessType(businessType)) return [];
  return [...EXTRACTION_PRODUCT_OPTIONS_BY_BUSINESS[businessType]];
}

export function getExtractionProductOption(
  businessType: BusinessType,
  itemKey: string
): ExtractionProductOption | null {
  return getExtractionProductOptionsForBusinessType(businessType).find((option) => option.itemKey === itemKey) ?? null;
}

export function isManufacturingBusinessType(type: BusinessType): type is ManufacturingBusinessType {
  return MANUFACTURING_BUSINESS_TYPES.includes(type as ManufacturingBusinessType);
}

export function isExtractionBusinessType(type: BusinessType): type is ExtractionBusinessType {
  return EXTRACTION_BUSINESS_TYPES.includes(type as ExtractionBusinessType);
}
