import { resolveBusinessUpgradeEffects, type BusinessUpgradeEffects } from "../../../shared/upgrades/effects";
import type { BusinessType } from "@/config/businesses";
import { applyCompletedUpgradeProjects, getBusinessUpgradeProjects } from "./projects";
import type { BusinessUpgradeProject } from "@/domains/businesses/types";

type QueryClient = {
  from: (table: string) => any;
};

type BusinessUpgradeRow = {
  upgrade_key: string;
  level: number | string;
};

function normalizeLevel(value: number | string | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

export function mapAppliedUpgradeLevels(rows: BusinessUpgradeRow[]) {
  return Object.fromEntries(
    rows.map((row) => [row.upgrade_key, normalizeLevel(row.level)])
  );
}

function getActiveProjects(projects: BusinessUpgradeProject[]) {
  return projects
    .filter((project) => project.project_status === "queued" || project.project_status === "installing")
    .map((project) => ({
      upgradeKey: project.upgrade_key,
      downtimePolicy: project.downtime_policy,
    }));
}

export async function getResolvedUpgradeEffects(
  client: QueryClient,
  businessId: string,
  businessType: BusinessType
): Promise<BusinessUpgradeEffects> {
  const [projects, upgradesResult] = await Promise.all([
    applyCompletedUpgradeProjects(client, businessId),
    client.from("business_upgrades").select("upgrade_key, level").eq("business_id", businessId),
  ]);

  if (upgradesResult.error) throw upgradesResult.error;

  return resolveBusinessUpgradeEffects(
    businessType,
    mapAppliedUpgradeLevels((upgradesResult.data as BusinessUpgradeRow[]) ?? []),
    getActiveProjects(projects)
  );
}

export async function getBusinessUpgradeProjectState(
  client: QueryClient,
  businessId: string
): Promise<BusinessUpgradeProject[]> {
  return applyCompletedUpgradeProjects(client, businessId);
}
