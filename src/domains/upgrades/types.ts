import type { BusinessType, BusinessUpgradeKey } from "@/config/businesses";
import type {
  UpgradeDowntimePolicy,
  UpgradeEffectKind,
  UpgradeFamily,
  UpgradeProjectCategory,
  UpgradeStage,
  UpgradeUiFormat,
} from "@/config/business-upgrades";
import type { BusinessUpgradeEffects } from "../../../shared/upgrades/effects";

export type UpgradeDefinition = {
  upgrade_key: BusinessUpgradeKey;
  display_name: string;
  description: string;
  immersive_label: string;
  family: UpgradeFamily;
  project_category: UpgradeProjectCategory;
  effect_kind: UpgradeEffectKind;
  applies_to_business_types: BusinessType[];
  base_cost: number;
  cost_multiplier: number;
  base_effect: number;
  gain_multiplier: number;
  effect_label: string;
  install_time_minutes: number;
  downtime_policy: UpgradeDowntimePolicy;
  stage: UpgradeStage;
  ui_format: UpgradeUiFormat;
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
  currentEffectDisplay: string;
  nextEffectDisplay: string;
  isInfinite: boolean;
  maxLevel: number | null;
};

export type UpgradePreviewInput = {
  upgradeKey: BusinessUpgradeKey;
  currentLevel: number;
};

export type ResolvedBusinessUpgradeEffects = BusinessUpgradeEffects;

export type { BusinessType, BusinessUpgradeKey };
