export const MARKET_TRANSACTION_FEE = 0.03;
export const NPC_SUBTICK_SECONDS = 30;
export const NPC_SUBTICKS_PER_TICK = 20;
export const NPC_SHOPPERS_PER_SUBTICK_BASE = 18;
export const NPC_SUBTICK_VARIANCE = 0.3;
export const NPC_PRICE_BAND_PERCENT = 0.05;

export const STOREFRONT_TRAFFIC_MULTIPLIER_MIN = 0.5;
export const STOREFRONT_TRAFFIC_MULTIPLIER_MAX = 3;
export const STOREFRONT_AD_BUDGET_FOR_MAX_EFFECT = 200;
export const STOREFRONT_AD_MAX_TRAFFIC_BOOST = 1;

export const NPC_DEMAND_CURVE = [
  { startHour: 0, endHour: 5, multiplier: 0.3 },
  { startHour: 6, endHour: 8, multiplier: 0.6 },
  { startHour: 9, endHour: 11, multiplier: 1.0 },
  { startHour: 12, endHour: 13, multiplier: 1.3 },
  { startHour: 14, endHour: 16, multiplier: 0.85 },
  { startHour: 17, endHour: 20, multiplier: 1.15 },
  { startHour: 21, endHour: 23, multiplier: 0.5 },
] as const;

export const NPC_SHOPPER_TIERS = [
  {
    key: "small",
    spawnWeight: 0.65,
    budgetMin: 5,
    budgetMax: 40,
    maxItemsMin: 1,
    maxItemsMax: 5,
  },
  {
    key: "medium",
    spawnWeight: 0.28,
    budgetMin: 40,
    budgetMax: 100,
    maxItemsMin: 5,
    maxItemsMax: 15,
  },
  {
    key: "large",
    spawnWeight: 0.07,
    budgetMin: 100,
    budgetMax: 200,
    maxItemsMin: 15,
    maxItemsMax: 25,
  },
] as const;

export const NPC_PRICE_SENSITIVITY_MIN = 0.7;
export const NPC_PRICE_SENSITIVITY_MAX = 1.0;
export const NPC_QUALITY_PREFERENCE_MIN = 0.0;
export const NPC_QUALITY_PREFERENCE_MAX = 1.0;
export const NPC_PRICE_RESPONSE_CURVE = [
  { ratio: 0.1, multiplier: 1.9 },
  { ratio: 0.5, multiplier: 1.45 },
  { ratio: 1.0, multiplier: 1.0 },
  { ratio: 1.4, multiplier: 0.45 },
  { ratio: 1.7, multiplier: 0.16 },
  { ratio: 1.9, multiplier: 0.04 },
  { ratio: 2.0, multiplier: 0.0 },
] as const;

export const NPC_CATEGORY_INTEREST_WEIGHTS = [
  { itemKey: "water", weight: 1.4 },
  { itemKey: "iron_ore", weight: 1.3 },
  { itemKey: "flour", weight: 1.3 },
  { itemKey: "chips", weight: 1.2 },
  { itemKey: "wheat", weight: 1.1 },
  { itemKey: "wood_plank", weight: 1.1 },
  { itemKey: "iron_bar", weight: 1.1 },
  { itemKey: "red_wine", weight: 1.0 },
  { itemKey: "chair", weight: 0.9 },
  { itemKey: "pickaxe", weight: 0.8 },
  { itemKey: "axe", weight: 0.8 },
  { itemKey: "drill_bit", weight: 0.7 },
] as const;

export const NPC_PRICE_CEILINGS = {
  iron_ore: 10.0,
  coal: 15.0,
  copper_ore: 20.0,
  gravel: 6.0,
  crude_oil: 10.6,
  raw_wood: 6.8,
  water: 2.5,
  wheat: 6.0,
  potato: 4.2,
  corn: 4.0,
  red_grape: 4.5,
  seeds: 1.8,
  wood_plank: 5.2,
  wood_handle: 10.5,
  iron_bar: 20.0,
  steel_bar: 40.0,
  steel_beam: 50.0,
  pickaxe: 28.0,
  axe: 24.0,
  drill_bit: 45.0,
  chair: 45.0,
  table: 120.0,
  flour: 8.8,
  chips: 0.7,
  red_wine: 8.0,
  whiskey: 10.0,
  corn_whiskey: 9.0,
} as const;

export function getDemandCurveMultiplierForHour(hour: number): number {
  const match = NPC_DEMAND_CURVE.find((window) => hour >= window.startHour && hour <= window.endHour);
  return match?.multiplier ?? 1;
}
