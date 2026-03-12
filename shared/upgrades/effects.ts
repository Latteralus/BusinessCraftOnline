import {
  BUSINESS_UPGRADE_DEFINITIONS,
  type BusinessUpgradeDefinition,
  type BusinessUpgradeKey,
  type UpgradeDowntimePolicy,
} from "../../src/config/business-upgrades";
import type { BusinessType } from "../../src/config/businesses";

export type BusinessUpgradeLevels = Partial<Record<BusinessUpgradeKey, number>>;

export type ActiveUpgradeProjectLike = {
  upgradeKey: BusinessUpgradeKey;
  downtimePolicy: UpgradeDowntimePolicy;
};

export type BusinessUpgradeEffects = {
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
  downtimePolicy: UpgradeDowntimePolicy | null;
  downtimeMultiplier: number;
};

export const DEFAULT_BUSINESS_UPGRADE_EFFECTS: BusinessUpgradeEffects = {
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
  downtimePolicy: null,
  downtimeMultiplier: 1,
};

function round4(value: number): number {
  return Number(value.toFixed(4));
}

export function resolveUpgradeEffectValue(
  definition: BusinessUpgradeDefinition,
  level: number
): number {
  const normalizedLevel = Math.max(0, Math.trunc(level));
  if (normalizedLevel <= 0) {
    switch (definition.effectKind) {
      case "flat_slots":
      case "flat_quality":
        return 0;
      default:
        return 1;
    }
  }

  switch (definition.effectKind) {
    case "flat_slots":
    case "flat_quality":
      return definition.baseEffect * normalizedLevel;
    case "reduction_multiplier": {
      const baseReduction = Math.max(0, 1 - definition.baseEffect);
      const reduction = baseReduction * Math.pow(definition.gainMultiplier, normalizedLevel - 1);
      return round4(Math.max(0.1, 1 - reduction));
    }
    case "price_tolerance":
    case "traffic_multiplier":
    case "conversion_multiplier":
    case "multiplier":
    default:
      return round4(definition.baseEffect * Math.pow(definition.gainMultiplier, normalizedLevel - 1));
  }
}

export function getDowntimeMultiplier(policy: UpgradeDowntimePolicy | null): number {
  if (policy === "full") return 0;
  if (policy === "partial") return 0.75;
  return 1;
}

export function resolveBusinessUpgradeEffects(
  _businessType: BusinessType,
  levels: BusinessUpgradeLevels,
  activeProjects: ActiveUpgradeProjectLike[] = []
): BusinessUpgradeEffects {
  const effects: BusinessUpgradeEffects = { ...DEFAULT_BUSINESS_UPGRADE_EFFECTS };

  for (const [upgradeKey, rawLevel] of Object.entries(levels) as Array<[BusinessUpgradeKey, number | undefined]>) {
    const level = Math.max(0, Math.trunc(rawLevel ?? 0));
    if (level <= 0) continue;

    const definition = BUSINESS_UPGRADE_DEFINITIONS[upgradeKey];
    if (!definition) continue;

    const value = resolveUpgradeEffectValue(definition, level);

    switch (upgradeKey) {
      case "extraction_efficiency":
      case "crop_yield":
        effects.extractionOutputMultiplier = value;
        break;
      case "worker_capacity":
        effects.workerCapacitySlots = value;
        break;
      case "tool_durability":
        effects.toolDurabilityMultiplier = value;
        break;
      case "ore_quality":
        effects.extractionQualityBonus = value;
        break;
      case "water_efficiency":
        effects.farmWaterUseMultiplier = round4(effects.farmWaterUseMultiplier * value);
        break;
      case "production_efficiency":
        effects.manufacturingOutputMultiplier = value;
        break;
      case "equipment_quality":
        effects.manufacturingQualityBonus = value;
        break;
      case "input_reduction":
        effects.manufacturingInputUseMultiplier = value;
        break;
      case "storefront_appeal":
        effects.storefrontTrafficMultiplier = value;
        break;
      case "listing_capacity":
        effects.storefrontListingCapacityBonus = value;
        break;
      case "customer_service":
        effects.storefrontConversionMultiplier = value;
        effects.storefrontPriceToleranceMultiplier = round4(1 + (value - 1) * 0.75);
        break;
      default:
        break;
    }
  }

  const activePolicy = activeProjects.reduce<UpgradeDowntimePolicy | null>((current, project) => {
    if (project.downtimePolicy === "full") return "full";
    if (project.downtimePolicy === "partial" && current !== "full") return "partial";
    return current;
  }, null);

  effects.downtimePolicy = activePolicy;
  effects.downtimeMultiplier = getDowntimeMultiplier(activePolicy);

  if (effects.downtimeMultiplier < 1) {
    effects.extractionOutputMultiplier = round4(
      effects.extractionOutputMultiplier * effects.downtimeMultiplier
    );
    effects.manufacturingOutputMultiplier = round4(
      effects.manufacturingOutputMultiplier * effects.downtimeMultiplier
    );
    effects.storefrontTrafficMultiplier = round4(
      effects.storefrontTrafficMultiplier * effects.downtimeMultiplier
    );
  }

  return effects;
}
