import {
  getBusinessUpgradeDefinition,
  getBusinessUpgradeDefinitions,
  getBusinessUpgradeDefinitionsForBusinessType,
} from "@/config/business-upgrades";
import { calculateUpgradeCost } from "@/config/upgrades";
import { formatUpgradeEffectValue } from "./formatting";
import type { BusinessUpgradeKey, BusinessType } from "./types";
import type { UpgradeDefinition, UpgradePreview, UpgradePreviewInput } from "./types";
import { resolveUpgradeEffectValue } from "../../../shared/upgrades/effects";

type QueryClient = {
  from: (table: string) => any;
};

function mapDefinitionToRow(definition: ReturnType<typeof getBusinessUpgradeDefinition>): UpgradeDefinition {
  if (!definition) {
    throw new Error("Upgrade definition not found.");
  }

  const timestamp = new Date(0).toISOString();
  return {
    upgrade_key: definition.key,
    display_name: definition.displayName,
    description: definition.shortDescription,
    immersive_label: definition.immersiveLabel,
    family: definition.family,
    project_category: definition.projectCategory,
    effect_kind: definition.effectKind,
    applies_to_business_types: [...definition.appliesTo],
    base_cost: definition.baseCost,
    cost_multiplier: definition.costMultiplier,
    base_effect: definition.baseEffect,
    gain_multiplier: definition.gainMultiplier,
    effect_label: definition.effectLabel,
    install_time_minutes: definition.installTimeMinutes,
    downtime_policy: definition.downtimePolicy,
    stage: definition.stage,
    ui_format: definition.uiFormat,
    is_infinite: definition.isInfinite,
    max_level: definition.maxLevel,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

export async function getUpgradeDefinitions(_client: QueryClient): Promise<UpgradeDefinition[]> {
  return getBusinessUpgradeDefinitions().map((definition) =>
    mapDefinitionToRow(definition)
  );
}

export async function getUpgradeDefinitionByKey(
  _client: QueryClient,
  upgradeKey: BusinessUpgradeKey
): Promise<UpgradeDefinition | null> {
  const definition = getBusinessUpgradeDefinition(upgradeKey);
  return definition ? mapDefinitionToRow(definition) : null;
}

export async function getUpgradeDefinitionsForBusinessType(
  _client: QueryClient,
  businessType: BusinessType
): Promise<UpgradeDefinition[]> {
  return getBusinessUpgradeDefinitionsForBusinessType(businessType).map((definition) =>
    mapDefinitionToRow(definition)
  );
}

export function calculateUpgradePreview(
  definition: UpgradeDefinition,
  input: UpgradePreviewInput
): UpgradePreview {
  const currentLevel = Math.max(0, Math.trunc(input.currentLevel));
  const nextLevel = currentLevel + 1;
  const currentCost =
    currentLevel > 0
      ? calculateUpgradeCost(definition.base_cost, currentLevel, definition.cost_multiplier)
      : 0;
  const nextCost = calculateUpgradeCost(definition.base_cost, nextLevel, definition.cost_multiplier);
  const currentEffect = resolveUpgradeEffectValue(
    {
      key: definition.upgrade_key,
      family: definition.family,
      displayName: definition.display_name,
      shortDescription: definition.description,
      immersiveLabel: definition.immersive_label,
      projectCategory: definition.project_category,
      appliesTo: definition.applies_to_business_types,
      effectKind: definition.effect_kind,
      baseCost: definition.base_cost,
      costMultiplier: definition.cost_multiplier,
      baseEffect: definition.base_effect,
      gainMultiplier: definition.gain_multiplier,
      installTimeMinutes: definition.install_time_minutes,
      downtimePolicy: definition.downtime_policy,
      stage: definition.stage,
      maxLevel: definition.max_level,
      isInfinite: definition.is_infinite,
      uiFormat: definition.ui_format,
      effectLabel: definition.effect_label,
    },
    currentLevel
  );
  const nextEffect = resolveUpgradeEffectValue(
    {
      key: definition.upgrade_key,
      family: definition.family,
      displayName: definition.display_name,
      shortDescription: definition.description,
      immersiveLabel: definition.immersive_label,
      projectCategory: definition.project_category,
      appliesTo: definition.applies_to_business_types,
      effectKind: definition.effect_kind,
      baseCost: definition.base_cost,
      costMultiplier: definition.cost_multiplier,
      baseEffect: definition.base_effect,
      gainMultiplier: definition.gain_multiplier,
      installTimeMinutes: definition.install_time_minutes,
      downtimePolicy: definition.downtime_policy,
      stage: definition.stage,
      maxLevel: definition.max_level,
      isInfinite: definition.is_infinite,
      uiFormat: definition.ui_format,
      effectLabel: definition.effect_label,
    },
    nextLevel
  );

  return {
    upgradeKey: definition.upgrade_key,
    currentLevel,
    nextLevel,
    currentCost,
    nextCost,
    currentEffect,
    nextEffect,
    effectLabel: definition.effect_label,
    currentEffectDisplay: formatUpgradeEffectValue(definition, currentEffect),
    nextEffectDisplay: formatUpgradeEffectValue(definition, nextEffect),
    isInfinite: definition.is_infinite,
    maxLevel: definition.max_level,
  };
}

export async function getUpgradePreviewForBusiness(
  client: QueryClient,
  businessType: BusinessType,
  input: UpgradePreviewInput
): Promise<UpgradePreview> {
  const definition = await getUpgradeDefinitionByKey(client, input.upgradeKey);

  if (!definition) {
    throw new Error(`Upgrade definition '${input.upgradeKey}' not found.`);
  }

  if (!definition.applies_to_business_types.includes(businessType)) {
    throw new Error(
      `Upgrade '${input.upgradeKey}' is not available for business type '${businessType}'.`
    );
  }

  if (!definition.is_infinite && definition.max_level !== null && input.currentLevel >= definition.max_level) {
    throw new Error(
      `Upgrade '${input.upgradeKey}' has reached max level ${definition.max_level}.`
    );
  }

  return calculateUpgradePreview(definition, input);
}
