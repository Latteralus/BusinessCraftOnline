import { DEFAULT_INVENTORY_UNIT_COST, INVENTORY_BASELINE_UNIT_COSTS } from "@/config/finance";
import { round2, toNumber } from "@/lib/core/number";
import type { QueryClient } from "@/lib/db/query-client";
import { createSupabaseServiceRoleClient } from "@/lib/supabase-service-role";

type InventoryRow = {
  id: string;
  owner_player_id: string;
  business_id: string;
  item_key: string;
  quality: number | string;
  quantity: number | string;
  reserved_quantity: number | string;
  unit_cost?: number | string | null;
  total_cost?: number | string | null;
};

export type NewBusinessFinancialEvent = {
  business_id: string;
  account_code: "inventory" | "cogs" | "revenue" | "operating_expense" | "owner_equity" | "owner_draw" | "payroll_expense" | "wages_payable";
  amount: number;
  quantity?: number | null;
  item_key?: string | null;
  reference_type?: string | null;
  reference_id?: string | null;
  description: string;
  effective_at?: string;
  metadata?: Record<string, unknown> | null;
};

function getRowUnitCost(row: InventoryRow): { unitCost: number; totalCost: number; estimated: boolean } {
  const quantity = Math.max(0, toNumber(row.quantity));
  const explicitTotalCost = row.total_cost === undefined || row.total_cost === null ? null : toNumber(row.total_cost);
  const explicitUnitCost = row.unit_cost === undefined || row.unit_cost === null ? null : toNumber(row.unit_cost);

  if (explicitTotalCost !== null && explicitTotalCost > 0 && quantity > 0) {
    return { unitCost: round2(explicitTotalCost / quantity), totalCost: explicitTotalCost, estimated: false };
  }
  if (explicitUnitCost !== null && explicitUnitCost > 0) {
    return { unitCost: explicitUnitCost, totalCost: round2(quantity * explicitUnitCost), estimated: false };
  }
  const fallback = INVENTORY_BASELINE_UNIT_COSTS[row.item_key] ?? DEFAULT_INVENTORY_UNIT_COST;
  return { unitCost: fallback, totalCost: round2(quantity * fallback), estimated: true };
}

export function computeWeightedAverageCost(input: {
  existingQuantity: number;
  existingTotalCost: number;
  addedQuantity: number;
  addedUnitCost: number;
}) {
  const nextQuantity = Math.max(0, input.existingQuantity + input.addedQuantity);
  const nextTotalCost = round2(input.existingTotalCost + input.addedQuantity * input.addedUnitCost);
  const nextUnitCost = nextQuantity > 0 ? round2(nextTotalCost / nextQuantity) : 0;
  return {
    nextQuantity,
    nextTotalCost,
    nextUnitCost,
  };
}

function computeRowConsumption(row: InventoryRow, quantityToConsume: number) {
  const quantity = Math.max(0, toNumber(row.quantity));
  const used = Math.min(quantityToConsume, quantity);
  const { unitCost, estimated } = getRowUnitCost(row);
  const nextQuantity = quantity - used;
  return {
    used,
    unitCost,
    estimated,
    consumedTotalCost: round2(used * unitCost),
    nextQuantity,
    nextReserved: Math.min(toNumber(row.reserved_quantity), nextQuantity),
  };
}

async function writeRowConsumption(
  client: QueryClient,
  row: Pick<InventoryRow, "id">,
  consumption: ReturnType<typeof computeRowConsumption>
): Promise<void> {
  if (consumption.nextQuantity <= 0) {
    const { error } = await client.from("business_inventory").delete().eq("id", row.id);
    if (error) throw error;
  } else {
    const { error } = await client
      .from("business_inventory")
      .update({
        quantity: consumption.nextQuantity,
        reserved_quantity: consumption.nextReserved,
        unit_cost: consumption.unitCost,
        total_cost: round2(consumption.nextQuantity * consumption.unitCost),
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (error) throw error;
  }
}

export async function consumeInventoryCostByRowId(
  client: QueryClient,
  rowId: string,
  quantityToConsume: number
): Promise<{ totalCost: number; itemKey: string | null; quantity: number; estimated: boolean }> {
  const { data, error } = await client
    .from("business_inventory")
    .select("id, owner_player_id, business_id, item_key, quality, quantity, reserved_quantity, unit_cost, total_cost")
    .eq("id", rowId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    return { totalCost: 0, itemKey: null, quantity: quantityToConsume, estimated: true };
  }

  const row = data as InventoryRow;
  const consumption = computeRowConsumption(row, quantityToConsume);
  await writeRowConsumption(client, row, consumption);

  return { totalCost: consumption.consumedTotalCost, itemKey: row.item_key, quantity: consumption.used, estimated: consumption.estimated };
}

export async function previewInventoryCostByRowId(
  client: QueryClient,
  rowId: string,
  quantityToConsume: number
): Promise<{ totalCost: number; itemKey: string | null; quantity: number; unitCost: number; estimated: boolean }> {
  const { data, error } = await client
    .from("business_inventory")
    .select("id, owner_player_id, business_id, item_key, quality, quantity, reserved_quantity, unit_cost, total_cost")
    .eq("id", rowId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    return { totalCost: 0, itemKey: null, quantity: quantityToConsume, unitCost: 0, estimated: true };
  }

  const row = data as InventoryRow;
  const quantity = Math.max(0, toNumber(row.quantity));
  const used = Math.min(quantityToConsume, quantity);
  const { unitCost, estimated } = getRowUnitCost(row);

  return {
    totalCost: round2(used * unitCost),
    itemKey: row.item_key,
    quantity: used,
    unitCost,
    estimated,
  };
}

export async function refreshInventoryCostByRowId(
  client: QueryClient,
  rowId: string,
  unitCost: number
): Promise<void> {
  const { data, error } = await client
    .from("business_inventory")
    .select("id, quantity")
    .eq("id", rowId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return;

  const quantity = Math.max(0, toNumber((data as { quantity: number | string }).quantity));
  const { error: updateError } = await client
    .from("business_inventory")
    .update({
      unit_cost: unitCost,
      total_cost: round2(quantity * unitCost),
      updated_at: new Date().toISOString(),
    })
    .eq("id", rowId);
  if (updateError) throw updateError;
}

// Exported so a caller that needs to both check availability and (if
// sufficient) consume the same rows -- e.g. fulfillContract -- can fetch
// once and reuse the result for both, instead of hasEnoughInventory-style
// callers re-querying the same rows consumeBusinessInventoryCost is about to
// select again. Resolves audit finding L1 (Documents/SBAudit.md).
export async function loadBusinessInventoryRowsForItem(
  client: QueryClient,
  playerId: string,
  businessId: string,
  itemKey: string
): Promise<InventoryRow[]> {
  const { data, error } = await client
    .from("business_inventory")
    .select("id, owner_player_id, business_id, item_key, quality, quantity, reserved_quantity, unit_cost, total_cost")
    .eq("owner_player_id", playerId)
    .eq("business_id", businessId)
    .eq("item_key", itemKey)
    .order("quality", { ascending: false });
  if (error) throw error;

  return (data as InventoryRow[]) ?? [];
}

export function getAvailableInventoryQuantity(rows: InventoryRow[]): number {
  return rows.reduce((sum, row) => sum + Math.max(0, toNumber(row.quantity) - toNumber(row.reserved_quantity)), 0);
}

export async function consumeInventoryRowsCost(
  client: QueryClient,
  rows: InventoryRow[],
  quantityToConsume: number
): Promise<{ totalCost: number; quantityConsumed: number; estimated: boolean }> {
  let remaining = quantityToConsume;
  let totalCost = 0;
  let estimated = false;

  // rows were already fully loaded by the caller -- consume in-memory
  // instead of re-selecting each row by id before writing it (was one extra
  // select per quality tier on every sale/fulfillment). Resolves audit
  // finding M3 (Documents/SBAudit.md).
  for (const row of rows) {
    if (remaining <= 0) break;
    const available = Math.max(0, toNumber(row.quantity) - toNumber(row.reserved_quantity));
    if (available <= 0) continue;
    const used = Math.min(remaining, available);
    const consumption = computeRowConsumption(row, used);
    await writeRowConsumption(client, row, consumption);
    totalCost = round2(totalCost + consumption.consumedTotalCost);
    estimated = estimated || consumption.estimated;
    remaining -= used;
  }

  return {
    totalCost,
    quantityConsumed: quantityToConsume - remaining,
    estimated,
  };
}

export async function consumeBusinessInventoryCost(
  client: QueryClient,
  playerId: string,
  businessId: string,
  itemKey: string,
  quantityToConsume: number
): Promise<{ totalCost: number; quantityConsumed: number; estimated: boolean }> {
  const rows = await loadBusinessInventoryRowsForItem(client, playerId, businessId, itemKey);
  return consumeInventoryRowsCost(client, rows, quantityToConsume);
}

export async function insertBusinessFinancialEvents(
  client: QueryClient,
  playerId: string,
  rows: NewBusinessFinancialEvent[]
): Promise<void> {
  if (rows.length === 0) return;
  const effectiveAt = new Date().toISOString();

  // append_business_financial_event is restricted to service_role in Postgres
  // (players could otherwise POST directly to PostgREST with their own JWT
  // and fabricate revenue/COGS events to spoof their own finance dashboard),
  // so this must call it with a service-role client rather than `client`.
  const serviceRoleClient = createSupabaseServiceRoleClient();

  await Promise.all(rows.map(async (row) => {
    const { error } = await serviceRoleClient.rpc("append_business_financial_event", {
      p_player_id: playerId,
      p_business_id: row.business_id,
      p_account_code: row.account_code,
      p_amount: round2(Math.abs(row.amount)),
      p_quantity: row.quantity ?? null,
      p_item_key: row.item_key ?? null,
      p_reference_type: row.reference_type ?? null,
      p_reference_id: row.reference_id ?? null,
      p_description: row.description,
      p_effective_at: row.effective_at ?? effectiveAt,
      p_metadata: row.metadata ?? {},
    });

    if (error) throw error;
  }));
}
