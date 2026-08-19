import { nowIso } from "@/lib/core/time";
import { toNumber } from "@/lib/core/number";
import type { QueryClient } from "@/lib/db/query-client";
import type { BusinessUpgradeProject } from "@/domains/businesses/types";

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

  // Nothing to apply -- skip the redundant re-select of the same table this
  // function's caller just paid for. Resolves audit finding M3.
  if (readyProjects.length === 0) {
    return projects;
  }

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

    project.project_status = "completed";
    project.applied_at = currentIso;
    project.updated_at = currentIso;
  }

  return projects;
}

