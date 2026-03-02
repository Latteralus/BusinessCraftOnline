import type { BusinessType, BusinessUpgradeKey } from "@/config/businesses";

export type UpgradeDefinition = {
  upgrade_key: BusinessUpgradeKey;
  display_name: string;
  description: string;
  applies_to_business_types: BusinessType[];
  base_cost: number;
  cost_multiplier: number;
  base_effect: number;
  gain_multiplier: number;
  effect_label: string;
  is_infinite: boolean;
  max_level: number | null;
  created_at: string;
  updated_at: string;
};

export type UpgradePreview = {
  upgradeKey: BusinessUpgradeKey;
  currentLevel: number;
  nextLevel: number;
  currentCost: number;
  nextCost: number;
  currentEffect: number;
  nextEffect: number;
  effectLabel: string;
  isInfinite: boolean;
  maxLevel: number | null;
};

export type UpgradePreviewInput = {
  upgradeKey: BusinessUpgradeKey;
  currentLevel: number;
};

export type { BusinessType, BusinessUpgradeKey };
