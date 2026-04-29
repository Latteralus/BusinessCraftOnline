import { type FinancePeriod } from "@/config/finance";
import {
  getBusinessById,
  getBusinessFinanceDashboard,
  getBusinessUpgradeProjects,
  getBusinessUpgrades,
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

export type BusinessDetailsSection =
  | "overview"
  | "finance"
  | "operations"
  | "employees"
  | "inventory"
  | "upgrades"
  | "options";

export type BusinessDetailsPatch = Partial<BusinessDetailsEntry>;

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
    isExtraction ? getProductionStatus(client, playerId, business.id).catch(() => null) : Promise.resolve(null),
    isManufacturing ? getManufacturingStatus(client, playerId, business.id).catch(() => null) : Promise.resolve(null),
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
      financeDashboard: await getBusinessFinanceDashboard(client, playerId, business.id, period).catch(() => null),
    };
  }

  if (section === "operations") {
    const [production, manufacturing, inventory, shelfItems, employeesRes] = await Promise.all([
      isExtraction ? getProductionStatus(client, playerId, business.id).catch(() => null) : Promise.resolve(null),
      isManufacturing ? getManufacturingStatus(client, playerId, business.id).catch(() => null) : Promise.resolve(null),
      getBusinessInventory(client, playerId, business.id).catch(() => []),
      getStoreShelfItems(client, playerId, { businessId: business.id }).catch(() => []),
      client
        .from("employees")
        .select("*, employee_assignments(*, business:businesses(*))")
        .eq("player_id", playerId)
        .eq("employer_business_id", business.id)
        .order("created_at", { ascending: false }),
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
    const employeesRes = await client
      .from("employees")
      .select("*, employee_assignments(*, business:businesses(*))")
      .eq("player_id", playerId)
      .eq("employer_business_id", business.id)
      .order("created_at", { ascending: false });

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

    return {
      business,
      inventory,
      shelfItems,
      ownedBusinesses,
    };
  }

  if (section === "upgrades") {
    const [upgrades, upgradeProjects, upgradeDefinitions] = await Promise.all([
      getBusinessUpgrades(client, playerId, business.id).catch(() => []),
      getBusinessUpgradeProjects(client, playerId, business.id).catch(() => []),
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
    isExtraction ? getProductionStatus(client, playerId, business.id).catch(() => null) : Promise.resolve(null),
    isManufacturing ? getManufacturingStatus(client, playerId, business.id).catch(() => null) : Promise.resolve(null),
    getBusinessInventory(client, playerId, business.id).catch(() => []),
    getStoreShelfItems(client, playerId, { businessId: business.id }).catch(() => []),
    getBusinessUpgrades(client, playerId, business.id).catch(() => []),
    client
      .from("employees")
      .select("*, employee_assignments(*, business:businesses(*))")
      .eq("player_id", playerId)
      .eq("employer_business_id", business.id)
      .order("created_at", { ascending: false }),
    getBusinessFinanceDashboard(client, playerId, business.id, period).catch(() => null),
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
  };
}
