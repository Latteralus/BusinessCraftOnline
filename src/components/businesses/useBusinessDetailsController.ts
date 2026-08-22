import { useEffect, useMemo } from "react";
import type { Business, BusinessFinanceDashboard, BusinessUpgrade, BusinessUpgradeProject } from "@/domains/businesses";
import type { FinancePeriod } from "@/config/finance";
import type { Employee } from "@/domains/employees";
import type { BusinessInventoryItem } from "@/domains/inventory";
import { summarizeManufacturingLines, summarizeProductionSlots, type ManufacturingStatusView, type ProductionStatus } from "@/domains/production";
import type { StoreShelfItem } from "@/domains/stores";
import { fetchBusinessDetailsSection } from "@/lib/client/queries";
import { useGameStore } from "@/stores/game-store";
import { SLICE_KEYS, runGuardedSliceFetch } from "@/stores/slice-fetch-guard";
import {
  createBusinessDetailsEntry,
  resolveBusinessDetailsView,
  shouldSyncBusinessDetailsEntry,
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
  inventoryAssetValue: number;
}>;

export function useBusinessDetailsController(input: BusinessDetailsClientProps) {
  const businessId = input.business.id;
  const detail = useGameStore((state) => state.businessDetails.data[businessId]);
  const upsertBusinessDetail = useGameStore((state) => state.upsertBusinessDetail);
  const patchBusinessDetail = useGameStore((state) => state.patchBusinessDetail);
  const initialEntry = useMemo(
    () => createBusinessDetailsEntry(input),
    [
      input.business,
      input.production,
      input.manufacturing,
      input.inventory,
      input.shelfItems,
      input.upgrades,
      input.upgradeProjects,
      input.employees,
      input.financeDashboard,
      input.ownedBusinesses,
      input.upgradeDefinitions,
      input.inventoryAssetValue,
    ]
  );

  useEffect(() => {
    const currentDetail = useGameStore.getState().businessDetails.data[businessId];
    if (!currentDetail) {
      upsertBusinessDetail(businessId, initialEntry);
      return;
    }

    if (shouldSyncBusinessDetailsEntry(currentDetail, initialEntry)) {
      patchBusinessDetail(businessId, {
        business: initialEntry.business,
        ownedBusinesses: initialEntry.ownedBusinesses,
      });
    }
  }, [businessId, initialEntry, patchBusinessDetail, upsertBusinessDetail]);

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
      inventoryAssetValue: currentDetail?.inventoryAssetValue ?? view.inventoryAssetValue,
      ...value,
    });
  }

  async function refreshFinanceDashboard(
    period: FinancePeriod = view.financeDashboard?.currentPeriod ?? "1h"
  ) {
    let finance: BusinessFinanceDashboard | null = null;
    // A dedicated key, not SLICE_KEYS.businessDetail(businessId) itself: that
    // key's in-flight-sharing optimization assumes every caller fetches the
    // same shape, but realtime's full-detail refresh re-fetches whatever
    // period was current *before* this switch (see realtime-provider.tsx's
    // refreshBusinessDetail). Sharing its key would make a period switch
    // that lands while that refresh is in flight silently piggyback on it
    // and never fetch the newly requested period at all. This still doesn't
    // fully order against that refresh landing afterward with the stale
    // period it captured -- a real but narrow residual race, left as-is
    // rather than restructuring how realtime captures period context.
    await runGuardedSliceFetch(
      `${SLICE_KEYS.businessDetail(businessId)}:finance`,
      () => fetchBusinessDetailsSection(businessId, "finance", period),
      (patch) => {
        finance = patch.financeDashboard ?? null;
        patchDetail({ financeDashboard: finance });
      }
    );
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

  function removeEmployeeRecord(employeeId: string) {
    patchDetail({ employees: view.employees.filter((employee) => employee.id !== employeeId) });
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
    removeEmployeeRecord,
    updateExtractionSlot,
    updateManufacturingLine,
    patchInventoryItem,
    adjustInventoryByKey,
    upsertShelfItem,
    removeShelfItemFromDetail,
  };
}
