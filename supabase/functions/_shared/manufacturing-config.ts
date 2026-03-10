export const MANUFACTURING_TICK_MINUTES = 1;

export type ManufacturingRecipe = {
  key: string;
  businessType: string;
  displayName: string;
  skillKey: string;
  inputs: Array<{ itemKey: string; quantity: number }>;
  outputItemKey: string;
  baseOutputQuantity: number;
};

const MANUFACTURING_RECIPES: readonly ManufacturingRecipe[] = [
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
    key: "sawmill_wood_handles",
    businessType: "sawmill",
    displayName: "Wood Handles",
    skillKey: "carpentry",
    inputs: [{ itemKey: "raw_wood", quantity: 1 }],
    outputItemKey: "wood_handle",
    baseOutputQuantity: 1,
  },
  {
    key: "carpentry_wood_handles",
    businessType: "carpentry_workshop",
    displayName: "Wood Handles",
    skillKey: "carpentry",
    inputs: [{ itemKey: "raw_wood", quantity: 1 }],
    outputItemKey: "wood_handle",
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
    key: "metal_steel_bars",
    businessType: "metalworking_factory",
    displayName: "Steel Bars",
    skillKey: "metalworking",
    inputs: [
      { itemKey: "iron_bar", quantity: 2 },
      { itemKey: "coal", quantity: 1 },
    ],
    outputItemKey: "steel_bar",
    baseOutputQuantity: 1,
  },
  {
    key: "metal_pickaxes",
    businessType: "metalworking_factory",
    displayName: "Pickaxes",
    skillKey: "metalworking",
    inputs: [
      { itemKey: "iron_bar", quantity: 1 },
      { itemKey: "wood_handle", quantity: 1 },
    ],
    outputItemKey: "pickaxe",
    baseOutputQuantity: 1,
  },
  {
    key: "metal_axes",
    businessType: "metalworking_factory",
    displayName: "Axes",
    skillKey: "metalworking",
    inputs: [
      { itemKey: "iron_bar", quantity: 1 },
      { itemKey: "wood_handle", quantity: 1 },
    ],
    outputItemKey: "axe",
    baseOutputQuantity: 1,
  },
  {
    key: "metal_drill_bits",
    businessType: "metalworking_factory",
    displayName: "Drill Bits",
    skillKey: "metalworking",
    inputs: [
      { itemKey: "steel_bar", quantity: 1 },
      { itemKey: "iron_bar", quantity: 1 },
    ],
    outputItemKey: "drill_bit",
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
    key: "food_chips",
    businessType: "food_processing_plant",
    displayName: "Chips",
    skillKey: "food_production",
    inputs: [{ itemKey: "potato", quantity: 2 }],
    outputItemKey: "chips",
    baseOutputQuantity: 5,
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

export function getManufacturingRecipeByKey(recipeKey: string): ManufacturingRecipe | null {
  return MANUFACTURING_RECIPES.find((recipe) => recipe.key === recipeKey) ?? null;
}

export function getManufacturingInputQuantityPerTick(quantityPerMinute: number): number {
  return quantityPerMinute * MANUFACTURING_TICK_MINUTES;
}

export function getManufacturingOutputQuantityPerTick(quantityPerMinute: number): number {
  return quantityPerMinute * MANUFACTURING_TICK_MINUTES;
}
