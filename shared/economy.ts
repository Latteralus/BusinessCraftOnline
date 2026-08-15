export const MARKET_TRANSACTION_FEE = 0.03;
export const NPC_STOREFRONT_FEE = 0.05;
// Must match the pg_cron schedule that invokes tick-npc-purchases
// (currently `* * * * *`, i.e. every 60s — pg_cron's minimum granularity).
// A mismatch here silently truncates the subtick window (see changelog).
export const NPC_SUBTICK_SECONDS = 60;
export const NPC_SUBTICKS_PER_TICK = 20;
export const NPC_SHOPPERS_PER_SUBTICK_BASE = 8;
export const NPC_SUBTICK_VARIANCE = 0.3;
export const NPC_PRICE_BAND_PERCENT = 0.05;

export const STOREFRONT_TRAFFIC_MULTIPLIER_MIN = 0.5;
export const STOREFRONT_TRAFFIC_MULTIPLIER_MAX = 3;
export const STOREFRONT_AD_BUDGET_FOR_MAX_EFFECT = 200;
export const STOREFRONT_AD_MAX_TRAFFIC_BOOST = 1;

export const NPC_DEMAND_CURVE = [
  { startHour: 0, endHour: 5, multiplier: 0.6 },
  { startHour: 6, endHour: 8, multiplier: 0.8 },
  { startHour: 9, endHour: 11, multiplier: 2.0 },
  { startHour: 12, endHour: 13, multiplier: 2.3 },
  { startHour: 14, endHour: 16, multiplier: 1.85 },
  { startHour: 17, endHour: 20, multiplier: 1.25 },
  { startHour: 21, endHour: 23, multiplier: 0.5 },
] as const;

export const NPC_SHOPPER_TIERS = [
  {
    key: "small",
    spawnWeight: 0.55,
    budgetMin: 5,
    budgetMax: 40,
    maxItemsMin: 2,
    maxItemsMax: 6,
  },
  {
    key: "medium",
    spawnWeight: 0.35,
    budgetMin: 40,
    budgetMax: 100,
    maxItemsMin: 4,
    maxItemsMax: 12,
  },
  {
    key: "large",
    spawnWeight: 0.10,
    budgetMin: 100,
    budgetMax: 200,
    maxItemsMin: 8,
    maxItemsMax: 20,
  },
] as const;

export const NPC_BASKET_SIZE_DISTRIBUTION = [
  { min: 1, max: 1, weight: 0.10 },
  { min: 2, max: 3, weight: 0.30 },
  { min: 4, max: 6, weight: 0.35 },
  { min: 7, max: 10, weight: 0.18 },
  { min: 11, max: 20, weight: 0.07 },
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
  { ratio: 1.9, multiplier: 0.10 },
  { ratio: 2.0, multiplier: 0.05 },
] as const;

export const NPC_CATEGORY_INTEREST_WEIGHTS = [
  { itemKey: "water", weight: 1.4 },
  { itemKey: "iron_ore", weight: 1.3 },
  { itemKey: "flour", weight: 1.3 },
  { itemKey: "chips", weight: 1.0 },
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
  coal: 10.0,
  copper_ore: 10.0,
  gravel: 10.0,
  crude_oil: 35.0,
  raw_wood: 10.0,
  water: 5.0,
  wheat: 12.5,
  potato: 12.5,
  corn: 12.5,
  red_grape: 15.0,
  seeds: 2.5,
  wood_plank: 30.0,
  wood_handle: 20.0,
  iron_bar: 48.0,
  steel_bar: 140.0,
  steel_beam: 80.0,
  pickaxe: 90.0,
  axe: 90.0,
  drill_bit: 225.0,
  chair: 120.0,
  table: 160.0,
  flour: 36.0,
  chips: 8.0,
  red_wine: 75.0,
  whiskey: 55.0,
  corn_whiskey: 48.0,
} as const;

export const NPC_BUYER_MIN_PRICE = 0.01;

export type NpcBuyerPriceRange = {
  min: number;
  max: number;
};

export const NPC_BUYER_PRICE_RANGES: Record<string, NpcBuyerPriceRange> = Object.fromEntries(
  Object.entries(NPC_PRICE_CEILINGS).map(([itemKey, max]) => [itemKey, { min: NPC_BUYER_MIN_PRICE, max }])
);

export function getNpcBuyerPriceRange(itemKey: string): NpcBuyerPriceRange {
  return NPC_BUYER_PRICE_RANGES[itemKey] ?? {
    min: NPC_BUYER_MIN_PRICE,
    max: 1,
  };
}

export function getNpcSuggestedBasePrice(itemKey: string): number {
  const range = getNpcBuyerPriceRange(itemKey);
  return Number((((range.min + range.max) / 2) * 100).toFixed(0)) / 100;
}

export function getDemandCurveMultiplierForHour(hour: number): number {
  const match = NPC_DEMAND_CURVE.find((window) => hour >= window.startHour && hour <= window.endHour);
  return match?.multiplier ?? 1;
}
