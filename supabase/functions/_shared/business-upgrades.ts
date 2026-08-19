import type { EdgeSupabaseClient } from "./tick-runtime.ts";
import { toNumber } from "../../../shared/core/number.ts";
import {
  resolveBusinessUpgradeEffects,
  type ActiveUpgradeProjectLike,
  type BusinessUpgradeEffects,
  type BusinessUpgradeLevels,
} from "../../../shared/upgrades/effects.ts";
import type { BusinessType } from "../../../src/config/businesses.ts";
import type { BusinessUpgradeKey } from "../../../src/config/business-upgrades.ts";

type UpgradeDowntimePolicy = "none" | "partial" | "full";

type ProjectRow = {
  id: string;
  upgrade_key: string;
  target_level: number | string;
  project_status: "queued" | "installing" | "completed" | "cancelled";
  completes_at: string | null;
  downtime_policy: UpgradeDowntimePolicy;
};

export type { BusinessUpgradeEffects };

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
        .select("business_id, upgrade_key, downtime_policy")
        .in("business_id", businessIds)
        .in("project_status", ["queued", "installing"]),
    ]);

  if (upgradeError) throw upgradeError;
  if (projectError) throw projectError;

  const levelsByBusiness = new Map<string, BusinessUpgradeLevels>();
  for (const row of (upgradeRows ?? []) as Array<{ business_id: string; upgrade_key: string; level: number | string }>) {
    const levels = levelsByBusiness.get(row.business_id) ?? {};
    levels[row.upgrade_key as BusinessUpgradeKey] = toNumber(row.level);
    levelsByBusiness.set(row.business_id, levels);
  }

  const activeProjectsByBusiness = new Map<string, ActiveUpgradeProjectLike[]>();
  for (const row of (projectRows ?? []) as Array<{ business_id: string; upgrade_key: string; downtime_policy: UpgradeDowntimePolicy }>) {
    const projects = activeProjectsByBusiness.get(row.business_id) ?? [];
    projects.push({ upgradeKey: row.upgrade_key as BusinessUpgradeKey, downtimePolicy: row.downtime_policy });
    activeProjectsByBusiness.set(row.business_id, projects);
  }

  const effectsByBusiness = new Map<string, BusinessUpgradeEffects>();
  for (const business of businesses) {
    if (effectsByBusiness.has(business.id)) continue;
    effectsByBusiness.set(
      business.id,
      resolveBusinessUpgradeEffects(
        business.type as BusinessType,
        levelsByBusiness.get(business.id) ?? {},
        activeProjectsByBusiness.get(business.id) ?? []
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
