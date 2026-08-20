// Municipal stockpile lazy-consumption math -- CityPlan Phase 3 ("Municipal
// Stockpiles"). City stock is physical government inventory, separate from
// NPC retail demand, and is deliberately never decremented by a per-minute
// write loop -- it's derived from elapsed-time math against a checkpoint
// (`stored_quantity` as of `last_materialized_at`). This module is the pure
// TS mirror of `materialize_city_stockpiles_due()` (migration 114); Postgres
// can't call TS directly, so that SQL function reimplements the same
// formulas for the actual write path, while this module lets app-side reads
// project a stockpile's *current* effective stock without forcing a fresh
// materialization write on every read. Keep both sides in sync by hand if
// the formula changes.

export function computeElapsedHours(lastMaterializedAtIso: string, nowIso: string): number {
  const lastMs = new Date(lastMaterializedAtIso).getTime();
  const nowMs = new Date(nowIso).getTime();
  return Math.max(0, (nowMs - lastMs) / (60 * 60 * 1000));
}

// rate = baseConsumptionPerHour * populationScale * city.municipalConsumptionIndex
//        * world.municipalConsumptionIndex * activeItemEventMultiplier
export function computeEffectiveConsumptionPerHour(
  baseConsumptionPerHour: number,
  populationScale: number,
  cityMunicipalConsumptionIndex: number,
  worldMunicipalConsumptionIndex: number,
  activeItemEventMultiplier = 1
): number {
  return (
    baseConsumptionPerHour *
    populationScale *
    cityMunicipalConsumptionIndex *
    worldMunicipalConsumptionIndex *
    activeItemEventMultiplier
  );
}

// currentStock = max(0, storedQuantity - elapsedHours * rate)
export function computeCurrentStock(
  storedQuantity: number,
  elapsedHours: number,
  effectiveConsumptionPerHour: number
): number {
  return Math.max(0, storedQuantity - elapsedHours * effectiveConsumptionPerHour);
}

export function computeNextReorderAt(
  currentStock: number,
  reorderPoint: number,
  effectiveConsumptionPerHour: number,
  nowIso: string
): string | null {
  if (currentStock <= reorderPoint) return nowIso;
  if (effectiveConsumptionPerHour > 0) {
    const hoursUntilReorder = (currentStock - reorderPoint) / effectiveConsumptionPerHour;
    return new Date(new Date(nowIso).getTime() + hoursUntilReorder * 60 * 60 * 1000).toISOString();
  }
  return null;
}

export type StockpileProjectionInput = {
  storedQuantity: number;
  lastMaterializedAtIso: string;
  baseConsumptionPerHour: number;
  populationScale: number;
  cityMunicipalConsumptionIndex: number;
  worldMunicipalConsumptionIndex: number;
  activeItemEventMultiplier?: number;
  nowIso?: string;
};

export type StockpileProjection = {
  currentStock: number;
  effectiveConsumptionPerHour: number;
};

// Read-time projection -- does not write anything. Actual persistence only
// happens via materialize_city_stockpiles_due, a delivery, or the daily
// government pass (see Documents/Plans/CityPlan.md, Phase 3's own list of
// valid materialization trigger points).
export function projectCurrentStock(input: StockpileProjectionInput): StockpileProjection {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const elapsedHours = computeElapsedHours(input.lastMaterializedAtIso, nowIso);
  const effectiveConsumptionPerHour = computeEffectiveConsumptionPerHour(
    input.baseConsumptionPerHour,
    input.populationScale,
    input.cityMunicipalConsumptionIndex,
    input.worldMunicipalConsumptionIndex,
    input.activeItemEventMultiplier ?? 1
  );

  return {
    currentStock: computeCurrentStock(input.storedQuantity, elapsedHours, effectiveConsumptionPerHour),
    effectiveConsumptionPerHour,
  };
}

export type StockpileStatus = "healthy" | "low" | "critical";

export function getStockpileStatus(
  currentStock: number,
  reorderPoint: number,
  criticalPoint: number
): StockpileStatus {
  if (currentStock <= criticalPoint) return "critical";
  if (currentStock <= reorderPoint) return "low";
  return "healthy";
}
