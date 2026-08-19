import type { EdgeSupabaseClient } from "./tick-runtime.ts";
import {
  BUSINESS_UPGRADE_EFFECT_DEFAULTS,
  getDowntimeMultiplier,
  resolveMultiplier,
  resolveReductionMultiplier,
  round4,
} from "../../../shared/upgrades/runtime.ts";
import { BUSINESS_UPGRADE_DEFINITIONS } from "../../../src/config/business-upgrades.ts";

type UpgradeDowntimePolicy = "none" | "partial" | "full";

type ProjectRow = {
  id: string;
  upgrade_key: string;
  target_level: number | string;
  project_status: "queued" | "installing" | "completed" | "cancelled";
  completes_at: string | null;
  downtime_policy: UpgradeDowntimePolicy;
};

type BusinessUpgradeEffects = {
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

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

function resolveEffectsFromLevels(
  _businessType: string,
  levels: Record<string, number>,
  activePolicies: UpgradeDowntimePolicy[]
): BusinessUpgradeEffects {
  const effects: BusinessUpgradeEffects = {
    ...BUSINESS_UPGRADE_EFFECT_DEFAULTS,
    downtimePolicy: null,
    downtimeMultiplier: BUSINESS_UPGRADE_EFFECT_DEFAULTS.downtimeMultiplier,
  };

  const workerCapacityLevel = Math.max(0, levels.worker_capacity ?? 0);
  effects.workerCapacitySlots = workerCapacityLevel;

  const extractionDef =
    levels.extraction_efficiency != null
      ? BUSINESS_UPGRADE_DEFINITIONS.extraction_efficiency
      : BUSINESS_UPGRADE_DEFINITIONS.crop_yield;
  effects.extractionOutputMultiplier = resolveMultiplier(
    extractionDef.baseEffect,
    Math.max(0, levels.extraction_efficiency ?? levels.crop_yield ?? 0)
  );
  effects.extractionQualityBonus = Math.max(
    0,
    BUSINESS_UPGRADE_DEFINITIONS.ore_quality.baseEffect * (levels.ore_quality ?? 0)
  );
  effects.farmWaterUseMultiplier = round4(
    effects.farmWaterUseMultiplier *
      resolveReductionMultiplier(
        BUSINESS_UPGRADE_DEFINITIONS.water_efficiency.baseEffect,
        Math.max(0, levels.water_efficiency ?? 0),
        BUSINESS_UPGRADE_DEFINITIONS.water_efficiency.maxLevel ?? 6
      )
  );
  effects.toolDurabilityMultiplier = resolveMultiplier(
    BUSINESS_UPGRADE_DEFINITIONS.tool_durability.baseEffect,
    Math.max(0, levels.tool_durability ?? 0)
  );
  effects.manufacturingOutputMultiplier = resolveMultiplier(
    BUSINESS_UPGRADE_DEFINITIONS.production_efficiency.baseEffect,
    Math.max(0, levels.production_efficiency ?? 0)
  );
  effects.manufacturingQualityBonus = Math.max(
    0,
    BUSINESS_UPGRADE_DEFINITIONS.equipment_quality.baseEffect * (levels.equipment_quality ?? 0)
  );
  effects.storefrontTrafficMultiplier = resolveMultiplier(
    BUSINESS_UPGRADE_DEFINITIONS.storefront_appeal.baseEffect,
    Math.max(0, levels.storefront_appeal ?? 0)
  );
  effects.storefrontListingCapacityBonus = Math.max(0, levels.listing_capacity ?? 0);
  effects.storefrontConversionMultiplier = resolveMultiplier(
    BUSINESS_UPGRADE_DEFINITIONS.customer_service.baseEffect,
    Math.max(0, levels.customer_service ?? 0)
  );
  effects.storefrontPriceToleranceMultiplier = round4(
    1 + (effects.storefrontConversionMultiplier - 1) * 0.75
  );

  const downtimePolicy = activePolicies.includes("full")
    ? "full"
    : activePolicies.includes("partial")
      ? "partial"
      : null;

  effects.downtimePolicy = downtimePolicy;
  effects.downtimeMultiplier = getDowntimeMultiplier(downtimePolicy);

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

async function applyCompletedProjectsForBusinesses(
  supabase: EdgeSupabaseClient,
  businessIds: string[]
) {
  if (businessIds.length === 0) return;

  const currentIso = new Date().toISOString();
  const { data: projects, error } = await supabase
    .from("business_upgrade_projects")
    .select("id, business_id, upgrade_key, target_level, project_status, completes_at, downtime_policy")
    .in("business_id", businessIds)
    .eq("project_status", "installing")
    .lte("completes_at", currentIso);

  if (error) throw error;

  const parsedProjects = (projects ?? []) as (ProjectRow & { business_id: string })[];
  if (parsedProjects.length === 0) return;

  // One lookup covering every (business_id, upgrade_key) pair that might be
  // touched this pass, instead of one select per completing project.
  const { data: existingUpgrades, error: existingError } = await supabase
    .from("business_upgrades")
    .select("id, business_id, upgrade_key")
    .in("business_id", businessIds);

  if (existingError) throw existingError;

  const existingIdByKey = new Map<string, string>();
  for (const row of (existingUpgrades ?? []) as Array<{ id: string; business_id: string; upgrade_key: string }>) {
    existingIdByKey.set(`${row.business_id}:${row.upgrade_key}`, row.id);
  }

  for (const project of parsedProjects) {
    const existingUpgradeId = existingIdByKey.get(`${project.business_id}:${project.upgrade_key}`) ?? null;

    if (existingUpgradeId) {
      const { error: updateError } = await supabase
        .from("business_upgrades")
        .update({
          level: toNumber(project.target_level),
          purchased_at: currentIso,
          updated_at: currentIso,
        } as never)
        .eq("id", existingUpgradeId);

      if (updateError) throw updateError;
    } else {
      const { error: insertError } = await supabase.from("business_upgrades").insert({
        business_id: project.business_id,
        upgrade_key: project.upgrade_key,
        level: toNumber(project.target_level),
        purchased_at: currentIso,
      } as never);

      if (insertError) throw insertError;
    }

    const { error: projectUpdateError } = await supabase
      .from("business_upgrade_projects")
      .update({
        project_status: "completed",
        applied_at: currentIso,
        updated_at: currentIso,
      } as never)
      .eq("id", project.id);

    if (projectUpdateError) throw projectUpdateError;
  }
}

/**
 * Resolves upgrade effects for every given business in a small constant
 * number of round trips, regardless of how many active slots/lines/stores
 * those businesses have. Replaces calling getResolvedBusinessUpgradeEffects
 * once per row inside a tick's per-row loop (each call re-fetched and
 * re-derived the same per-business data every time).
 */
export async function getResolvedBusinessUpgradeEffectsForBusinesses(
  supabase: EdgeSupabaseClient,
  businesses: Array<{ id: string; type: string }>
): Promise<Map<string, BusinessUpgradeEffects>> {
  const businessIds = [...new Set(businesses.map((business) => business.id))];
  if (businessIds.length === 0) return new Map();

  await applyCompletedProjectsForBusinesses(supabase, businessIds);

  const [{ data: upgradeRows, error: upgradeError }, { data: projectRows, error: projectError }] =
    await Promise.all([
      supabase.from("business_upgrades").select("business_id, upgrade_key, level").in("business_id", businessIds),
      supabase
        .from("business_upgrade_projects")
        .select("business_id, downtime_policy")
        .in("business_id", businessIds)
        .in("project_status", ["queued", "installing"]),
    ]);

  if (upgradeError) throw upgradeError;
  if (projectError) throw projectError;

  const levelsByBusiness = new Map<string, Record<string, number>>();
  for (const row of (upgradeRows ?? []) as Array<{ business_id: string; upgrade_key: string; level: number | string }>) {
    const levels = levelsByBusiness.get(row.business_id) ?? {};
    levels[row.upgrade_key] = toNumber(row.level);
    levelsByBusiness.set(row.business_id, levels);
  }

  const policiesByBusiness = new Map<string, UpgradeDowntimePolicy[]>();
  for (const row of (projectRows ?? []) as Array<{ business_id: string; downtime_policy: UpgradeDowntimePolicy }>) {
    const policies = policiesByBusiness.get(row.business_id) ?? [];
    policies.push(row.downtime_policy);
    policiesByBusiness.set(row.business_id, policies);
  }

  const effectsByBusiness = new Map<string, BusinessUpgradeEffects>();
  for (const business of businesses) {
    if (effectsByBusiness.has(business.id)) continue;
    effectsByBusiness.set(
      business.id,
      resolveEffectsFromLevels(
        business.type,
        levelsByBusiness.get(business.id) ?? {},
        policiesByBusiness.get(business.id) ?? []
      )
    );
  }

  return effectsByBusiness;
}

export async function getResolvedBusinessUpgradeEffects(
  supabase: EdgeSupabaseClient,
  businessId: string,
  businessType: string
) {
  const effects = await getResolvedBusinessUpgradeEffectsForBusinesses(supabase, [
    { id: businessId, type: businessType },
  ]);
  return effects.get(businessId)!;
}
