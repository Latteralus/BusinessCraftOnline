import { useEffect } from "react";
import type { Business, BusinessFinanceDashboard, BusinessUpgrade, BusinessUpgradeProject } from "@/domains/businesses";
import type { FinancePeriod } from "@/config/finance";
import { getBusinessFinanceDashboard as buildBusinessFinanceDashboard } from "@/domains/businesses/finance";
import type { Employee } from "@/domains/employees";
import type { BusinessInventoryItem } from "@/domains/inventory";
import type { ManufacturingStatusView, ProductionStatus } from "@/domains/production";
import { summarizeManufacturingLines } from "@/domains/production/view";
import type { StoreShelfItem } from "@/domains/stores";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { useGameStore } from "@/stores/game-store";
import {
  createBusinessDetailsEntry,
  resolveBusinessDetailsView,
  shouldSyncBusinessDetailsEntry,
  summarizeProductionSlots,
  normalizeManufacturingLine,
  type BusinessDetailsClientProps,
  type LocalEmployee,
} from "./business-details-state";

type PatchableBusinessDetail = Partial<{
  business: Business;
  production: ProductionStatus | null;
  manufacturing: ManufacturingStatusView | null;
  inventory: BusinessInventoryItem[];
  shelfItems: StoreShelfItem[];
  upgrades: BusinessUpgrade[];
  upgradeProjects: BusinessUpgradeProject[];
  employees: LocalEmployee[];
  financeDashboard: BusinessFinanceDashboard | null;
}>;

export function useBusinessDetailsController(input: BusinessDetailsClientProps) {
  const businessId = input.business.id;
  const detail = useGameStore((state) => state.businessDetails.data[businessId]);
  const upsertBusinessDetail = useGameStore((state) => state.upsertBusinessDetail);
  const initialEntry = createBusinessDetailsEntry(input);

  useEffect(() => {
    const currentDetail = useGameStore.getState().businessDetails.data[businessId];
    if (shouldSyncBusinessDetailsEntry(currentDetail, initialEntry)) {
      upsertBusinessDetail(businessId, initialEntry);
    }
  }, [businessId, initialEntry, upsertBusinessDetail]);

  const view = resolveBusinessDetailsView(detail, initialEntry);

  function patchDetail(value: PatchableBusinessDetail) {
    const currentDetail = useGameStore.getState().businessDetails.data[businessId];
    upsertBusinessDetail(businessId, {
      business: currentDetail?.business ?? view.business,
      production: currentDetail?.production ?? view.production,
      manufacturing: currentDetail?.manufacturing ?? view.manufacturing,
      inventory: currentDetail?.inventory ?? view.inventory,
      shelfItems: currentDetail?.shelfItems ?? view.shelfItems,
      upgrades: currentDetail?.upgrades ?? view.upgrades,
      upgradeProjects: currentDetail?.upgradeProjects ?? view.upgradeProjects,
      employees: (currentDetail?.employees as LocalEmployee[] | undefined) ?? view.employees,
      financeDashboard: currentDetail?.financeDashboard ?? view.financeDashboard,
      ownedBusinesses: currentDetail?.ownedBusinesses ?? view.ownedBusinesses,
      upgradeDefinitions: currentDetail?.upgradeDefinitions ?? view.upgradeDefinitions,
      ...value,
    });
  }

  async function refreshFinanceDashboard(period: FinancePeriod = "1h") {
    const finance = await buildBusinessFinanceDashboard(
      createSupabaseBrowserClient(),
      view.business.player_id,
      view.business,
      period
    );
    patchDetail({ financeDashboard: finance });
    return finance;
  }

  function updateEmployeeRecord(nextEmployee: LocalEmployee) {
    const index = view.employees.findIndex((employee) => employee.id === nextEmployee.id);
    if (index === -1) {
      patchDetail({ employees: [nextEmployee, ...view.employees] });
      return;
    }

    const next = view.employees.slice();
    next[index] = {
      ...next[index],
      ...nextEmployee,
    };
    patchDetail({ employees: next });
  }

  function updateExtractionSlot(slot: ProductionStatus["slots"][number]) {
    if (!view.production) return;
    const slots = view.production.slots.map((entry) => (entry.id === slot.id ? slot : entry));
    patchDetail({
      production: {
        ...view.production,
        slots,
        summary: summarizeProductionSlots(slots),
      },
    });
  }

  function updateManufacturingLine(line: ManufacturingStatusView["lines"][number]) {
    if (!view.manufacturing) return;
    const lines = view.manufacturing.lines.map((entry) =>
      entry.id === line.id ? normalizeManufacturingLine(line, entry) : entry
    );
    patchDetail({
      manufacturing: {
        ...view.manufacturing,
        lines,
        summary: summarizeManufacturingLines(lines),
      },
    });
  }

  function patchInventoryItem(itemId: string, patch: Partial<BusinessInventoryItem>) {
    patchDetail({
      inventory: view.inventory
        .map((item) => (item.id === itemId ? { ...item, ...patch } : item))
        .filter((item) => item.quantity > 0 || item.reserved_quantity > 0),
    });
  }

  function adjustInventoryByKey(itemKey: string, quality: number, patch: (item: BusinessInventoryItem) => BusinessInventoryItem) {
    patchDetail({
      inventory: view.inventory.map((item) => (item.item_key === itemKey && item.quality === quality ? patch(item) : item)),
    });
  }

  function upsertShelfItem(nextShelfItem: StoreShelfItem) {
    const index = view.shelfItems.findIndex((item) => item.id === nextShelfItem.id);
    if (index === -1) {
      patchDetail({ shelfItems: [nextShelfItem, ...view.shelfItems] });
      return;
    }
    const next = view.shelfItems.slice();
    next[index] = nextShelfItem;
    patchDetail({ shelfItems: next });
  }

  function removeShelfItemFromDetail(shelfItemId: string) {
    patchDetail({ shelfItems: view.shelfItems.filter((item) => item.id !== shelfItemId) });
  }

  return {
    detail,
    ...view,
    patchDetail,
    refreshFinanceDashboard,
    updateEmployeeRecord,
    updateExtractionSlot,
    updateManufacturingLine,
    patchInventoryItem,
    adjustInventoryByKey,
    upsertShelfItem,
    removeShelfItemFromDetail,
  };
}
