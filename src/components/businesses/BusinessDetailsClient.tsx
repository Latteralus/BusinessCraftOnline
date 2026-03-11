"use client";

import { getExtractionProductOptionsForBusinessType } from "@/config/production";
import { type FinancePeriod } from "@/config/finance";
import { useState, useEffect, Fragment } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supportsStorefront, type Business, type BusinessUpgradeProject } from "@/domains/businesses";
import type { Employee, EmployeeAssignment } from "@/domains/employees";
import type { BusinessInventoryItem } from "@/domains/inventory";
import type { ManufacturingStatusView, ProductionStatus } from "@/domains/production";
import type { StoreShelfItem } from "@/domains/stores";
import { getWorkerEffectiveStatus } from "@/domains/employees/worker-state";
import { calculateUpgradePreview, formatInstallTimeMinutes } from "@/domains/upgrades";
import { BASE_WAGE_PER_HOUR } from "@/config/employees";
import { apiDelete, apiPatch, apiPost } from "@/lib/client/api";
import { apiRoutes } from "@/lib/client/routes";
import { getNpcBuyerPriceRange, getNpcSuggestedBasePrice } from "@/config/items";
import { formatCurrency, formatEmployeeType, formatLabel } from "@/lib/formatters";
import { formatItemKey } from "@/lib/items";
import { runOptimisticUpdate } from "@/stores/optimistic";
import { makeNpcShopperName } from "../../../shared/core/npc-shopper-names";
import BusinessEmployeesDashboard from "./BusinessEmployeesDashboard";
import BusinessFinanceDashboardPanel from "./BusinessFinanceDashboard";
import BusinessInventoryDashboard from "./BusinessInventoryDashboard";
import BusinessOptionsPanel from "./BusinessOptionsPanel";
import BusinessOverviewDashboard from "./BusinessOverviewDashboard";
import BusinessOperationsDashboard from "./BusinessOperationsDashboard";
import {
  type BusinessDetailsClientProps as Props,
  type LocalEmployee,
} from "./business-details-state";
import { useBusinessDetailsController } from "./useBusinessDetailsController";

type TabType = "overview" | "finance" | "operations" | "employees" | "inventory" | "upgrades" | "options";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function makeHireName() {
  const fullName = makeNpcShopperName(Math.random);
  const [firstName, ...rest] = fullName.split(" ");

  return {
    firstName: firstName ?? "Alex",
    lastName: rest.join(" ") || "Smith",
  };
}

export default function BusinessDetailsClient({
  business: initialBusiness,
  production: initialProduction,
  manufacturing: initialManufacturing,
  inventory: initialInventory,
  shelfItems: initialShelfItems,
  upgrades: initialUpgrades,
  upgradeProjects: initialUpgradeProjects,
  employees: initialEmployees,
  upgradeDefinitions = [],
  financeDashboard,
  ownedBusinesses = [],
  initialTab,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tempPayPer15Min = formatCurrency(BASE_WAGE_PER_HOUR.temp / 4);
  const partTimePayPer15Min = formatCurrency(BASE_WAGE_PER_HOUR.part_time / 4);
  const fullTimePayPer15Min = formatCurrency(BASE_WAGE_PER_HOUR.full_time / 4);
  const businessId = initialBusiness.id;
  
  const defaultTab = (initialTab as TabType) || "overview";
  const [activeTab, setActiveTab] = useState<TabType>(defaultTab);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignSelections, setAssignSelections] = useState<Record<string, string>>({});
  const [slotRetoolSelections, setSlotRetoolSelections] = useState<Record<string, string>>({});
  const [manufacturingAssignSelections, setManufacturingAssignSelections] = useState<Record<string, string>>({});
  const [manufacturingRetoolSelections, setManufacturingRetoolSelections] = useState<Record<string, string>>({});
  const [marketActionItem, setMarketActionItem] = useState<{ id: string; type: "market" | "personal_transfer" | "business_transfer"; available: number } | null>(null);
  const [actionQuantity, setActionQuantity] = useState(1);
  const [actionPrice, setActionPrice] = useState(1);
  const [transferBusinessId, setTransferBusinessId] = useState("");
  const [transferUnitPrice, setTransferUnitPrice] = useState(1);
  const [shelfActionItem, setShelfActionItem] = useState<{ itemKey: string; quality: number; maxQuantity: number } | null>(null);
  const [shelfQuantity, setShelfQuantity] = useState(1);
  const [shelfPrice, setShelfPrice] = useState(1);
  const {
    business,
    production,
    manufacturing,
    inventory,
    shelfItems,
    upgrades,
    upgradeProjects,
    employees,
    ownedBusinesses: ownedBusinessesState,
    financeDashboard: financeDashboardState,
    upgradeDefinitions: upgradeDefinitionsState,
    patchDetail,
    refreshFinanceDashboard,
    updateEmployeeRecord,
    updateExtractionSlot,
    updateManufacturingLine,
    patchInventoryItem,
    adjustInventoryByKey,
    upsertShelfItem,
    removeShelfItemFromDetail,
  } = useBusinessDetailsController({
    business: initialBusiness,
    production: initialProduction,
    manufacturing: initialManufacturing,
    inventory: initialInventory,
    shelfItems: initialShelfItems,
    upgrades: initialUpgrades,
    upgradeProjects: initialUpgradeProjects,
    employees: initialEmployees,
    upgradeDefinitions,
    financeDashboard,
    ownedBusinesses,
    initialTab,
  });
  const selectedFinancePeriod = (() => {
    const period = searchParams.get("period");
    return period === "24h" || period === "7d" || period === "30d" ? period : "1h";
  })() as FinancePeriod;

  useEffect(() => {
    if (initialTab && ["overview", "finance", "operations", "employees", "inventory", "upgrades", "options"].includes(initialTab)) {
      setActiveTab(initialTab as TabType);
    }
  }, [initialTab]);

  useEffect(() => {
    if (!financeDashboardState) return;
    if (financeDashboardState.currentPeriod === selectedFinancePeriod) return;
    void refreshFinanceDashboard(selectedFinancePeriod).catch(() => null);
  }, [financeDashboardState, refreshFinanceDashboard, selectedFinancePeriod]);

  const getAssignments = (
    employee: Employee & {
      employee_assignments?: (EmployeeAssignment & { business: Business })[] | (EmployeeAssignment & { business: Business }) | null;
    }
  ): (EmployeeAssignment & { business: Business })[] => {
    const raw = employee.employee_assignments;
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === "object") return [raw];
    return [];
  };

  const getAssignmentForBusiness = (
    employee: Employee & {
      employee_assignments?: (EmployeeAssignment & { business: Business })[] | (EmployeeAssignment & { business: Business }) | null;
    }
  ) => getAssignments(employee).find((assignment) => assignment.business_id === business.id);

  // Employees tied to this business either by active assignment row or employer business ownership.
  const thisBusinessEmployees = employees.filter(
    (employee) =>
      Boolean(getAssignmentForBusiness(employee)) || employee.employer_business_id === business.id
  );
  const availableEmployees = thisBusinessEmployees.filter((employee) => {
    const effectiveStatus = getWorkerEffectiveStatus(employee.status, employee.shift_ends_at);
    return !getAssignmentForBusiness(employee) && effectiveStatus === "available";
  });
  const isStoreBusiness = supportsStorefront(business.type);
  const transferBusinesses = ownedBusinessesState.filter((row) => row.id !== business.id);
  const shelfKey = (itemKey: string, quality: number) => `${itemKey}:${quality}`;
  const activeShelfItems = shelfItems.filter((item) => item.quantity > 0);
  const shelfByInventoryKey = Object.fromEntries(activeShelfItems.map((item) => [shelfKey(item.item_key, item.quality), item]));
  const activeUpgradeProject =
    upgradeProjects.find((project) => project.project_status === "installing") ?? null;
  const totalShelfUnits = activeShelfItems.reduce((sum, item) => sum + item.quantity, 0);
  const totalBackroomUnits = inventory.reduce((sum, item) => sum + Math.max(0, item.quantity - item.reserved_quantity), 0);
  const shelfFillRatio = totalShelfUnits + totalBackroomUnits > 0 ? totalShelfUnits / (totalShelfUnits + totalBackroomUnits) : 0;
  const shelfFlowRatio = totalShelfUnits > 0 ? totalBackroomUnits / Math.max(1, totalShelfUnits) : 0;
  const availableWorkersForSlots = thisBusinessEmployees
    .filter((employee) => {
      const assignment = getAssignmentForBusiness(employee);
      const effectiveStatus = getWorkerEffectiveStatus(employee.status, employee.shift_ends_at);
      return (
        assignment?.role === "production" &&
        effectiveStatus === "assigned" &&
        !production?.slots?.some((slot) => slot.employee_id === employee.id)
      );
    });
  const availableWorkersForManufacturing = thisBusinessEmployees.filter((employee) => {
    const assignment = getAssignmentForBusiness(employee);
    const effectiveStatus = getWorkerEffectiveStatus(employee.status, employee.shift_ends_at);
    const isOnExtractionSlot = production?.slots?.some((slot) => slot.employee_id === employee.id) ?? false;
    const isOnManufacturingLine = manufacturing?.lines?.some((line) => line.employee_id === employee.id) ?? false;

    if (assignment?.role === "production") {
      return effectiveStatus === "assigned" && !isOnExtractionSlot && !isOnManufacturingLine;
    }

    return effectiveStatus === "available" && !assignment;
  });
  const employeesForView = employees.map((employee) => ({
    ...employee,
    employee_assignments: employee.employee_assignments ?? undefined,
  }));

  async function runBusyAction(action: () => Promise<void>, fallbackMessage: string) {
    if (busy) return;

    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallbackMessage);
    } finally {
      setBusy(false);
    }
  }

  async function assignSlot(slotId: string) {
    const employeeId = assignSelections[slotId];
    if (!employeeId || busy) return;

    await runBusyAction(async () => {
      const currentSlot = production?.slots.find((slot) => slot.id === slotId) ?? null;
      const currentEmployee = employees.find((employee) => employee.id === employeeId) ?? null;
      const previousSelection = assignSelections[slotId] ?? "";
      await runOptimisticUpdate("businessDetails", () => {
        if (currentSlot) {
          updateExtractionSlot({
            ...currentSlot,
            employee_id: employeeId,
            employee_status: currentEmployee
              ? getWorkerEffectiveStatus(currentEmployee.status, currentEmployee.shift_ends_at)
              : "assigned",
            status: currentSlot.status === "retooling" ? "retooling" : "active",
          });
        }
        setAssignSelections((prev) => {
          const next = { ...prev };
          delete next[slotId];
          return next;
        });
        return () => {
          setAssignSelections((prev) => ({ ...prev, [slotId]: previousSelection }));
        };
      }, async () => {
        const payload = await apiPost<{ slot: ProductionStatus["slots"][number] }>(
          apiRoutes.production.assignSlot,
          { slotId, employeeId },
          { fallbackError: "Failed to assign employee to slot." }
        );
        if (payload.slot) {
          updateExtractionSlot(payload.slot);
        }
        return payload;
      });
    }, "Error assigning slot");
  }

  async function unassignSlot(slotId: string) {
    if (busy) return;
    await runBusyAction(async () => {
      const currentSlot = production?.slots.find((slot) => slot.id === slotId) ?? null;
      await runOptimisticUpdate("businessDetails", () => {
        if (currentSlot) {
          updateExtractionSlot({
            ...currentSlot,
            employee_id: null,
            employee_status: null,
            status: currentSlot.status === "retooling" ? "retooling" : "idle",
          });
        }
      }, async () => {
        const payload = await apiPost<{ slot: ProductionStatus["slots"][number] }>(
          apiRoutes.production.unassignSlot,
          { slotId },
          { fallbackError: "Failed to unassign slot." }
        );
        if (payload.slot) {
          updateExtractionSlot(payload.slot);
        }
        return payload;
      });
    }, "Error unassigning slot");
  }

  async function setSlotStatus(slotId: string, status: "active" | "idle") {
    if (busy) return;
    await runBusyAction(async () => {
      const currentSlot = production?.slots.find((slot) => slot.id === slotId) ?? null;
      await runOptimisticUpdate("businessDetails", () => {
        if (currentSlot) {
          updateExtractionSlot({
            ...currentSlot,
            status,
          });
        }
      }, async () => {
        const payload = await apiPost<{ slot: ProductionStatus["slots"][number] }>(
          apiRoutes.production.slotStatus,
          { slotId, status },
          { fallbackError: "Failed to set slot status." }
        );
        if (payload.slot) {
          updateExtractionSlot(payload.slot);
        }
        return payload;
      });
    }, "Error setting slot status");
  }

  async function purchaseUpgrade(upgradeKey: string) {
    if (busy) return;
    await runBusyAction(async () => {
      const payload = await apiPost<{
        businessId: string;
        project: BusinessUpgradeProject;
        resultingBalance: number;
      }>(apiRoutes.businesses.upgrade(business.id), { upgradeKey }, { fallbackError: "Failed to purchase upgrade." });
      patchDetail({
        upgradeProjects: payload.project ? [payload.project, ...upgradeProjects] : upgradeProjects,
      });
      await refreshFinanceDashboard();
    }, "Error purchasing upgrade");
  }

  async function renameBusiness(nextName: string) {
    if (busy) return;

    await runBusyAction(async () => {
      const payload = await apiPatch<{ business: Business }>(
        apiRoutes.businesses.detail(business.id),
        { name: nextName },
        { fallbackError: "Failed to rename business." }
      );
      if (payload.business) {
        patchDetail({ business: payload.business });
      }
    }, "Error renaming business");
  }

  async function removeBusiness() {
    if (busy) return;

    await runBusyAction(async () => {
      await apiDelete(apiRoutes.businesses.detail(business.id), undefined, { fallbackError: "Failed to delete business." });
      router.push("/businesses");
    }, "Error deleting business");
  }

  async function assignEmployeeToBusinessAndMaybeSlot(employeeId: string) {
    const assignPayload = await apiPost<{ employee: Employee & { employee_assignments?: (EmployeeAssignment & { business: Business })[] } }>(
      apiRoutes.employees.assign,
      {
        employeeId,
        businessId: business.id,
        role: "production",
        roleSkillKey: "logistics"
      },
      { fallbackError: "Failed to assign employee." }
    );
    if (assignPayload.employee) {
      updateEmployeeRecord(assignPayload.employee);
    }

    if (production?.slots?.length) {
      const firstOpenSlot = production.slots.find((slot) => !slot.employee_id);
      if (firstOpenSlot) {
        try {
          const slotPayload = await apiPost<{ slot: ProductionStatus["slots"][number] }>(
            apiRoutes.production.assignSlot,
            { slotId: firstOpenSlot.id, employeeId },
            { fallbackError: "Employee assigned to business, but slot assignment failed." }
          );
          if (slotPayload.slot) {
            updateExtractionSlot(slotPayload.slot);
          }
        } catch (err) {
          const slotMessage = err instanceof Error
            ? `Employee assigned to business, but slot assignment failed: ${err.message}`
            : "Employee assigned to business, but slot assignment failed.";
          setError(slotMessage);
        }
      }
    }
  }

  async function hireEmployee(employeeType: string) {
    if (busy) return;
    const { firstName, lastName } = makeHireName();

    await runBusyAction(async () => {
      const hireResponse = await apiPost<{ employee: Employee }>(
        apiRoutes.employees.root,
        {
          firstName,
          lastName,
          businessId: business.id,
          employeeType,
          specialtySkillKey: employeeType === "specialist" ? "logistics" : undefined,
        },
        { fallbackError: "Failed to hire employee." }
      );
      if (hireResponse.employee) {
        updateEmployeeRecord(hireResponse.employee);
      }
      await assignEmployeeToBusinessAndMaybeSlot(hireResponse.employee.id);
    }, "Error hiring employee");
  }

  async function fireEmployee(employeeId: string) {
    if (busy) return;
    await runBusyAction(async () => {
      const payload = await apiDelete<{ employee: Employee }>(
        apiRoutes.employees.detail(employeeId),
        undefined,
        { fallbackError: "Failed to fire employee." }
      );
      if (payload.employee) {
        updateEmployeeRecord(payload.employee);
      }
    }, "Error firing employee");
  }

  async function unassignEmployeeGlobal(employeeId: string) {
    if (busy) return;
    await runBusyAction(async () => {
      const payload = await apiPost<{ employee: Employee & { employee_assignments?: (EmployeeAssignment & { business: Business })[] } }>(
        apiRoutes.employees.unassign,
        { employeeId },
        { fallbackError: "Failed to unassign employee." }
      );
      if (payload.employee) {
        updateEmployeeRecord(payload.employee);
      }
    }, "Error unassigning employee");
  }

  async function settleEmployee(employeeId: string) {
    if (busy) return;
    await runBusyAction(async () => {
      const payload = await apiPost<{ employee: Employee & { employee_assignments?: (EmployeeAssignment & { business: Business })[] } }>(
        apiRoutes.employees.settle,
        { employeeId },
        { fallbackError: "Failed to settle employee wages." }
      );
      if (payload.employee) {
        updateEmployeeRecord(payload.employee);
      }
    }, "Error settling employee wages");
  }

  async function assignEmployeeToManufacturing(lineId: string) {
    const employeeId = manufacturingAssignSelections[lineId];
    if (!employeeId || busy) return;
    await runBusyAction(async () => {
      const employee = thisBusinessEmployees.find((candidate) => candidate.id === employeeId);
      const assignment = employee ? getAssignmentForBusiness(employee) : null;

      if (!assignment) {
        const assignPayload = await apiPost<{ employee: Employee & { employee_assignments?: (EmployeeAssignment & { business: Business })[] } }>(apiRoutes.employees.assign, {
          employeeId,
          businessId: business.id,
          role: "production",
          roleSkillKey: "logistics",
        }, { fallbackError: "Failed to assign employee." });
        if (assignPayload.employee) {
          updateEmployeeRecord(assignPayload.employee);
        }
      }

      const payload = await apiPost<{ line: ManufacturingStatusView["lines"][number] }>(
        apiRoutes.production.assignManufacturingLine,
        { lineId, employeeId },
        { fallbackError: "Failed to assign manufacturing line." }
      );
      if (payload.line) {
        updateManufacturingLine(payload.line);
      }
      setManufacturingAssignSelections((prev) => ({ ...prev, [lineId]: "" }));
    }, "Error assigning employee");
  }

  async function retoolSlot(slotId: string) {
    const itemKey = slotRetoolSelections[slotId];
    if (!itemKey || busy) return;
    await runBusyAction(async () => {
      const currentSlot = production?.slots.find((slot) => slot.id === slotId) ?? null;
      const previousSelection = slotRetoolSelections[slotId] ?? "";
      const nextOption =
        currentSlot && production
          ? getExtractionProductOptionsForBusinessType(production.businessType).find((option) => option.itemKey === itemKey) ?? null
          : null;
      await runOptimisticUpdate("businessDetails", () => {
        if (currentSlot) {
          updateExtractionSlot({
            ...currentSlot,
            pending_item_key: itemKey,
            pending_output: nextOption,
            status: "retooling",
            output_progress: 0,
            input_progress: 0,
          });
        }
        setSlotRetoolSelections((prev) => ({ ...prev, [slotId]: "" }));
        return () => {
          setSlotRetoolSelections((prev) => ({ ...prev, [slotId]: previousSelection }));
        };
      }, async () => {
        const payload = await apiPost<{ slot: ProductionStatus["slots"][number] }>(
          apiRoutes.production.retoolSlot,
          { slotId, itemKey },
          { fallbackError: "Failed to retool production slot." }
        );
        if (payload.slot) {
          updateExtractionSlot(payload.slot);
        }
        return payload;
      });
    }, "Error retooling slot");
  }

  async function assignManufacturingWorker(lineId: string) {
    await assignEmployeeToManufacturing(lineId);
  }

  async function unassignManufacturingWorker(lineId: string) {
    if (busy) return;
    await runBusyAction(async () => {
      const payload = await apiPost<{ line: ManufacturingStatusView["lines"][number] }>(
        apiRoutes.production.unassignManufacturingLine,
        { lineId },
        { fallbackError: "Failed to unassign manufacturing line." }
      );
      if (payload.line) {
        updateManufacturingLine(payload.line);
      }
    }, "Error unassigning manufacturing line");
  }

  async function setManufacturingLineRunning(lineId: string, status: "active" | "idle") {
    if (busy) return;
    await runBusyAction(async () => {
      const payload = await apiPost<{ line: ManufacturingStatusView["lines"][number] }>(
        apiRoutes.production.manufacturingLineStatus,
        { lineId, status },
        { fallbackError: "Failed to update manufacturing line status." }
      );
      if (payload.line) {
        updateManufacturingLine(payload.line);
      }
    }, "Error updating manufacturing line status");
  }

  async function retoolManufacturingLine(lineId: string) {
    const recipeKey = manufacturingRetoolSelections[lineId];
    if (!recipeKey || busy) return;
    await runBusyAction(async () => {
      const payload = await apiPost<{ line: ManufacturingStatusView["lines"][number] }>(
        apiRoutes.production.retoolManufacturingLine,
        { lineId, recipeKey },
        { fallbackError: "Failed to retool manufacturing line." }
      );
      if (payload.line) {
        updateManufacturingLine(payload.line);
      }
      setManufacturingRetoolSelections((prev) => ({ ...prev, [lineId]: "" }));
    }, "Error retooling manufacturing line");
  }

  async function handleActionSubmit(item: BusinessInventoryItem) {
    if (!marketActionItem || busy) return;
    await runBusyAction(async () => {
      const previousAction = marketActionItem;
      await runOptimisticUpdate("businessDetails", () => {
        if (previousAction.type === "market") {
          patchInventoryItem(item.id, {
            reserved_quantity: item.reserved_quantity + actionQuantity,
          });
        } else {
          patchInventoryItem(item.id, {
            quantity: Math.max(0, item.quantity - actionQuantity),
          });
        }
        setMarketActionItem(null);
        return () => setMarketActionItem(previousAction);
      }, async () => {
        if (marketActionItem.type === "market") {
          await apiPost(
            apiRoutes.market.root,
            {
              sourceBusinessId: business.id,
              itemKey: item.item_key,
              quality: item.quality,
              quantity: actionQuantity,
              unitPrice: actionPrice,
            },
            { fallbackError: "Failed to create market listing." }
          );
        } else if (marketActionItem.type === "personal_transfer") {
          await apiPost(
            apiRoutes.inventory.transfer,
            {
              sourceType: "business",
              sourceBusinessId: business.id,
              destinationType: "personal",
              itemKey: item.item_key,
              quality: item.quality,
              quantity: actionQuantity,
            },
            { fallbackError: "Failed to transfer item." }
          );
        } else if (marketActionItem.type === "business_transfer") {
        const destinationBusiness = transferBusinesses.find((candidate) => candidate.id === transferBusinessId);
          await apiPost(
            apiRoutes.inventory.transfer,
            {
              sourceType: "business",
              sourceBusinessId: business.id,
              destinationType: "business",
              destinationBusinessId: transferBusinessId,
              destinationCityId: destinationBusiness?.city_id,
              itemKey: item.item_key,
              quality: item.quality,
              quantity: actionQuantity,
              unitPrice: transferUnitPrice,
            },
            { fallbackError: "Failed to transfer item." }
          );
        }
        await refreshFinanceDashboard();
      });
    }, "Error performing action");
  }

  async function saveShelfItem(item: BusinessInventoryItem) {
    if (!shelfActionItem || busy) return;

    await runBusyAction(async () => {
      const previousShelfItem = shelfItems.find(
        (entry) => entry.business_id === business.id && entry.item_key === item.item_key && entry.quality === item.quality
      );
      const optimisticShelfItem: StoreShelfItem = {
        id: previousShelfItem?.id ?? `optimistic-shelf-${item.id}`,
        owner_player_id: business.player_id,
        business_id: business.id,
        item_key: item.item_key,
        quality: item.quality,
        quantity: shelfQuantity,
        unit_price: shelfPrice,
        created_at: previousShelfItem?.created_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const previousAction = shelfActionItem;
      await runOptimisticUpdate("businessDetails", () => {
        upsertShelfItem(optimisticShelfItem);
        const previousQuantity = previousShelfItem?.quantity ?? 0;
        const reservedDelta = shelfQuantity - previousQuantity;
        adjustInventoryByKey(item.item_key, item.quality, (current) => ({
          ...current,
          reserved_quantity: Math.max(0, current.reserved_quantity + reservedDelta),
        }));
        setShelfActionItem(null);
        return () => setShelfActionItem(previousAction);
      }, async () => {
        const payload = await apiPost<{ shelfItem: StoreShelfItem }>(
          apiRoutes.stores.shelves,
          {
            businessId: business.id,
            itemKey: item.item_key,
            quality: item.quality,
            quantity: shelfQuantity,
            unitPrice: shelfPrice,
          },
          { fallbackError: "Failed to save shelf item." }
        );
        if (payload.shelfItem) {
          upsertShelfItem(payload.shelfItem);
          if (!previousShelfItem && optimisticShelfItem.id !== payload.shelfItem.id) {
            removeShelfItemFromDetail(optimisticShelfItem.id);
            upsertShelfItem(payload.shelfItem);
          }
        }
        await refreshFinanceDashboard();
        return payload;
      });
    }, "Error saving shelf item");
  }

  async function removeShelfItem(shelfItemId: string) {
    if (busy) return;

    await runBusyAction(async () => {
      const currentShelfItem = shelfItems.find((item) => item.id === shelfItemId) ?? null;
      const previousAction = shelfActionItem;
      await runOptimisticUpdate("businessDetails", () => {
        removeShelfItemFromDetail(shelfItemId);
        if (currentShelfItem) {
          adjustInventoryByKey(currentShelfItem.item_key, currentShelfItem.quality, (current) => ({
            ...current,
            reserved_quantity: Math.max(0, current.reserved_quantity - currentShelfItem.quantity),
          }));
        }
        if (shelfActionItem) {
          setShelfActionItem(null);
        }
        return () => {
          if (previousAction) setShelfActionItem(previousAction);
        };
      }, async () => {
        await apiDelete(apiRoutes.stores.shelves, { shelfItemId }, { fallbackError: "Failed to remove shelf item." });
        await refreshFinanceDashboard();
      });
    }, "Error removing shelf item");
  }

  function getShelfPricingGuide(itemKey: string) {
    const range = getNpcBuyerPriceRange(itemKey);
    const suggested = getNpcSuggestedBasePrice(itemKey);
    return { range, suggested };
  }

  return (
    <div className="card anim" style={{ marginTop: 24 }}>
      <div className="card-header" style={{ padding: 0, borderBottom: "1px solid var(--border-subtle)", overflowX: "auto" }}>
        <div style={{ display: "flex", gap: 24, padding: "0 24px" }}>
          {(["overview", "finance", "operations", "employees", "inventory", "upgrades", "options"] as TabType[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                background: "transparent",
                border: "none",
                padding: "16px 0",
                fontSize: "0.85rem",
                fontWeight: 600,
                color: activeTab === tab ? "var(--text-primary)" : "var(--text-muted)",
                borderBottom: activeTab === tab ? "2px solid var(--accent-blue)" : "2px solid transparent",
                cursor: "pointer",
                textTransform: "capitalize",
                transition: "color 0.2s, border-color 0.2s"
              }}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>
      <div className="card-body" style={{ minHeight: 400 }}>
        {error && (
          <div style={{ padding: "12px", marginBottom: "16px", background: "rgba(248, 113, 113, 0.1)", color: "#f87171", borderRadius: "8px", border: "1px solid rgba(248, 113, 113, 0.2)" }}>
            {error}
          </div>
        )}
        {activeTab === "overview" && (
          <div>
            <BusinessOverviewDashboard
              business={business}
              financeDashboard={financeDashboardState}
              production={production}
              manufacturing={manufacturing}
              inventory={inventory}
              shelfItems={shelfItems}
              upgrades={upgrades}
              employees={employeesForView}
            />
          </div>
        )}

        {activeTab === "finance" && (
          <div>
            <BusinessFinanceDashboardPanel
              financeDashboard={financeDashboardState}
              initialPeriod={selectedFinancePeriod}
            />
          </div>
        )}
        
        {activeTab === "operations" && (
          <div>
            <h3 style={{ marginBottom: 16 }}>Operations</h3>
            <BusinessOperationsDashboard
              business={business}
              production={production}
              manufacturing={manufacturing}
              inventory={inventory}
              shelfItems={activeShelfItems}
              employees={employeesForView}
            />
            {isStoreBusiness && (
              <div style={{ display: "grid", gap: 16, marginBottom: 16 }}>
                <div style={{ background: "var(--bg-primary)", padding: 16, borderRadius: "var(--radius-sm)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
                    <div>
                      <h4 style={{ margin: 0, fontSize: "0.95rem" }}>Shelf Stock</h4>
                      <p style={{ margin: "4px 0 0", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                        Place business inventory on shelves and set the price NPC shoppers will pay.
                      </p>
                    </div>
                    <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                      Active shelf rows: {activeShelfItems.length}
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 16 }}>
                    {[
                      { label: "Shelf Fill", value: Math.round(shelfFillRatio * 100), color: "#22c55e", sub: `${totalShelfUnits} shelf / ${totalBackroomUnits} backroom` },
                      { label: "Restock Readiness", value: Math.round(clamp(totalBackroomUnits / Math.max(1, totalShelfUnits + totalBackroomUnits), 0, 1) * 100), color: "#60a5fa", sub: `${totalBackroomUnits} units ready behind counter` },
                      { label: "Floor Flow", value: Math.round(clamp(shelfFlowRatio / 2, 0, 1) * 100), color: "#f59e0b", sub: shelfFlowRatio >= 1 ? "Backroom can fully refill floor" : "Shelf load running ahead of reserve" },
                    ].map((metric) => (
                      <div key={metric.label} style={{ display: "grid", gap: 6, padding: 12, borderRadius: 12, background: "var(--bg-elevated)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.12em" }}>{metric.label}</span>
                          <strong style={{ color: "#f8fafc" }}>{metric.value}%</strong>
                        </div>
                        <div style={{ position: "relative", height: 10, borderRadius: 999, background: "rgba(148,163,184,0.1)", overflow: "hidden" }}>
                          <div style={{ width: `${metric.value}%`, height: "100%", background: metric.color, borderRadius: 999, transition: "width 900ms linear" }} />
                        </div>
                        <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>{metric.sub}</div>
                      </div>
                    ))}
                  </div>

                  {activeShelfItems.length > 0 ? (
                    <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
                      {activeShelfItems.map((item) => (
                        (() => {
                          const pricingGuide = getShelfPricingGuide(item.item_key);
                          const inventoryItem = inventory.find(
                            (inventoryRow) => inventoryRow.item_key === item.item_key && inventoryRow.quality === item.quality
                          );
                          const freeStock = inventoryItem ? Math.max(0, inventoryItem.quantity - inventoryItem.reserved_quantity) : 0;
                          const laneFill = item.quantity + freeStock > 0 ? item.quantity / (item.quantity + freeStock) : 0;
                          return (
                            <div
                              key={item.id}
                              style={{ display: "grid", gap: 10, padding: 12, background: "var(--bg-elevated)", borderRadius: 8 }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                                <div>
                                  <div style={{ fontWeight: 600 }}>{formatItemKey(item.item_key)} (Q{item.quality})</div>
                                  <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                                    On shelf: {item.quantity} | Backroom: {freeStock} | Price: {formatCurrency(item.unit_price)} | Suggested: {formatCurrency(pricingGuide.suggested)}
                                  </div>
                                </div>
                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                  <button
                                    onClick={() => {
                                      const inventoryItem = inventory.find(
                                        (inventoryRow) => inventoryRow.item_key === item.item_key && inventoryRow.quality === item.quality
                                      );
                                      const available = inventoryItem ? inventoryItem.quantity - inventoryItem.reserved_quantity : 0;
                                      setShelfActionItem({
                                        itemKey: item.item_key,
                                        quality: item.quality,
                                        maxQuantity: Math.max(item.quantity, item.quantity + available),
                                      });
                                      setShelfQuantity(item.quantity);
                                      setShelfPrice(item.unit_price);
                                    }}
                                    disabled={busy}
                                    style={{ fontSize: "0.75rem", padding: "4px 8px" }}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => void removeShelfItem(item.id)}
                                    disabled={busy}
                                    style={{ fontSize: "0.75rem", padding: "4px 8px", background: "rgba(248, 113, 113, 0.1)", color: "#f87171", border: "1px solid rgba(248, 113, 113, 0.2)" }}
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                              <div style={{ display: "grid", gap: 6 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: "0.78rem" }}>
                                  <span style={{ color: "var(--text-muted)" }}>Shelf presence</span>
                                  <strong style={{ color: "#86efac" }}>{Math.round(laneFill * 100)}%</strong>
                                </div>
                                <div style={{ position: "relative", height: 10, borderRadius: 999, background: "rgba(148,163,184,0.1)", overflow: "hidden" }}>
                                  <div style={{ width: `${laneFill * 100}%`, height: "100%", background: "#22c55e", borderRadius: 999, transition: "width 900ms linear" }} />
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: "0.78rem", color: "var(--text-secondary)" }}>
                                  <span>{freeStock > 0 ? "Backroom ready to replenish" : "No backroom buffer"}</span>
                                  <span>{freeStock} reserve</span>
                                </div>
                              </div>
                            </div>
                          );
                        })()
                      ))}
                    </div>
                  ) : (
                    <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: 16 }}>No items are currently on your shelves.</p>
                  )}

                  {inventory.length > 0 ? (
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--border-subtle)", textAlign: "left" }}>
                          <th style={{ padding: "12px 8px", color: "var(--text-secondary)", fontWeight: 500, fontSize: "0.85rem" }}>Item</th>
                          <th style={{ padding: "12px 8px", color: "var(--text-secondary)", fontWeight: 500, fontSize: "0.85rem" }}>Quality</th>
                          <th style={{ padding: "12px 8px", color: "var(--text-secondary)", fontWeight: 500, fontSize: "0.85rem", textAlign: "right" }}>Free Stock</th>
                          <th style={{ padding: "12px 8px", color: "var(--text-secondary)", fontWeight: 500, fontSize: "0.85rem", textAlign: "right" }}>On Shelf</th>
                          <th style={{ padding: "12px 8px", color: "var(--text-secondary)", fontWeight: 500, fontSize: "0.85rem", textAlign: "right" }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inventory.map((item) => {
                          const available = item.quantity - item.reserved_quantity;
                          const existingShelf = shelfByInventoryKey[shelfKey(item.item_key, item.quality)] as StoreShelfItem | undefined;
                          const maxShelfQuantity = available + (existingShelf?.quantity ?? 0);
                          const isShelfRow =
                            shelfActionItem?.itemKey === item.item_key && shelfActionItem?.quality === item.quality;
                          const pricingGuide = getShelfPricingGuide(item.item_key);

                          return (
                            <Fragment key={`${item.id}-shelf`}>
                              <tr style={{ borderBottom: isShelfRow ? "none" : "1px solid var(--border-subtle)" }}>
                                <td style={{ padding: "12px 8px" }}>{formatItemKey(item.item_key)}</td>
                                <td style={{ padding: "12px 8px" }}>{item.quality}</td>
                                <td style={{ padding: "12px 8px", textAlign: "right", fontWeight: 600 }}>
                                  <div>{available}</div>
                                  <div style={{ marginTop: 4, height: 6, borderRadius: 999, background: "rgba(148,163,184,0.1)", overflow: "hidden" }}>
                                    <div style={{ width: `${Math.round(clamp(available / Math.max(1, maxShelfQuantity), 0, 1) * 100)}%`, height: "100%", background: "#60a5fa", borderRadius: 999 }} />
                                  </div>
                                </td>
                                <td style={{ padding: "12px 8px", textAlign: "right" }}>
                                  <div>{existingShelf?.quantity ?? 0}</div>
                                  <div style={{ marginTop: 4, height: 6, borderRadius: 999, background: "rgba(148,163,184,0.1)", overflow: "hidden" }}>
                                    <div style={{ width: `${Math.round(clamp((existingShelf?.quantity ?? 0) / Math.max(1, maxShelfQuantity), 0, 1) * 100)}%`, height: "100%", background: "#22c55e", borderRadius: 999 }} />
                                  </div>
                                </td>
                                <td style={{ padding: "12px 8px", textAlign: "right" }}>
                                  <button
                                    onClick={() => {
                                      setShelfActionItem({
                                        itemKey: item.item_key,
                                        quality: item.quality,
                                        maxQuantity: maxShelfQuantity,
                                      });
                                      setShelfQuantity(existingShelf?.quantity ?? 1);
                                      setShelfPrice(existingShelf?.unit_price ?? pricingGuide.suggested);
                                    }}
                                    disabled={busy || maxShelfQuantity <= 0}
                                    style={{ fontSize: "0.75rem", padding: "4px 8px" }}
                                  >
                                    {existingShelf ? "Edit Shelf" : "Place on Shelf"}
                                  </button>
                                </td>
                              </tr>
                              {isShelfRow && (
                                <tr style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-elevated)" }}>
                                  <td colSpan={5} style={{ padding: "12px 16px" }}>
                                    <div style={{ display: "flex", gap: 16, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>
                                      <div style={{ fontSize: "0.85rem", fontWeight: 500 }}>Shelf setup:</div>
                                      <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                                        Suggested: {formatCurrency(pricingGuide.suggested)} base
                                      </div>
                                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                        <label style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Qty:</label>
                                        <input
                                          type="number"
                                          title="Shelf quantity"
                                          min={1}
                                          max={maxShelfQuantity}
                                          value={shelfQuantity}
                                          onChange={(e) => setShelfQuantity(Math.min(maxShelfQuantity, Math.max(1, parseInt(e.target.value) || 1)))}
                                          style={{ width: 70, padding: "4px 8px", fontSize: "0.8rem", background: "var(--bg-primary)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)" }}
                                        />
                                        <button
                                          type="button"
                                          onClick={() => setShelfQuantity(maxShelfQuantity)}
                                          disabled={busy || maxShelfQuantity <= 0}
                                          style={{
                                            fontSize: "0.75rem",
                                            padding: "4px 8px",
                                            background: "transparent",
                                            color: "var(--text-primary)",
                                            border: "1px solid var(--border-subtle)",
                                            borderRadius: "var(--radius-sm)",
                                          }}
                                        >
                                          Max
                                        </button>
                                      </div>
                                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                        <label style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Unit Price ($):</label>
                                        <input
                                          type="number"
                                          title="Shelf price"
                                          min={0.01}
                                          step={0.01}
                                          value={shelfPrice}
                                          onChange={(e) => setShelfPrice(Math.max(0.01, parseFloat(e.target.value) || 0.01))}
                                          style={{ width: 90, padding: "4px 8px", fontSize: "0.8rem", background: "var(--bg-primary)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)" }}
                                        />
                                      </div>
                                      <div style={{ display: "flex", gap: 8 }}>
                                        <button onClick={() => setShelfActionItem(null)} disabled={busy} style={{ fontSize: "0.75rem", padding: "4px 8px", background: "transparent", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" }}>Cancel</button>
                                        <button onClick={() => void saveShelfItem(item)} disabled={busy} style={{ fontSize: "0.75rem", padding: "4px 8px", background: "var(--accent-blue)", color: "white", border: "none" }}>Save Shelf</button>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>No business inventory is available to stock shelves.</p>
                  )}
                </div>
              </div>
            )}
		            {production || manufacturing ? (
		              <div style={{ background: "var(--bg-primary)", padding: 16, borderRadius: "var(--radius-sm)" }}>
	                <div style={{ marginBottom: 12 }}>
	                  <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Type</span>
	                  <div style={{ fontWeight: 600 }}>{production ? "Extraction" : "Manufacturing"}</div>
	                </div>

                {production && production.slots && (
                  <div>
                    <h4 style={{ marginBottom: 8, fontSize: "0.9rem" }}>{business.type === "farm" ? "Fields" : "Extraction Slots"}</h4>
                    {production.slots.length > 0 ? (
                      <div style={{ display: "grid", gap: 8 }}>
                        {production.slots.map((slot) => {
                          const assignedEmp = employees.find((employee) => employee.id === slot.employee_id);
                          const outputOptions = getExtractionProductOptionsForBusinessType(production.businessType);

                          return (
                            <div key={slot.id} style={{ display: "flex", justifyContent: "space-between", padding: 12, background: "var(--bg-elevated)", borderRadius: 8, flexWrap: "wrap", gap: 12 }}>
                              <div>
                                <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{slot.line_label} #{slot.slot_number}</div>
                                <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                                  Worker: {assignedEmp ? `${assignedEmp.first_name}` : "None"}
                                </div>
                                <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                                  {business.type === "farm" ? "Crop" : "Output"}: {slot.configured_output?.displayName ?? "Not configured"}
                                </div>
                                {slot.pending_output ? (
                                  <div style={{ fontSize: "0.75rem", color: "var(--accent-blue)", marginTop: 4 }}>
                                    Retooling to {slot.pending_output.displayName}
                                  </div>
                                ) : null}
                                {!assignedEmp && availableWorkersForSlots.length > 0 && (
                                  <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                                    <select
                                      title="Select worker"
                                      value={assignSelections[slot.id] || ""}
                                      onChange={(e) => setAssignSelections((prev) => ({ ...prev, [slot.id]: e.target.value }))}
                                      style={{ fontSize: "0.75rem", padding: "4px 8px" }}
                                    >
                                      <option value="">Select worker...</option>
                                      {availableWorkersForSlots.map((worker) => (
                                        <option key={worker.id} value={worker.id}>{worker.first_name} {worker.last_name}</option>
                                      ))}
                                    </select>
                                    <button onClick={() => assignSlot(slot.id)} disabled={busy || !assignSelections[slot.id]} style={{ fontSize: "0.75rem", padding: "4px 8px" }}>Assign</button>
                                  </div>
                                )}
                                {assignedEmp ? (
                                  <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                                    <button onClick={() => unassignSlot(slot.id)} disabled={busy} style={{ fontSize: "0.75rem", padding: "4px 8px" }}>Unassign</button>
                                    <button onClick={() => setSlotStatus(slot.id, slot.status === "active" ? "idle" : "active")} disabled={busy || slot.status === "retooling"} style={{ fontSize: "0.75rem", padding: "4px 8px" }}>
                                      {slot.status === "active" ? "Stop" : "Start"}
                                    </button>
                                  </div>
                                ) : null}
                                {outputOptions.length > 0 ? (
                                  <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                    <select
                                      title="Retool slot"
                                      value={slotRetoolSelections[slot.id] || ""}
                                      onChange={(e) => setSlotRetoolSelections((prev) => ({ ...prev, [slot.id]: e.target.value }))}
                                      disabled={busy || slot.status === "retooling"}
                                      style={{ fontSize: "0.75rem", padding: "4px 8px" }}
                                    >
                                      <option value="">{business.type === "farm" ? "Select crop..." : "Select output..."}</option>
                                      {outputOptions.map((option) => (
                                        <option key={option.itemKey} value={option.itemKey}>{option.displayName}</option>
                                      ))}
                                    </select>
                                    <button onClick={() => retoolSlot(slot.id)} disabled={busy || slot.status === "retooling" || !slotRetoolSelections[slot.id]} style={{ fontSize: "0.75rem", padding: "4px 8px" }}>Retool</button>
                                  </div>
                                ) : null}
                              </div>
                              <div style={{ textAlign: "right" }}>
                                <span className={`status-badge ${slot.status === 'active' ? 'status-producing' : ''}`}>{slot.status}</span>
                                {slot.tool ? (
                                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 4 }}>
                                    Tool: {formatItemKey(slot.tool.item_type)} ({slot.tool.uses_remaining} uses)
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>No slots unlocked.</p>
                    )}
                  </div>
                )}

                {manufacturing && manufacturing.lines.length > 0 && (
                  <div>
                    <h4 style={{ marginBottom: 8, fontSize: "0.9rem" }}>Production Lines</h4>
                    <div style={{ display: "grid", gap: 8 }}>
                      {manufacturing.lines.map((line) => {
                        const assignedEmp = employees.find((employee) => employee.id === line.employee_id);
                        const recipeDetails = line.configured_recipe ?? line.pending_recipe;
                        const productionNote = recipeDetails
                          ? `Consumes ${recipeDetails.inputs
                              .map((input) => `${input.quantity.toLocaleString()} ${formatItemKey(input.itemKey)}`)
                              .join(", ")} and produces ${recipeDetails.baseOutputQuantity.toLocaleString()} ${formatItemKey(recipeDetails.outputItemKey)} per minute`
                          : null;
                        return (
                          <div key={line.id} style={{ display: "flex", justifyContent: "space-between", padding: 12, background: "var(--bg-elevated)", borderRadius: 8, gap: 12, flexWrap: "wrap" }}>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>Line #{line.line_number}</div>
                              <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                                Tooled For: {line.configured_recipe?.displayName ?? "Not configured"}
                              </div>
                              {productionNote ? (
                                <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: 2 }}>
                                  {productionNote}
                                </div>
                              ) : null}
                              <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                                Worker: {assignedEmp ? `${assignedEmp.first_name} ${assignedEmp.last_name}` : "None"}
                              </div>
                              {line.pending_recipe ? (
                                <div style={{ fontSize: "0.75rem", color: "var(--accent-blue)", marginTop: 4 }}>
                                  Retooling to {line.pending_recipe.displayName}
                                </div>
                              ) : null}
                              <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                {!assignedEmp ? (
                                  <select
                                    title="Select manufacturing worker"
                                    value={manufacturingAssignSelections[line.id] || ""}
                                    onChange={(e) => setManufacturingAssignSelections((prev) => ({ ...prev, [line.id]: e.target.value }))}
                                    style={{ fontSize: "0.75rem", padding: "4px 8px", minWidth: 180 }}
                                  >
                                    <option value="">Select worker...</option>
                                    {availableWorkersForManufacturing.map((employee) => (
                                      <option key={employee.id} value={employee.id}>{employee.first_name} {employee.last_name}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <>
                                  <button onClick={() => unassignManufacturingWorker(line.id)} disabled={busy} style={{ fontSize: "0.75rem", padding: "4px 8px" }}>Unassign</button>
                                  <button onClick={() => setManufacturingLineRunning(line.id, line.status === "active" ? "idle" : "active")} disabled={busy || line.status === "retooling" || !line.configured_recipe} style={{ fontSize: "0.75rem", padding: "4px 8px" }}>
                                    {line.status === "active" ? "Stop" : "Start"}
                                  </button>
                                  </>
                                )}
                                <select
                                  title="Retool manufacturing line"
                                  value={manufacturingRetoolSelections[line.id] || ""}
                                  onChange={(e) => setManufacturingRetoolSelections((prev) => ({ ...prev, [line.id]: e.target.value }))}
                                  disabled={busy || line.status === "retooling"}
                                  style={{ fontSize: "0.75rem", padding: "4px 8px", minWidth: 180 }}
                                >
                                  <option value="">Select recipe...</option>
                                  {line.available_recipes.map((recipe) => (
                                    <option key={recipe.key} value={recipe.key}>{recipe.displayName}</option>
                                  ))}
                                </select>
                                {!assignedEmp ? (
                                  <button onClick={() => assignManufacturingWorker(line.id)} disabled={busy || !manufacturingAssignSelections[line.id] || line.status === "retooling"} style={{ fontSize: "0.75rem", padding: "4px 8px" }}>Assign</button>
                                ) : null}
                                <button onClick={() => retoolManufacturingLine(line.id)} disabled={busy || line.status === "retooling" || !manufacturingRetoolSelections[line.id]} style={{ fontSize: "0.75rem", padding: "4px 8px" }}>Retool</button>
                              </div>
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <span className={`status-badge ${line.status === 'active' ? 'status-producing' : ''}`}>{line.status}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
	            ) : !isStoreBusiness ? (
	              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>No operations active.</p>
	            ) : null}
	          </div>
	        )}

        {activeTab === "employees" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>Employees</h3>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => hireEmployee("temp")} disabled={busy} style={{ fontSize: "0.8rem", padding: "6px 12px" }}>Hire Temp ($0 · {tempPayPer15Min}/15m)</button>
                <button onClick={() => hireEmployee("part_time")} disabled={busy} style={{ fontSize: "0.8rem", padding: "6px 12px" }}>Hire Part Time ($200 · {partTimePayPer15Min}/15m)</button>
                <button onClick={() => hireEmployee("full_time")} disabled={busy} style={{ fontSize: "0.8rem", padding: "6px 12px" }}>Hire Full Time ($500 · {fullTimePayPer15Min}/15m)</button>
              </div>
            </div>

            <BusinessEmployeesDashboard business={business} employees={employeesForView} />

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
              <div style={{ background: "var(--bg-primary)", padding: 16, borderRadius: "var(--radius-sm)" }}>
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Total Employees</div>
                <div>{employees.length}</div>
              </div>
              <div style={{ background: "var(--bg-primary)", padding: 16, borderRadius: "var(--radius-sm)" }}>
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Assigned to This Business</div>
                <div>{thisBusinessEmployees.length}</div>
              </div>
              <div style={{ background: "var(--bg-primary)", padding: 16, borderRadius: "var(--radius-sm)" }}>
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Total Wages Per Hour</div>
                <div>{formatCurrency(employees.reduce((sum, employee) => sum + (employee.wage_per_hour || 0), 0))}</div>
              </div>
              <div style={{ background: "var(--bg-primary)", padding: 16, borderRadius: "var(--radius-sm)" }}>
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>This Business Wages Per Hour</div>
                <div>{formatCurrency(thisBusinessEmployees.reduce((sum, employee) => sum + (getAssignmentForBusiness(employee)?.wage_per_hour ?? employee.wage_per_hour ?? 0), 0))}</div>
              </div>
            </div>

            {employees && employees.length > 0 ? (
              <div style={{ display: "grid", gap: 12 }}>
                {employees.map((e) => {
                  const assignment = getAssignmentForBusiness(e) ?? getAssignments(e)[0];
                  return (
                    <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 12, background: "var(--bg-primary)", borderRadius: 8, flexWrap: "wrap", gap: 12 }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{e.first_name} {e.last_name}</div>
                        <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: 4 }}>
                          {formatEmployeeType(e.employee_type)} • {formatLabel(getWorkerEffectiveStatus(e.status, e.shift_ends_at))}
                        </div>
                        {assignment && (
                          <div style={{ fontSize: "0.8rem", color: "var(--accent-blue)", marginTop: 4 }}>
                            Working at: {assignment.business?.name || "Unknown Business"} ({assignment.role}) {assignment.slot_number ? ` (Slot #${assignment.slot_number})` : ""}
                          </div>
                        )}
                        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 4 }}>
                          Wage: {formatCurrency(assignment?.wage_per_hour ?? BASE_WAGE_PER_HOUR[e.employee_type])}/hr
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {e.status === "unpaid" && (
                          <button onClick={() => settleEmployee(e.id)} disabled={busy} style={{ fontSize: "0.75rem", padding: "4px 8px", background: "rgba(96, 165, 250, 0.12)", color: "#60a5fa", border: "1px solid rgba(96, 165, 250, 0.25)" }}>Settle Wages</button>
                        )}
                        {assignment && (
                          <button onClick={() => unassignEmployeeGlobal(e.id)} disabled={busy} style={{ fontSize: "0.75rem", padding: "4px 8px", background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" }}>Unassign</button>
                        )}
                        <button onClick={() => fireEmployee(e.id)} disabled={busy} style={{ fontSize: "0.75rem", padding: "4px 8px", background: "rgba(248, 113, 113, 0.1)", color: "#f87171", border: "1px solid rgba(248, 113, 113, 0.2)" }}>Fire</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>No employees.</p>
            )}
          </div>
        )}

        {activeTab === "inventory" && (
          <div>
            <h3 style={{ marginBottom: 16 }}>Inventory</h3>
            <BusinessInventoryDashboard inventory={inventory} shelfItems={shelfItems} />
            {inventory.length > 0 ? (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border-subtle)", textAlign: "left" }}>
                    <th style={{ padding: "12px 8px", color: "var(--text-secondary)", fontWeight: 500, fontSize: "0.85rem" }}>Item</th>
                    <th style={{ padding: "12px 8px", color: "var(--text-secondary)", fontWeight: 500, fontSize: "0.85rem" }}>Quality</th>
                    <th style={{ padding: "12px 8px", color: "var(--text-secondary)", fontWeight: 500, fontSize: "0.85rem", textAlign: "right" }}>Available</th>
                    <th style={{ padding: "12px 8px", color: "var(--text-secondary)", fontWeight: 500, fontSize: "0.85rem", textAlign: "right" }}>Reserved</th>
                    <th style={{ padding: "12px 8px", color: "var(--text-secondary)", fontWeight: 500, fontSize: "0.85rem", textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.map((item) => {
                    const available = item.quantity - item.reserved_quantity;
                    const isActionRow = marketActionItem?.id === item.id;
                    return (
                      <Fragment key={item.id}>
                        <tr style={{ borderBottom: isActionRow ? "none" : "1px solid var(--border-subtle)" }}>
                          <td style={{ padding: "12px 8px" }}>{formatItemKey(item.item_key)}</td>
                          <td style={{ padding: "12px 8px" }}>{item.quality}</td>
                          <td style={{ padding: "12px 8px", textAlign: "right", fontWeight: 600 }}>{available}</td>
                          <td style={{ padding: "12px 8px", textAlign: "right", color: "var(--text-muted)" }}>{item.reserved_quantity}</td>
                          <td style={{ padding: "12px 8px", textAlign: "right" }}>
                            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                              <button
                                onClick={() => {
                                  setMarketActionItem({ id: item.id, type: "market", available });
                                  setActionQuantity(1);
                                  setActionPrice(1);
                                }}
                                disabled={busy || available <= 0}
                                style={{ fontSize: "0.75rem", padding: "4px 8px" }}
                              >
                                Market
                              </button>
                              <button
                                onClick={() => {
                                  setMarketActionItem({ id: item.id, type: "personal_transfer", available });
                                  setActionQuantity(1);
                                }}
                                disabled={busy || available <= 0}
                                style={{ fontSize: "0.75rem", padding: "4px 8px" }}
                              >
                                To Personal
                              </button>
                              <button
                                onClick={() => {
                                  setMarketActionItem({ id: item.id, type: "business_transfer", available });
                                  setActionQuantity(1);
                                  setTransferBusinessId(transferBusinesses[0]?.id ?? "");
                                  setTransferUnitPrice(Math.max(1, actionPrice));
                                }}
                                disabled={busy || available <= 0 || transferBusinesses.length === 0}
                                style={{ fontSize: "0.75rem", padding: "4px 8px" }}
                              >
                                To Business
                              </button>
                            </div>
                          </td>
                        </tr>
                        {isActionRow && (
                          <tr style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-elevated)" }}>
                            <td colSpan={5} style={{ padding: "12px 16px" }}>
                              <div style={{ display: "flex", gap: 16, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>
                                <div style={{ fontSize: "0.85rem", fontWeight: 500 }}>
                                  {marketActionItem.type === "market"
                                    ? "List on Market:"
                                    : marketActionItem.type === "personal_transfer"
                                      ? "Transfer to Personal:"
                                      : "Transfer to Another Business:"}
                                </div>
                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                  <label style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Qty:</label>
                                  <input 
                                    type="number" 
                                    title="Quantity"
                                    min={1} 
                                    max={available} 
                                    value={actionQuantity} 
                                    onChange={(e) => setActionQuantity(Math.min(available, Math.max(1, parseInt(e.target.value) || 1)))} 
                                    style={{ width: 60, padding: "4px 8px", fontSize: "0.8rem", background: "var(--bg-primary)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)" }} 
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setActionQuantity(available)}
                                    disabled={busy || available <= 0}
                                    style={{
                                      fontSize: "0.75rem",
                                      padding: "4px 8px",
                                      background: "transparent",
                                      color: "var(--text-primary)",
                                      border: "1px solid var(--border-subtle)",
                                      borderRadius: "var(--radius-sm)",
                                    }}
                                  >
                                    Max
                                  </button>
                                </div>
                                {marketActionItem.type === "market" && (
                                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                    <label style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Unit Price ($):</label>
                                    <input 
                                      type="number" 
                                      title="Unit Price"
                                      min={0.01} 
                                      step={0.01} 
                                      value={actionPrice} 
                                      onChange={(e) => setActionPrice(Math.max(0.01, parseFloat(e.target.value) || 0.01))} 
                                      style={{ width: 80, padding: "4px 8px", fontSize: "0.8rem", background: "var(--bg-primary)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)" }} 
                                    />
                                  </div>
                                )}
                                {marketActionItem.type === "business_transfer" && (
                                  <>
                                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                      <label style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Destination:</label>
                                      <select
                                        title="Destination business"
                                        value={transferBusinessId}
                                        onChange={(e) => setTransferBusinessId(e.target.value)}
                                        style={{ padding: "4px 8px", fontSize: "0.8rem", background: "var(--bg-primary)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)" }}
                                      >
                                        <option value="">Select business...</option>
                                        {transferBusinesses.map((candidate) => (
                                          <option key={candidate.id} value={candidate.id}>
                                            {candidate.name}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                      <label style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Price / Unit:</label>
                                      <input
                                        type="number"
                                        title="Transfer price"
                                        min={1}
                                        step={0.01}
                                        value={transferUnitPrice}
                                        onChange={(e) => setTransferUnitPrice(Math.max(1, parseFloat(e.target.value) || 1))}
                                        style={{ width: 90, padding: "4px 8px", fontSize: "0.8rem", background: "var(--bg-primary)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)" }}
                                      />
                                    </div>
                                    <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                                      Shipping and purchase charges post to the businesses involved.
                                    </div>
                                  </>
                                )}
                                <div style={{ display: "flex", gap: 8 }}>
                                  <button onClick={() => setMarketActionItem(null)} disabled={busy} style={{ fontSize: "0.75rem", padding: "4px 8px", background: "transparent", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" }}>Cancel</button>
                                  <button
                                    onClick={() => handleActionSubmit(item)}
                                    disabled={
                                      busy ||
                                      (marketActionItem.type === "business_transfer" &&
                                        (!transferBusinessId || transferUnitPrice < 1))
                                    }
                                    style={{ fontSize: "0.75rem", padding: "4px 8px", background: "var(--accent-blue)", color: "white", border: "none" }}
                                  >
                                    Confirm
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Inventory is empty.</p>
            )}
          </div>
        )}

        {activeTab === "upgrades" && (
          <div>
            <h3 style={{ marginBottom: 16 }}>Upgrades</h3>
            {activeUpgradeProject && (
              <div style={{ marginBottom: 16, padding: 16, borderRadius: 8, background: "rgba(96, 165, 250, 0.08)", border: "1px solid rgba(96, 165, 250, 0.2)" }}>
                <div style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "#93c5fd", marginBottom: 6 }}>
                  Active Capital Project
                </div>
                <div style={{ fontWeight: 600 }}>
                  {upgradeDefinitionsState.find((definition) => definition.upgrade_key === activeUpgradeProject.upgrade_key)?.display_name ?? formatLabel(activeUpgradeProject.upgrade_key)}
                  {" "}Lv.{activeUpgradeProject.target_level}
                </div>
                <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginTop: 4 }}>
                  Completes {activeUpgradeProject.completes_at ? new Date(activeUpgradeProject.completes_at).toLocaleString() : "soon"} • Downtime: {formatLabel(activeUpgradeProject.downtime_policy)}
                </div>
              </div>
            )}
            {upgradeDefinitionsState.length > 0 ? (
              <div style={{ display: "grid", gap: 12 }}>
                {upgradeDefinitionsState.map((def) => {
                  const currentUpgrade = upgrades.find((u) => u.upgrade_key === def.upgrade_key);
                  const currentLevel = currentUpgrade?.level || 0;
                  const preview = calculateUpgradePreview(def, { upgradeKey: def.upgrade_key, currentLevel });
                  const project = upgradeProjects.find(
                    (entry) =>
                      entry.upgrade_key === def.upgrade_key &&
                      (entry.project_status === "queued" || entry.project_status === "installing")
                  );
                  const isMaxed = !def.is_infinite && def.max_level !== null && currentLevel >= def.max_level;
                  const isInstalling = Boolean(project);

                  return (
                    <div key={def.upgrade_key} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, padding: 16, background: "var(--bg-primary)", borderRadius: 8 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: "1.05rem", marginBottom: 4 }}>{def.display_name}</div>
                        <div style={{ fontSize: "0.8rem", color: "var(--accent-blue)", marginBottom: 8 }}>{def.immersive_label}</div>
                        <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: 8 }}>{def.description}</div>
                        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: "0.8rem", color: "var(--text-muted)" }}>
                          <span><strong>Level:</strong> {currentLevel} {def.max_level ? `/ ${def.max_level}` : ""}</span>
                          <span><strong>Current:</strong> {preview.currentEffectDisplay}</span>
                          {!isMaxed && <span><strong>Next:</strong> {preview.nextEffectDisplay}</span>}
                          {!isMaxed && <span><strong>Next Cost:</strong> {formatCurrency(preview.nextCost)}</span>}
                          <span><strong>Install:</strong> {formatInstallTimeMinutes(def.install_time_minutes)}</span>
                          <span><strong>Downtime:</strong> {formatLabel(def.downtime_policy)}</span>
                          <span><strong>Stage:</strong> {formatLabel(def.stage)}</span>
                        </div>
                        {project && (
                          <div style={{ marginTop: 10, fontSize: "0.8rem", color: "#93c5fd" }}>
                            Project in progress for level {project.target_level}. Completion target: {project.completes_at ? new Date(project.completes_at).toLocaleString() : "pending"}.
                          </div>
                        )}
                      </div>
                      <div>
                        {!isMaxed && (
                          <button
                            onClick={() => purchaseUpgrade(def.upgrade_key)}
                            disabled={busy || isInstalling || Boolean(activeUpgradeProject)}
                            style={{ padding: "8px 16px", fontWeight: 600 }}
                          >
                            {isInstalling ? "Installing" : "Fund Project"}
                          </button>
                        )}
                        {isMaxed && (
                          <span style={{ color: "var(--text-muted)", fontSize: "0.9rem", fontWeight: 600 }}>Max Level</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>No upgrades available for this business.</p>
            )}
          </div>
        )}

        {activeTab === "options" && (
          <BusinessOptionsPanel
            businessName={business.name}
            busy={busy}
            onRename={renameBusiness}
            onDelete={removeBusiness}
          />
        )}
      </div>
    </div>
  );
}
