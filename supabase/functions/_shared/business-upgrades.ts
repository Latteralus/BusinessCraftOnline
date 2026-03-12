import type { EdgeSupabaseClient } from "./tick-runtime.ts";
import {
  BUSINESS_UPGRADE_EFFECT_DEFAULTS,
  getDowntimeMultiplier,
  resolveMultiplier,
  resolveReductionMultiplier,
  round4,
} from "../../../shared/upgrades/runtime.ts";

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
  effects.extractionOutputMultiplier = resolveMultiplier(
    1.12,
    1.05,
    Math.max(0, levels.extraction_efficiency ?? levels.crop_yield ?? 0)
  );
  effects.extractionQualityBonus = Math.max(0, 4 * (levels.ore_quality ?? 0));
  effects.farmWaterUseMultiplier = round4(
    effects.farmWaterUseMultiplier *
      resolveReductionMultiplier(0.92, 1.08, Math.max(0, levels.water_efficiency ?? 0))
  );
  effects.toolDurabilityMultiplier = resolveMultiplier(
    1.15,
    1.04,
    Math.max(0, levels.tool_durability ?? 0)
  );
  effects.manufacturingOutputMultiplier = resolveMultiplier(
    1.5,
    1.5,
    Math.max(0, levels.production_efficiency ?? 0)
  );
  effects.manufacturingQualityBonus = Math.max(0, 5 * (levels.equipment_quality ?? 0));
  effects.storefrontTrafficMultiplier = resolveMultiplier(
    1.05,
    1.03,
    Math.max(0, levels.storefront_appeal ?? 0)
  );
  effects.storefrontListingCapacityBonus = Math.max(0, levels.listing_capacity ?? 0);
  effects.storefrontConversionMultiplier = resolveMultiplier(
    1.03,
    1.02,
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

async function applyCompletedProjects(
  supabase: EdgeSupabaseClient,
  businessId: string
) {
  const currentIso = new Date().toISOString();
  const { data: projects, error } = await supabase
    .from("business_upgrade_projects")
    .select("id, upgrade_key, target_level, project_status, completes_at, downtime_policy")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const parsedProjects = ((projects ?? []) as ProjectRow[]).filter(
    (project) =>
      project.project_status === "installing" &&
      project.completes_at !== null &&
      project.completes_at <= currentIso
  );

  for (const project of parsedProjects) {
    const { data: existingUpgrades, error: existingError } = await supabase
      .from("business_upgrades")
      .select("id")
      .eq("business_id", businessId)
      .eq("upgrade_key", project.upgrade_key)
      .limit(1);

    if (existingError) throw existingError;
    const existingUpgrade = Array.isArray(existingUpgrades) ? existingUpgrades[0] : null;

    const existingUpgradeId =
      existingUpgrade && typeof existingUpgrade === "object" && "id" in existingUpgrade
        ? String((existingUpgrade as { id: string }).id)
        : null;

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
        business_id: businessId,
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

export async function getResolvedBusinessUpgradeEffects(
  supabase: EdgeSupabaseClient,
  businessId: string,
  businessType: string
) {
  await applyCompletedProjects(supabase, businessId);

  const [{ data: upgradeRows, error: upgradeError }, { data: projectRows, error: projectError }] =
    await Promise.all([
      supabase.from("business_upgrades").select("upgrade_key, level").eq("business_id", businessId),
      supabase
        .from("business_upgrade_projects")
        .select("downtime_policy")
        .eq("business_id", businessId)
        .in("project_status", ["queued", "installing"]),
    ]);

  if (upgradeError) throw upgradeError;
  if (projectError) throw projectError;

  const levels = Object.fromEntries(
    ((upgradeRows ?? []) as Array<{ upgrade_key: string; level: number | string }>).map((row) => [
      row.upgrade_key,
      toNumber(row.level),
    ])
  );
  const activePolicies = ((projectRows ?? []) as Array<{ downtime_policy: UpgradeDowntimePolicy }>).map(
    (project) => project.downtime_policy
  );

  return resolveEffectsFromLevels(businessType, levels, activePolicies);
}
