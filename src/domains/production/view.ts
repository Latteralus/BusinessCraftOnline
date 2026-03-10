import type { BusinessInventoryItem } from "@/domains/inventory";
import type { ManufacturingStatusView } from "./types";

type ManufacturingLineView = NonNullable<ManufacturingStatusView["lines"]>[number];

export function summarizeManufacturingLines(
  lines: ManufacturingLineView[]
): ManufacturingStatusView["summary"] {
  return {
    total: lines.length,
    active: lines.filter((line) => line.status === "active").length,
    idle: lines.filter((line) => line.status === "idle").length,
    resting: lines.filter((line) => line.status === "resting").length,
    retooling: lines.filter((line) => line.status === "retooling").length,
    occupied: lines.filter((line) => Boolean(line.employee_id)).length,
  };
}

export function getLeadManufacturingLine(
  manufacturing: ManufacturingStatusView
): ManufacturingLineView | null {
  return (
    manufacturing.lines.find((line) => line.status === "active") ??
    manufacturing.lines.find((line) => line.configured_recipe) ??
    manufacturing.lines[0] ??
    null
  );
}

export function buildManufacturingOperationsView(
  manufacturing: ManufacturingStatusView,
  inventory: BusinessInventoryItem[]
) {
  const leadLine = getLeadManufacturingLine(manufacturing);
  const recipe = leadLine?.configured_recipe ?? null;
  const finishedOutputKeys = new Set(
    manufacturing.lines
      .map((line) => line.configured_recipe?.outputItemKey ?? null)
      .filter((itemKey): itemKey is string => Boolean(itemKey))
  );
  const finishedInventoryUnits = inventory
    .filter((row) => finishedOutputKeys.has(row.item_key))
    .reduce((sum, row) => sum + Math.max(0, row.quantity - row.reserved_quantity), 0);
  const perMinute = leadLine?.status === "active" && recipe ? recipe.baseOutputQuantity : 0;
  const inputCoverage = recipe
    ? recipe.inputs.map((input) => {
        const available = inventory
          .filter((row) => row.item_key === input.itemKey)
          .reduce((sum, row) => sum + Math.max(0, row.quantity - row.reserved_quantity), 0);
        return {
          itemKey: input.itemKey,
          available,
          required: input.quantity,
          coverageMinutes: input.quantity > 0 ? Math.floor(available / input.quantity) : 0,
        };
      })
    : [];
  const bottleneck =
    inputCoverage.slice().sort((a, b) => a.coverageMinutes - b.coverageMinutes)[0] ?? null;

  return {
    leadLine,
    recipe,
    finishedInventoryUnits,
    perMinute,
    inputCoverage,
    bottleneck,
    workerReady: Boolean(leadLine?.employee_id),
  };
}
