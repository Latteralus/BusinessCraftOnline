import {
  BUSINESS_UPGRADE_DEFINITIONS,
  type BusinessUpgradeDefinition,
  type BusinessUpgradeKey,
  type UpgradeDowntimePolicy,
} from "../../src/config/business-upgrades.ts";
import type { BusinessType } from "../../src/config/businesses.ts";
import {
  BUSINESS_UPGRADE_EFFECT_DEFAULTS,
  getDowntimeMultiplier,
  round4,
} from "./runtime.ts";

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
  ...BUSINESS_UPGRADE_EFFECT_DEFAULTS,
  downtimePolicy: null,
  downtimeMultiplier: BUSINESS_UPGRADE_EFFECT_DEFAULTS.downtimeMultiplier,
};

type NumericEffectField = keyof Omit<BusinessUpgradeEffects, "downtimePolicy" | "downtimeMultiplier">;

type EffectEntry = {
  field: NumericEffectField;
  op: "multiply" | "add";
};

// Maps each upgrade key to which effects field it modifies and how.
// "multiply" stacks multiplicatively (e.g. 1.1 × 1.15 = 1.265).
// "add" accumulates additively (used for flat quality/slot bonuses).
const UPGRADE_EFFECT_MAP: Record<BusinessUpgradeKey, EffectEntry | null> = {
  // ─── shared ───────────────────────────────────────────────────────────────
  extraction_efficiency:      { field: "extractionOutputMultiplier",      op: "multiply" },
  worker_capacity:            { field: "workerCapacitySlots",             op: "add"      },
  tool_durability:            { field: "toolDurabilityMultiplier",        op: "multiply" },
  ore_quality:                { field: "extractionQualityBonus",          op: "add"      },
  crop_yield:                 { field: "extractionOutputMultiplier",      op: "multiply" },
  water_efficiency:           { field: "farmWaterUseMultiplier",          op: "multiply" },
  production_efficiency:      { field: "manufacturingOutputMultiplier",   op: "multiply" },
  equipment_quality:          { field: "manufacturingQualityBonus",       op: "add"      },
  storefront_appeal:          { field: "storefrontTrafficMultiplier",     op: "multiply" },
  listing_capacity:           { field: "storefrontListingCapacityBonus",  op: "add"      },
  customer_service:           null, // special-cased below (affects two fields)

  // ─── mine ─────────────────────────────────────────────────────────────────
  mine_survey_crew:           { field: "extractionOutputMultiplier",      op: "multiply" },
  mine_shaft_rails:           { field: "extractionOutputMultiplier",      op: "multiply" },
  mine_blasting_permits:      { field: "extractionOutputMultiplier",      op: "multiply" },
  mine_ventilation_system:    { field: "extractionOutputMultiplier",      op: "multiply" },
  mine_ore_sorting_deck:      { field: "extractionQualityBonus",          op: "add"      },
  mine_shaft_deepening:       { field: "extractionOutputMultiplier",      op: "multiply" },
  mine_open_pit_conversion:   { field: "extractionOutputMultiplier",      op: "multiply" },
  mine_refined_tunneling:     { field: "extractionQualityBonus",          op: "add"      },

  // ─── farm ─────────────────────────────────────────────────────────────────
  farm_seed_stock:            { field: "extractionOutputMultiplier",      op: "multiply" },
  farm_compost_system:        { field: "farmWaterUseMultiplier",          op: "multiply" },
  farm_drip_irrigation:       { field: "extractionOutputMultiplier",      op: "multiply" },
  farm_grain_silo:            { field: "workerCapacitySlots",             op: "add"      },
  farm_greenhouse:            { field: "extractionOutputMultiplier",      op: "multiply" },
  farm_combine_harvester:     { field: "extractionOutputMultiplier",      op: "multiply" },
  farm_organic_certification: { field: "extractionQualityBonus",          op: "add"      },
  farm_industrial_scale:      { field: "extractionOutputMultiplier",      op: "multiply" },

  // ─── logging ──────────────────────────────────────────────────────────────
  logging_chainsaw_fleet:     { field: "extractionOutputMultiplier",      op: "multiply" },
  logging_skid_road:          { field: "toolDurabilityMultiplier",        op: "multiply" },
  logging_loader_crane:       { field: "extractionOutputMultiplier",      op: "multiply" },
  logging_reforestation:      { field: "extractionOutputMultiplier",      op: "multiply" },
  logging_bunkhouse:          { field: "workerCapacitySlots",             op: "add"      },
  logging_log_processor:      { field: "extractionQualityBonus",          op: "add"      },
  logging_sustainable_cert:   { field: "extractionQualityBonus",          op: "add"      },
  logging_clear_cut:          { field: "extractionOutputMultiplier",      op: "multiply" },

  // ─── oil well ─────────────────────────────────────────────────────────────
  oil_pump_jack:              { field: "extractionOutputMultiplier",      op: "multiply" },
  oil_separator_tank:         { field: "extractionQualityBonus",          op: "add"      },
  oil_secondary_recovery:     { field: "extractionOutputMultiplier",      op: "multiply" },
  oil_pipeline_connection:    { field: "extractionOutputMultiplier",      op: "multiply" },
  oil_tertiary_recovery:      { field: "extractionOutputMultiplier",      op: "multiply" },
  oil_refinery_stub:          { field: "extractionQualityBonus",          op: "add"      },
  oil_scada_automation:       { field: "extractionOutputMultiplier",      op: "multiply" },
  oil_manual_optimization:    { field: "extractionQualityBonus",          op: "add"      },

  // ─── water company ────────────────────────────────────────────────────────
  water_filter_upgrade:       { field: "extractionQualityBonus",          op: "add"      },
  water_pressure_system:      { field: "extractionOutputMultiplier",      op: "multiply" },
  water_reservoir_expansion:  { field: "extractionOutputMultiplier",      op: "multiply" },
  water_treatment_plant:      { field: "extractionQualityBonus",          op: "add"      },
  water_distribution_network: { field: "extractionOutputMultiplier",      op: "multiply" },
  water_automated_monitoring: { field: "extractionOutputMultiplier",      op: "multiply" },
  water_community_focus:      { field: "extractionQualityBonus",          op: "add"      },

  // ─── sawmill ──────────────────────────────────────────────────────────────
  sawmill_blade_set:          { field: "manufacturingQualityBonus",       op: "add"      },
  sawmill_log_deck:           { field: "manufacturingOutputMultiplier",   op: "multiply" },
  sawmill_kiln_dryer:         { field: "manufacturingQualityBonus",       op: "add"      },
  sawmill_planer_mill:        { field: "manufacturingOutputMultiplier",   op: "multiply" },
  sawmill_waste_boiler:       { field: "manufacturingInputUseMultiplier", op: "multiply" },
  sawmill_cnc_router:         { field: "manufacturingOutputMultiplier",   op: "multiply" },
  sawmill_mass_production:    { field: "manufacturingOutputMultiplier",   op: "multiply" },
  sawmill_premium_lumber:     { field: "manufacturingQualityBonus",       op: "add"      },

  // ─── metalworking ─────────────────────────────────────────────────────────
  metal_forge_lining:         { field: "manufacturingInputUseMultiplier", op: "multiply" },
  metal_grinder_rack:         { field: "manufacturingQualityBonus",       op: "add"      },
  metal_induction_furnace:    { field: "manufacturingOutputMultiplier",   op: "multiply" },
  metal_cnc_lathe:            { field: "manufacturingQualityBonus",       op: "add"      },
  metal_heat_treatment_oven:  { field: "manufacturingQualityBonus",       op: "add"      },
  metal_robotic_welder:       { field: "manufacturingOutputMultiplier",   op: "multiply" },
  metal_specialty_alloys:     { field: "manufacturingQualityBonus",       op: "add"      },
  metal_mass_stampings:       { field: "manufacturingOutputMultiplier",   op: "multiply" },

  // ─── food processing ──────────────────────────────────────────────────────
  food_cold_storage:          { field: "manufacturingInputUseMultiplier", op: "multiply" },
  food_pasteurizer:           { field: "manufacturingQualityBonus",       op: "add"      },
  food_packaging_line:        { field: "manufacturingOutputMultiplier",   op: "multiply" },
  food_batch_cooker:          { field: "manufacturingOutputMultiplier",   op: "multiply" },
  food_freeze_dryer:          { field: "manufacturingQualityBonus",       op: "add"      },
  food_organic_label:         { field: "manufacturingQualityBonus",       op: "add"      },
  food_mass_market:           { field: "manufacturingOutputMultiplier",   op: "multiply" },

  // ─── winery / distillery ──────────────────────────────────────────────────
  winery_oak_barrels:         { field: "manufacturingQualityBonus",       op: "add"      },
  winery_grape_press:         { field: "manufacturingOutputMultiplier",   op: "multiply" },
  winery_temperature_tanks:   { field: "manufacturingQualityBonus",       op: "add"      },
  winery_bottling_line:       { field: "manufacturingOutputMultiplier",   op: "multiply" },
  winery_cellar_expansion:    { field: "manufacturingQualityBonus",       op: "add"      },
  winery_master_distiller:    { field: "manufacturingQualityBonus",       op: "add"      },
  winery_prestige_label:      { field: "storefrontTrafficMultiplier",     op: "multiply" },
  winery_bulk_distribution:   { field: "manufacturingOutputMultiplier",   op: "multiply" },

  // ─── carpentry ────────────────────────────────────────────────────────────
  carp_hand_tool_set:         { field: "manufacturingQualityBonus",       op: "add"      },
  carp_table_saw:             { field: "manufacturingOutputMultiplier",   op: "multiply" },
  carp_dust_collector:        { field: "manufacturingInputUseMultiplier", op: "multiply" },
  carp_spray_booth:           { field: "manufacturingQualityBonus",       op: "add"      },
  carp_panel_saw:             { field: "manufacturingOutputMultiplier",   op: "multiply" },
  carp_cnc_joinery:           { field: "manufacturingQualityBonus",       op: "add"      },
  carp_bespoke_workshop:      { field: "manufacturingQualityBonus",       op: "add"      },
  carp_production_shop:       { field: "manufacturingOutputMultiplier",   op: "multiply" },

  // ─── general store ────────────────────────────────────────────────────────
  store_window_display:       { field: "storefrontTrafficMultiplier",     op: "multiply" },
  store_loyalty_board:        { field: "storefrontConversionMultiplier",  op: "multiply" },
  store_pos_system:           { field: "storefrontConversionMultiplier",  op: "multiply" },
  store_stockroom_shelving:   { field: "storefrontListingCapacityBonus",  op: "add"      },
  store_delivery_van:         { field: "storefrontTrafficMultiplier",     op: "multiply" },
  store_second_checkout:      { field: "storefrontConversionMultiplier",  op: "multiply" },
  store_franchise_model:      { field: "storefrontTrafficMultiplier",     op: "multiply" },
  store_premium_boutique:     { field: "storefrontPriceToleranceMultiplier", op: "multiply" },

  // ─── specialty store ──────────────────────────────────────────────────────
  spec_expert_staff:          { field: "storefrontConversionMultiplier",  op: "multiply" },
  spec_display_case:          { field: "storefrontTrafficMultiplier",     op: "multiply" },
  spec_private_label:         { field: "storefrontPriceToleranceMultiplier", op: "multiply" },
  spec_loyalty_program:       { field: "storefrontConversionMultiplier",  op: "multiply" },
  spec_event_space:           { field: "storefrontTrafficMultiplier",     op: "multiply" },
  spec_membership_tier:       { field: "storefrontPriceToleranceMultiplier", op: "multiply" },
  spec_exclusive_supplier:    { field: "storefrontTrafficMultiplier",     op: "multiply" },
  spec_flagship_store:        { field: "storefrontConversionMultiplier",  op: "multiply" },
};

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

    // customer_service is a special case: affects conversion AND price tolerance.
    if (upgradeKey === "customer_service") {
      effects.storefrontConversionMultiplier = round4(effects.storefrontConversionMultiplier * value);
      effects.storefrontPriceToleranceMultiplier = round4(effects.storefrontPriceToleranceMultiplier * (1 + (value - 1) * 0.75));
      continue;
    }

    const entry = UPGRADE_EFFECT_MAP[upgradeKey];
    if (!entry) continue;

    if (entry.op === "multiply") {
      (effects[entry.field] as number) = round4((effects[entry.field] as number) * value);
    } else {
      (effects[entry.field] as number) = (effects[entry.field] as number) + value;
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
