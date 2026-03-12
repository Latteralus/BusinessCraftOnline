export type BusinessUpgradeEffectDefaults = {
  workerCapacitySlots: number;
  extractionOutputMultiplier: number;
  extractionQualityBonus: number;
  farmWaterUseMultiplier: number;
  toolDurabilityMultiplier: number;
  manufacturingOutputMultiplier: number;
  manufacturingInputUseMultiplier: number;
  manufacturingQualityBonus: number;
  storefrontTrafficMultiplier: number;
  storefrontListingCapacityBonus: number;
  storefrontConversionMultiplier: number;
  storefrontPriceToleranceMultiplier: number;
  downtimeMultiplier: number;
};

export const BUSINESS_UPGRADE_EFFECT_DEFAULTS: BusinessUpgradeEffectDefaults = {
  workerCapacitySlots: 0,
  extractionOutputMultiplier: 1,
  extractionQualityBonus: 0,
  farmWaterUseMultiplier: 1,
  toolDurabilityMultiplier: 1,
  manufacturingOutputMultiplier: 1,
  manufacturingInputUseMultiplier: 1,
  manufacturingQualityBonus: 0,
  storefrontTrafficMultiplier: 1,
  storefrontListingCapacityBonus: 0,
  storefrontConversionMultiplier: 1,
  storefrontPriceToleranceMultiplier: 1,
  downtimeMultiplier: 1,
};

export function round4(value: number): number {
  return Number(value.toFixed(4));
}

export function resolveMultiplier(baseEffect: number, gainMultiplier: number, level: number): number {
  if (level <= 0) return 1;
  return round4(baseEffect * Math.pow(gainMultiplier, level - 1));
}

export function resolveReductionMultiplier(baseEffect: number, gainMultiplier: number, level: number): number {
  if (level <= 0) return 1;
  const baseReduction = Math.max(0, 1 - baseEffect);
  const reduction = baseReduction * Math.pow(gainMultiplier, level - 1);
  return round4(Math.max(0.1, 1 - reduction));
}

export function getDowntimeMultiplier(policy: "none" | "partial" | "full" | null): number {
  if (policy === "full") return 0;
  if (policy === "partial") return 0.75;
  return 1;
}
