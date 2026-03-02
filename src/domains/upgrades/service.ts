import { calculateUpgradeCost, calculateUpgradeEffect } from "@/config/upgrades";
import type { BusinessUpgradeKey, BusinessType } from "./types";
import type { UpgradeDefinition, UpgradePreview, UpgradePreviewInput } from "./types";

type QueryClient = {
  from: (table: string) => any;
};

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

function normalizeUpgradeDefinition(row: UpgradeDefinition): UpgradeDefinition {
  return {
    ...row,
    base_cost: toNumber(row.base_cost),
    cost_multiplier: toNumber(row.cost_multiplier),
    base_effect: toNumber(row.base_effect),
    gain_multiplier: toNumber(row.gain_multiplier),
  };
}

export async function getUpgradeDefinitions(client: QueryClient): Promise<UpgradeDefinition[]> {
  const { data, error } = await client
    .from("upgrade_definitions")
    .select("*")
    .order("display_name", { ascending: true });

  if (error) throw error;
  return ((data as UpgradeDefinition[]) ?? []).map(normalizeUpgradeDefinition);
}

export async function getUpgradeDefinitionByKey(
  client: QueryClient,
  upgradeKey: BusinessUpgradeKey
): Promise<UpgradeDefinition | null> {
  const { data, error } = await client
    .from("upgrade_definitions")
    .select("*")
    .eq("upgrade_key", upgradeKey)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return normalizeUpgradeDefinition(data as UpgradeDefinition);
}

export async function getUpgradeDefinitionsForBusinessType(
  client: QueryClient,
  businessType: BusinessType
): Promise<UpgradeDefinition[]> {
  const { data, error } = await client
    .from("upgrade_definitions")
    .select("*")
    .contains("applies_to_business_types", [businessType])
    .order("display_name", { ascending: true });

  if (error) throw error;
  return ((data as UpgradeDefinition[]) ?? []).map(normalizeUpgradeDefinition);
}

export function calculateUpgradePreview(
  definition: UpgradeDefinition,
  input: UpgradePreviewInput
): UpgradePreview {
  const currentLevel = Math.max(0, Math.trunc(input.currentLevel));
  const nextLevel = currentLevel + 1;

  const currentCost = calculateUpgradeCost(
    definition.base_cost,
    Math.max(currentLevel, 1),
    definition.cost_multiplier
  );
  const nextCost = calculateUpgradeCost(definition.base_cost, nextLevel, definition.cost_multiplier);

  const currentEffect = calculateUpgradeEffect(
    definition.base_effect,
    Math.max(currentLevel, 1),
    definition.gain_multiplier
  );
  const nextEffect = calculateUpgradeEffect(definition.base_effect, nextLevel, definition.gain_multiplier);

  return {
    upgradeKey: definition.upgrade_key,
    currentLevel,
    nextLevel,
    currentCost,
    nextCost,
    currentEffect,
    nextEffect,
    effectLabel: definition.effect_label,
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
