import { type FinancePeriod } from "@/config/finance";
import {
  getBusinessById,
  getBusinessFinanceDashboard,
  getBusinessUpgradeProjects,
  getBusinessUpgrades,
  getBusinessesWithBalances,
  supportsExtraction,
} from "@/domains/businesses";
import { getBusinessInventory } from "@/domains/inventory";
import { getManufacturingStatus, getProductionStatus } from "@/domains/production";
import { getStoreShelfItems } from "@/domains/stores";
import { getUpgradeDefinitionsForBusinessType, type BusinessType } from "@/domains/upgrades";
import type { BusinessDetailsEntry } from "@/stores/game-store";

type QueryClient = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

export async function loadBusinessDetailsEntry(
  client: QueryClient,
  playerId: string,
  businessId: string,
  period: FinancePeriod = "1h"
): Promise<BusinessDetailsEntry | null> {
  const business = await getBusinessById(client, playerId, businessId).catch(() => null);
  if (!business) {
    return null;
  }

  const isExtraction = supportsExtraction(business.type);
  const [
    production,
    manufacturing,
    inventory,
    shelfItems,
    upgrades,
    upgradeProjects,
    employeesRes,
    upgradeDefinitions,
    financeDashboard,
    ownedBusinesses,
  ] = await Promise.all([
    isExtraction ? getProductionStatus(client, playerId, business.id).catch(() => null) : Promise.resolve(null),
    !isExtraction ? getManufacturingStatus(client, playerId, business.id).catch(() => null) : Promise.resolve(null),
    getBusinessInventory(client, playerId, business.id).catch(() => []),
    getStoreShelfItems(client, playerId, { businessId: business.id }).catch(() => []),
    getBusinessUpgrades(client, playerId, business.id).catch(() => []),
    getBusinessUpgradeProjects(client, playerId, business.id).catch(() => []),
    client
      .from("employees")
      .select("*, employee_assignments(*, business:businesses(*))")
      .eq("player_id", playerId)
      .eq("employer_business_id", business.id)
      .order("created_at", { ascending: false }),
    getUpgradeDefinitionsForBusinessType(client, business.type as BusinessType).catch(() => []),
    getBusinessFinanceDashboard(client, playerId, business.id, period).catch(() => null),
    getBusinessesWithBalances(client, playerId).catch(() => []),
  ]);

  return {
    business,
    production,
    manufacturing,
    inventory,
    shelfItems,
    upgrades,
    upgradeProjects,
    employees: employeesRes.data ?? [],
    financeDashboard,
    ownedBusinesses,
    upgradeDefinitions,
  };
}
