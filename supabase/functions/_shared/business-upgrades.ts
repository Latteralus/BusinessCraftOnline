import type { EdgeSupabaseClient } from "./tick-runtime.ts";

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

const DEFAULT_EFFECTS: BusinessUpgradeEffects = {
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

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}

function resolveMultiplier(baseEffect: number, gainMultiplier: number, level: number): number {
  if (level <= 0) return 1;
  return round4(baseEffect * Math.pow(gainMultiplier, level - 1));
}

function resolveReductionMultiplier(baseEffect: number, gainMultiplier: number, level: number): number {
  if (level <= 0) return 1;
  const baseReduction = Math.max(0, 1 - baseEffect);
  const reduction = baseReduction * Math.pow(gainMultiplier, level - 1);
  return round4(Math.max(0.1, 1 - reduction));
}

function getDowntimeMultiplier(policy: UpgradeDowntimePolicy | null): number {
  if (policy === "full") return 0;
  if (policy === "partial") return 0.75;
  return 1;
}

function resolveEffectsFromLevels(
  _businessType: string,
  levels: Record<string, number>,
  activePolicies: UpgradeDowntimePolicy[]
): BusinessUpgradeEffects {
  const effects: BusinessUpgradeEffects = { ...DEFAULT_EFFECTS };

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
    1.15,
    1.05,
    Math.max(0, levels.production_efficiency ?? 0)
  );
  effects.manufacturingInputUseMultiplier = resolveReductionMultiplier(
    0.96,
    1.08,
    Math.max(0, levels.input_reduction ?? 0)
  );
  effects.manufacturingQualityBonus = Math.max(0, 4 * (levels.equipment_quality ?? 0));
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
