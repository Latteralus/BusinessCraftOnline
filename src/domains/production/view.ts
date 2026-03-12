import {
  EXTRACTION_BASE_OUTPUT_PER_TICK_BY_BUSINESS,
  EXTRACTION_MISSING_TOOL_OUTPUT_MULTIPLIER_BY_BUSINESS,
  EXTRACTION_OUTPUT_ITEM_BY_BUSINESS,
  EXTRACTION_REQUIRED_TOOL_BY_BUSINESS,
} from "@/config/production";
import type { BusinessInventoryItem } from "@/domains/inventory";
import type { ManufacturingStatusView, ProductionStatus } from "./types";

type ManufacturingLineView = NonNullable<ManufacturingStatusView["lines"]>[number];
type ExtractionSlotView = NonNullable<ProductionStatus["slots"]>[number];

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

export function hasOperationalExtractionTool(
  slot: ExtractionSlotView,
  businessType: ProductionStatus["businessType"]
) {
  const requiredTool =
    EXTRACTION_REQUIRED_TOOL_BY_BUSINESS[
      businessType as keyof typeof EXTRACTION_REQUIRED_TOOL_BY_BUSINESS
    ];
  return (
    !requiredTool ||
    (slot.tool_item_key === requiredTool &&
      slot.tool?.item_type === requiredTool &&
      (slot.tool?.uses_remaining ?? 0) > 0)
  );
}

export function getExtractionSlotThroughput(
  slot: ExtractionSlotView,
  businessType: ProductionStatus["businessType"]
) {
  if (slot.status !== "active") return 0;
  if (hasOperationalExtractionTool(slot, businessType)) {
    return (
      EXTRACTION_BASE_OUTPUT_PER_TICK_BY_BUSINESS[
        businessType as keyof typeof EXTRACTION_BASE_OUTPUT_PER_TICK_BY_BUSINESS
      ] ?? 1
    );
  }
  return (
    EXTRACTION_MISSING_TOOL_OUTPUT_MULTIPLIER_BY_BUSINESS[
      businessType as keyof typeof EXTRACTION_MISSING_TOOL_OUTPUT_MULTIPLIER_BY_BUSINESS
    ] ?? 0
  );
}

export function buildExtractionOperationsView(production: ProductionStatus) {
  const throughputPerMinute = production.slots.reduce(
    (sum, slot) => sum + getExtractionSlotThroughput(slot, production.businessType),
    0
  );
  const degradedSlots = production.slots.filter(
    (slot) =>
      slot.status === "active" &&
      getExtractionSlotThroughput(slot, production.businessType) > 0 &&
      !hasOperationalExtractionTool(slot, production.businessType)
  ).length;

  return {
    throughputPerMinute,
    degradedSlots,
    outputItemKey:
      EXTRACTION_OUTPUT_ITEM_BY_BUSINESS[
        production.businessType as keyof typeof EXTRACTION_OUTPUT_ITEM_BY_BUSINESS
      ],
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
