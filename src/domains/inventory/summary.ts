import type { StoreShelfItem } from "@/domains/stores";
import type { BusinessInventoryItem } from "./types";

export type BusinessInventorySummary = {
  availableUnits: number;
  reservedUnits: number;
  totalUnits: number;
  shelfUnits: number;
  backroomUnits: number;
  shelfFill: number;
  reserveLoad: number;
  freeFlow: number;
};

export function summarizeBusinessInventory(
  inventory: BusinessInventoryItem[],
  shelfItems: StoreShelfItem[] = []
): BusinessInventorySummary {
  const availableUnits = inventory.reduce(
    (sum, row) => sum + Math.max(0, row.quantity - row.reserved_quantity),
    0
  );
  const reservedUnits = inventory.reduce((sum, row) => sum + Math.max(0, row.reserved_quantity), 0);
  const totalUnits = inventory.reduce((sum, row) => sum + Math.max(0, row.quantity), 0);
  const shelfUnits = shelfItems.reduce((sum, row) => sum + Math.max(0, row.quantity), 0);
  const backroomUnits = availableUnits;
  const stagedAndBackroomUnits = shelfUnits + backroomUnits;

  return {
    availableUnits,
    reservedUnits,
    totalUnits,
    shelfUnits,
    backroomUnits,
    shelfFill: stagedAndBackroomUnits > 0 ? shelfUnits / stagedAndBackroomUnits : 0,
    reserveLoad: totalUnits > 0 ? reservedUnits / totalUnits : 0,
    freeFlow: totalUnits > 0 ? availableUnits / totalUnits : 0,
  };
}
