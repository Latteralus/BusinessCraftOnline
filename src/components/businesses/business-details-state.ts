import type {
  Business,
  BusinessFinanceDashboard,
  BusinessUpgrade,
  BusinessUpgradeProject,
} from "@/domains/businesses";
import type { Employee, EmployeeAssignment } from "@/domains/employees";
import type { BusinessInventoryItem } from "@/domains/inventory";
import { summarizeManufacturingLines, summarizeProductionSlots, type ManufacturingStatusView, type ProductionStatus } from "@/domains/production";
import type { StoreShelfItem } from "@/domains/stores";
import type { UpgradeDefinition } from "@/domains/upgrades";
import type { BusinessDetailsEmployee, BusinessDetailsEntry } from "@/stores/game-store";
import { shouldSyncHydratedEntry, resolveHydratedEntry } from "@/stores/hydrated-slice";

export type BusinessDetailsClientProps = {
  business: Business;
  production: ProductionStatus | null;
  manufacturing: ManufacturingStatusView | null;
  inventory: BusinessInventoryItem[];
  shelfItems: StoreShelfItem[];
  upgrades: BusinessUpgrade[];
  upgradeProjects: BusinessUpgradeProject[];
  employees: (Employee & { employee_assignments?: (EmployeeAssignment & { business: Business })[] })[];
  upgradeDefinitions?: UpgradeDefinition[];
  financeDashboard?: BusinessFinanceDashboard | null;
  ownedBusinesses?: Array<Pick<Business, "id" | "name" | "city_id">>;
  initialTab?: string;
  inventoryAssetValue?: number;
};

export type LocalEmployee = Employee & {
  employee_assignments?: (EmployeeAssignment & { business: Business })[] | null;
};

// BusinessDetailsEmployee (src/stores/game-store.ts) types employee_assignments
// loosely (Record<string, unknown>[]) because it round-trips through the
// store's JSON-hydrated businessDetails slice. At runtime it's always shaped
// like EmployeeAssignment & { business: Business } — the same data the server
// loader and API routes produce — so this is one documented cast instead of
// an `as any` at every call site that reads from the store.
export function toBusinessDetailsClientEmployees(
  employees: BusinessDetailsEmployee[]
): BusinessDetailsClientProps["employees"] {
  return employees as unknown as BusinessDetailsClientProps["employees"];
}

export function normalizeManufacturingLine(
  line: NonNullable<ManufacturingStatusView["lines"]>[number],
  existing?: NonNullable<ManufacturingStatusView["lines"]>[number]
) {
  return {
    ...existing,
    ...line,
    available_recipes: Array.isArray(line.available_recipes)
      ? line.available_recipes
      : existing?.available_recipes ?? [],
    configured_recipe: line.configured_recipe
      ? {
          ...line.configured_recipe,
          inputs: Array.isArray(line.configured_recipe.inputs) ? line.configured_recipe.inputs : [],
        }
      : line.configured_recipe === null
        ? null
        : existing?.configured_recipe ?? null,
    pending_recipe: line.pending_recipe
      ? {
          ...line.pending_recipe,
          inputs: Array.isArray(line.pending_recipe.inputs) ? line.pending_recipe.inputs : [],
        }
      : line.pending_recipe === null
        ? null
        : existing?.pending_recipe ?? null,
  };
}

export function normalizeManufacturingStatus(
  manufacturing: ManufacturingStatusView | null | undefined
): ManufacturingStatusView | null {
  if (!manufacturing) return null;

  const lines = Array.isArray(manufacturing.lines)
    ? manufacturing.lines.map((line) => normalizeManufacturingLine(line))
    : [];

  return {
    ...manufacturing,
    lines,
    summary: summarizeManufacturingLines(lines),
  };
}

export function normalizeProductionStatus(
  production: ProductionStatus | null | undefined
): ProductionStatus | null {
  if (!production) return null;
  const slots = Array.isArray(production.slots) ? production.slots : [];

  return {
    ...production,
    slots,
    summary: summarizeProductionSlots(slots),
  };
}

export function createBusinessDetailsEntry(input: BusinessDetailsClientProps): BusinessDetailsEntry {
  return {
    business: input.business,
    production: input.production,
    manufacturing: input.manufacturing,
    inventory: input.inventory,
    shelfItems: input.shelfItems,
    upgrades: input.upgrades,
    upgradeProjects: input.upgradeProjects,
    employees: input.employees,
    financeDashboard: input.financeDashboard ?? null,
    ownedBusinesses: input.ownedBusinesses ?? [],
    upgradeDefinitions: input.upgradeDefinitions ?? [],
    inventoryAssetValue: input.inventoryAssetValue ?? 0,
  };
}

export function shouldSyncBusinessDetailsEntry(
  current: BusinessDetailsEntry | null | undefined,
  incoming: BusinessDetailsEntry
) {
  return shouldSyncHydratedEntry({
    current,
    incoming,
    getVersion: (value) => `${value.business.updated_at}:${value.financeDashboard?.generatedAt ?? "none"}`,
    getArraySizes: [
      (value) => value.inventory,
      (value) => value.shelfItems,
      (value) => value.upgrades,
      (value) => value.upgradeProjects,
      (value) => value.employees,
      (value) => value.ownedBusinesses,
      (value) => value.upgradeDefinitions,
    ],
    getContentSignatures: [
      (value) => value.business,
      (value) => value.production,
      (value) => value.manufacturing,
      (value) => value.inventory,
      (value) => value.shelfItems,
      (value) => value.upgrades,
      (value) => value.upgradeProjects,
      (value) => value.employees,
      (value) => value.financeDashboard,
      (value) => value.ownedBusinesses,
      (value) => value.upgradeDefinitions,
      (value) => value.inventoryAssetValue,
    ],
  });
}

export function resolveBusinessDetailsView(
  detail: BusinessDetailsEntry | null | undefined,
  initial: BusinessDetailsEntry
) {
  return {
    business: resolveHydratedEntry(detail?.business, initial.business),
    production: normalizeProductionStatus(resolveHydratedEntry(detail?.production, initial.production)),
    manufacturing: normalizeManufacturingStatus(resolveHydratedEntry(detail?.manufacturing, initial.manufacturing)),
    inventory: Array.isArray(detail?.inventory) ? detail.inventory : initial.inventory,
    shelfItems: Array.isArray(detail?.shelfItems) ? detail.shelfItems : initial.shelfItems,
    upgrades: Array.isArray(detail?.upgrades) ? detail.upgrades : initial.upgrades,
    upgradeProjects: Array.isArray(detail?.upgradeProjects) ? detail.upgradeProjects : initial.upgradeProjects,
    employees: Array.isArray(detail?.employees) ? (detail.employees as LocalEmployee[]) : (initial.employees as LocalEmployee[]),
    ownedBusinesses: Array.isArray(detail?.ownedBusinesses) ? detail.ownedBusinesses : initial.ownedBusinesses,
    financeDashboard: detail?.financeDashboard ?? initial.financeDashboard ?? null,
    upgradeDefinitions: detail?.upgradeDefinitions ?? initial.upgradeDefinitions,
    inventoryAssetValue: detail?.inventoryAssetValue ?? initial.inventoryAssetValue,
  };
}
