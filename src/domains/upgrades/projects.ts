import { getBusinessUpgradeDefinition } from "@/config/business-upgrades";
import { nowIso } from "@/lib/core/time";
import type { BusinessUpgradeKey } from "./types";
import type { BusinessUpgradeProject } from "@/domains/businesses/types";

type QueryClient = {
  from: (table: string) => any;
};

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

function normalizeProject(row: BusinessUpgradeProject): BusinessUpgradeProject {
  return {
    ...row,
    target_level: Number(row.target_level),
    quoted_cost: toNumber(row.quoted_cost),
  };
}

export async function getBusinessUpgradeProjects(
  client: QueryClient,
  businessId: string
): Promise<BusinessUpgradeProject[]> {
  const { data, error } = await client
    .from("business_upgrade_projects")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return ((data as BusinessUpgradeProject[]) ?? []).map(normalizeProject);
}

export async function applyCompletedUpgradeProjects(
  client: QueryClient,
  businessId: string
): Promise<BusinessUpgradeProject[]> {
  const currentIso = nowIso();
  const projects = await getBusinessUpgradeProjects(client, businessId);
  const readyProjects = projects.filter(
    (project) =>
      project.project_status === "installing" &&
      project.completes_at !== null &&
      project.completes_at <= currentIso
  );

  for (const project of readyProjects) {
    const { data: existingUpgrade, error: existingError } = await client
      .from("business_upgrades")
      .select("id")
      .eq("business_id", businessId)
      .eq("upgrade_key", project.upgrade_key)
      .maybeSingle();

    if (existingError) throw existingError;

    if (existingUpgrade?.id) {
      const { error: updateError } = await client
        .from("business_upgrades")
        .update({
          level: project.target_level,
          purchased_at: currentIso,
          updated_at: currentIso,
        })
        .eq("id", existingUpgrade.id);

      if (updateError) throw updateError;
    } else {
      const { error: insertError } = await client.from("business_upgrades").insert({
        business_id: businessId,
        upgrade_key: project.upgrade_key,
        level: project.target_level,
        purchased_at: currentIso,
      });

      if (insertError) throw insertError;
    }

    const { error: projectUpdateError } = await client
      .from("business_upgrade_projects")
      .update({
        project_status: "completed",
        applied_at: currentIso,
        updated_at: currentIso,
      })
      .eq("id", project.id);

    if (projectUpdateError) throw projectUpdateError;
  }

  return getBusinessUpgradeProjects(client, businessId);
}

export async function createUpgradeProject(
  client: QueryClient,
  input: {
    businessId: string;
    upgradeKey: BusinessUpgradeKey;
    targetLevel: number;
    quotedCost: number;
  }
): Promise<BusinessUpgradeProject> {
  const definition = getBusinessUpgradeDefinition(input.upgradeKey);
  if (!definition) {
    throw new Error(`Upgrade definition '${input.upgradeKey}' not found.`);
  }

  const currentProjects = await applyCompletedUpgradeProjects(client, input.businessId);
  const activeProject = currentProjects.find(
    (project) => project.project_status === "queued" || project.project_status === "installing"
  );

  if (activeProject) {
    throw new Error("This business already has an active capital project.");
  }

  const startedAt = nowIso();
  const completesAt = new Date(
    Date.now() + definition.installTimeMinutes * 60 * 1000
  ).toISOString();

  const { data, error } = await client
    .from("business_upgrade_projects")
    .insert({
      business_id: input.businessId,
      upgrade_key: input.upgradeKey,
      target_level: input.targetLevel,
      project_status: "installing",
      quoted_cost: input.quotedCost,
      started_at: startedAt,
      completes_at: completesAt,
      applied_at: null,
      downtime_policy: definition.downtimePolicy,
    })
    .select("*")
    .single();

  if (error) throw error;
  return normalizeProject(data as BusinessUpgradeProject);
}
