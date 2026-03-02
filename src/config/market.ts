export const MARKET_TRANSACTION_FEE = 0.03;
export const NPC_SUBTICK_SECONDS = 30;
export const NPC_SUBTICKS_PER_TICK = 20;

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

export const NPC_CATEGORY_INTEREST_WEIGHTS: ReadonlyArray<{ itemKey: string; weight: number }> = [
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
];

export const NPC_SHOPPERS_PER_SUBTICK_BASE = 18;
export const NPC_SUBTICK_VARIANCE = 0.3;

export function getDemandCurveMultiplierForHour(hour: number): number {
  const match = NPC_DEMAND_CURVE.find((window) => hour >= window.startHour && hour <= window.endHour);
  return match?.multiplier ?? 1;
}
