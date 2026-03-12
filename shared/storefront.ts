import {
  NPC_CATEGORY_INTEREST_WEIGHTS,
  NPC_PRICE_RESPONSE_CURVE,
  NPC_PRICE_SENSITIVITY_MAX,
  NPC_PRICE_SENSITIVITY_MIN,
  NPC_QUALITY_PREFERENCE_MAX,
  NPC_QUALITY_PREFERENCE_MIN,
  STOREFRONT_TRAFFIC_MULTIPLIER_MAX,
  STOREFRONT_TRAFFIC_MULTIPLIER_MIN,
  getNpcBuyerPriceRange,
} from "./economy.ts";

export const STOREFRONT_DEFAULT_AD_BUDGET_PER_TICK = 0;
export const STOREFRONT_DEFAULT_TRAFFIC_MULTIPLIER = 1;
export const STOREFRONT_DEFAULT_AD_ENABLED = true;
export const STOREFRONT_CONTINUE_SHOPPING_CHANCE = 0.45;
export const STOREFRONT_DEFAULT_ITEM_INTEREST_WEIGHT = 0.5;

export const STOREFRONT_DEFAULT_SETTINGS = {
  ad_budget_per_tick: STOREFRONT_DEFAULT_AD_BUDGET_PER_TICK,
  traffic_multiplier: STOREFRONT_DEFAULT_TRAFFIC_MULTIPLIER,
  is_ad_enabled: STOREFRONT_DEFAULT_AD_ENABLED,
} as const;

export type SharedStorefrontSettings = typeof STOREFRONT_DEFAULT_SETTINGS;

export const STOREFRONT_ITEM_INTEREST_WEIGHT_BY_ITEM = Object.fromEntries(
  NPC_CATEGORY_INTEREST_WEIGHTS.map((entry: (typeof NPC_CATEGORY_INTEREST_WEIGHTS)[number]) => [
    entry.itemKey,
    entry.weight,
  ])
) as Record<string, number>;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

export function getStorefrontTrafficMultiplierBounds() {
  return {
    min: STOREFRONT_TRAFFIC_MULTIPLIER_MIN,
    max: STOREFRONT_TRAFFIC_MULTIPLIER_MAX,
  };
}

export function clampStorefrontTrafficMultiplier(value: number): number {
  return clamp(
    value,
    STOREFRONT_TRAFFIC_MULTIPLIER_MIN,
    STOREFRONT_TRAFFIC_MULTIPLIER_MAX
  );
}

export function getStorefrontPriceCurveMultiplier(priceRatio: number): number {
  if (!Number.isFinite(priceRatio)) return 0;

  const first = NPC_PRICE_RESPONSE_CURVE[0];
  if (priceRatio <= first.ratio) return first.multiplier;

  for (let index = 1; index < NPC_PRICE_RESPONSE_CURVE.length; index += 1) {
    const previous = NPC_PRICE_RESPONSE_CURVE[index - 1];
    const current = NPC_PRICE_RESPONSE_CURVE[index];
    if (priceRatio <= current.ratio) {
      const span = current.ratio - previous.ratio;
      const t = span <= 0 ? 0 : (priceRatio - previous.ratio) / span;
      return lerp(previous.multiplier, current.multiplier, clamp(t, 0, 1));
    }
  }

  return NPC_PRICE_RESPONSE_CURVE[NPC_PRICE_RESPONSE_CURVE.length - 1]?.multiplier ?? 0;
}

export function getStorefrontShelfPurchaseScore(
  input: {
    itemKey: string;
    unitPrice: number;
    quality: number;
    bestAvailableQuality?: number;
    shopperPriceSensitivity: number;
    shopperQualityPreference: number;
    priceToleranceMultiplier: number;
  }
): number {
  const baseWorth = Math.max(0.01, getNpcBuyerPriceRange(input.itemKey).max);
  const rawPrice = Math.max(0.01, input.unitPrice);
  const baseRatio = rawPrice / baseWorth;
  if (baseRatio >= 2) return 0;

  const sensitivityRange = Math.max(0.0001, NPC_PRICE_SENSITIVITY_MAX - NPC_PRICE_SENSITIVITY_MIN);
  const qualityRange = Math.max(0.0001, NPC_QUALITY_PREFERENCE_MAX - NPC_QUALITY_PREFERENCE_MIN);
  const priceTolerance = clamp(input.priceToleranceMultiplier, 1, 1.5);
  const normalizedSensitivity = clamp(
    (input.shopperPriceSensitivity - NPC_PRICE_SENSITIVITY_MIN) / sensitivityRange,
    0,
    1
  );
  const normalizedQualityPreference = clamp(
    (input.shopperQualityPreference - NPC_QUALITY_PREFERENCE_MIN) / qualityRange,
    0,
    1
  );
  const perceivedRatio = baseRatio / lerp(0.92, priceTolerance, normalizedSensitivity);
  const priceScore = getStorefrontPriceCurveMultiplier(perceivedRatio);
  if (priceScore <= 0) return 0;

  const normalizedQuality = clamp(input.quality / 100, 0, 1);
  const normalizedBestAvailableQuality = clamp(
    (input.bestAvailableQuality ?? input.quality) / 100,
    0,
    1
  );
  const relativeQuality = normalizedBestAvailableQuality <= 0
    ? 1
    : clamp(normalizedQuality / normalizedBestAvailableQuality, 0, 1);
  const qualityScore = lerp(
    0.75 + normalizedQuality * 0.35,
    0.45 + normalizedQuality * 1.35,
    normalizedQualityPreference
  );
  const relativeQualityScore = lerp(
    1,
    0.45 + relativeQuality * 1.1,
    normalizedQualityPreference
  );

  return priceScore * qualityScore * relativeQualityScore;
}

export function getStorefrontMaxUnitsPerPurchaseAttempt(listingCapacityBonus: number): number {
  return Math.max(1, Math.min(6, 1 + Math.floor(Number(listingCapacityBonus) / 2)));
}
