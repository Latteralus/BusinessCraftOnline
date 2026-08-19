import { type FinancePeriod } from "@/config/finance";
import {
  computeInventoryAssetValue,
  getBusinessById,
  getBusinessFinanceDashboardForBusiness,
  getBusinessUpgradeProjectsById,
  getBusinessUpgradesById,
  getBusinessesWithBalances,
  supportsExtraction,
  supportsManufacturing,
} from "@/domains/businesses";
import { getBusinessInventory } from "@/domains/inventory";
import { getManufacturingStatus, getProductionStatus } from "@/domains/production";
import { getStoreShelfItems } from "@/domains/stores";
import { getUpgradeDefinitionsForBusinessType, type BusinessType } from "@/domains/upgrades";
import type { QueryClient } from "@/lib/db/query-client";
import type { BusinessDetailsEntry } from "@/stores/game-store";

// getProductionStatus/getManufacturingStatus are swallowed to null below so a
// broken operations status never blanks out the rest of the business detail
// page. Logging here is the only trace of *why* -- without it, a real bug
// (vs. normal transient failure) is indistinguishable from the UI's generic
// "Operations Data Unavailable" state.
function logProductionStatusError(source: string, businessId: string, error: unknown): null {
  console.error(`[business-details] ${source} failed for business ${businessId}:`, error);
  return null;
}

export type BusinessDetailsSection =
  | "overview"
  | "finance"
  | "operations"
  | "employees"
  | "inventory"
  | "upgrades"
  | "options";

export type BusinessDetailsPatch = Partial<BusinessDetailsEntry>;

// Supabase's query builder only implements `.then()` (PromiseLike), not
// `.catch()`/`.finally()` -- chaining `.catch()` straight onto a builder
// throws "catch is not a function" at runtime (TypeScript doesn't catch this
// because QueryClient.from() is typed `any`). Centralizing this fetch behind
// a real `await`/try-catch also removes 4 copies of the same query.
async function fetchBusinessEmployees(client: QueryClient, playerId: string, businessId: string) {
  try {
    return await client
      .from("employees")
      .select("*, employee_assignments(*, business:businesses(*))")
      .eq("player_id", playerId)
      .eq("employer_business_id", businessId)
      .order("created_at", { ascending: false });
  } catch {
    return { data: [], error: null };
  }
}

export function createBusinessDetailsShell(input: {
  business: BusinessDetailsEntry["business"];
  ownedBusinesses: BusinessDetailsEntry["ownedBusinesses"];
}): BusinessDetailsEntry {
  return {
    business: input.business,
    production: null,
    manufacturing: null,
    inventory: [],
    shelfItems: [],
    upgrades: [],
    upgradeProjects: [],
    employees: [],
    financeDashboard: null,
    ownedBusinesses: input.ownedBusinesses,
    upgradeDefinitions: [],
    inventoryAssetValue: 0,
  };
}

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
  const isManufacturing = supportsManufacturing(business.type);
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
    isExtraction
      ? getProductionStatus(client, playerId, business.id).catch((error) => logProductionStatusError("getProductionStatus", business.id, error))
      : Promise.resolve(null),
    isManufacturing
      ? getManufacturingStatus(client, playerId, business.id).catch((error) => logProductionStatusError("getManufacturingStatus", business.id, error))
      : Promise.resolve(null),
    getBusinessInventory(client, playerId, business.id).catch(() => []),
    getStoreShelfItems(client, playerId, { businessId: business.id }).catch(() => []),
    getBusinessUpgradesById(client, business.id).catch(() => []),
    getBusinessUpgradeProjectsById(client, business.id).catch(() => []),
    fetchBusinessEmployees(client, playerId, business.id),
    getUpgradeDefinitionsForBusinessType(client, business.type as BusinessType).catch(() => []),
    getBusinessFinanceDashboardForBusiness(client, playerId, business, period).catch(() => null),
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
    inventoryAssetValue: financeDashboard?.balanceSheet.find((row) => row.label === "Inventory")?.amount ?? 0,
  };
}

export async function loadBusinessDetailsSection(
  client: QueryClient,
  playerId: string,
  businessId: string,
  section: BusinessDetailsSection,
  period: FinancePeriod = "1h"
): Promise<BusinessDetailsPatch | null> {
  const business = await getBusinessById(client, playerId, businessId).catch(() => null);
  if (!business) {
    return null;
  }

  const isExtraction = supportsExtraction(business.type);
  const isManufacturing = supportsManufacturing(business.type);

  if (section === "finance") {
    return {
      business,
      financeDashboard: await getBusinessFinanceDashboardForBusiness(client, playerId, business, period).catch(() => null),
    };
  }

  if (section === "operations") {
    const [production, manufacturing, inventory, shelfItems, employeesRes] = await Promise.all([
      isExtraction
        ? getProductionStatus(client, playerId, business.id).catch((error) => logProductionStatusError("getProductionStatus", business.id, error))
        : Promise.resolve(null),
      isManufacturing
        ? getManufacturingStatus(client, playerId, business.id).catch((error) => logProductionStatusError("getManufacturingStatus", business.id, error))
        : Promise.resolve(null),
      getBusinessInventory(client, playerId, business.id).catch(() => []),
      getStoreShelfItems(client, playerId, { businessId: business.id }).catch(() => []),
      fetchBusinessEmployees(client, playerId, business.id),
    ]);

    return {
      business,
      production,
      manufacturing,
      inventory,
      shelfItems,
      employees: employeesRes.data ?? [],
    };
  }

  if (section === "employees") {
    const employeesRes = await fetchBusinessEmployees(client, playerId, business.id);

    return {
      business,
      employees: employeesRes.data ?? [],
    };
  }

  if (section === "inventory") {
    const [inventory, shelfItems, ownedBusinesses] = await Promise.all([
      getBusinessInventory(client, playerId, business.id).catch(() => []),
      getStoreShelfItems(client, playerId, { businessId: business.id }).catch(() => []),
      getBusinessesWithBalances(client, playerId).catch(() => []),
    ]);
    const { inventoryAssetValue } = await computeInventoryAssetValue(client, inventory).catch(() => ({
      inventoryAssetValue: 0,
    }));

    return {
      business,
      inventory,
      shelfItems,
      ownedBusinesses,
      inventoryAssetValue,
    };
  }

  if (section === "upgrades") {
    const [upgrades, upgradeProjects, upgradeDefinitions] = await Promise.all([
      getBusinessUpgradesById(client, business.id).catch(() => []),
      getBusinessUpgradeProjectsById(client, business.id).catch(() => []),
      getUpgradeDefinitionsForBusinessType(client, business.type as BusinessType).catch(() => []),
    ]);

    return {
      business,
      upgrades,
      upgradeProjects,
      upgradeDefinitions,
    };
  }

  if (section === "options") {
    return { business };
  }

  const [production, manufacturing, inventory, shelfItems, upgrades, employeesRes, financeDashboard] = await Promise.all([
    isExtraction
      ? getProductionStatus(client, playerId, business.id).catch((error) => logProductionStatusError("getProductionStatus", business.id, error))
      : Promise.resolve(null),
    isManufacturing
      ? getManufacturingStatus(client, playerId, business.id).catch((error) => logProductionStatusError("getManufacturingStatus", business.id, error))
      : Promise.resolve(null),
    getBusinessInventory(client, playerId, business.id).catch(() => []),
    getStoreShelfItems(client, playerId, { businessId: business.id }).catch(() => []),
    getBusinessUpgradesById(client, business.id).catch(() => []),
    fetchBusinessEmployees(client, playerId, business.id),
    getBusinessFinanceDashboardForBusiness(client, playerId, business, period).catch(() => null),
  ]);

  return {
    business,
    production,
    manufacturing,
    inventory,
    shelfItems,
    upgrades,
    employees: employeesRes.data ?? [],
    financeDashboard,
    inventoryAssetValue: financeDashboard?.balanceSheet.find((row) => row.label === "Inventory")?.amount ?? 0,
  };
}
