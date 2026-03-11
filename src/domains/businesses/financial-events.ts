import { DEFAULT_INVENTORY_UNIT_COST, INVENTORY_BASELINE_UNIT_COSTS } from "@/config/finance";
import { round2, toNumber } from "@/lib/core/number";
import type { QueryClient } from "@/lib/db/query-client";

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
  account_code: "inventory" | "cogs" | "revenue" | "operating_expense" | "owner_equity" | "owner_draw";
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
  const quantity = Math.max(0, toNumber(row.quantity));
  const used = Math.min(quantityToConsume, quantity);
  const { unitCost, estimated } = getRowUnitCost(row);
  const consumedTotalCost = round2(used * unitCost);
  const nextQuantity = quantity - used;
  const nextReserved = Math.min(toNumber(row.reserved_quantity), nextQuantity);

  if (nextQuantity <= 0) {
    const { error: deleteError } = await client.from("business_inventory").delete().eq("id", row.id);
    if (deleteError) throw deleteError;
  } else {
    const { error: updateError } = await client
      .from("business_inventory")
      .update({
        quantity: nextQuantity,
        reserved_quantity: nextReserved,
        unit_cost: unitCost,
        total_cost: round2(nextQuantity * unitCost),
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (updateError) throw updateError;
  }

  return { totalCost: consumedTotalCost, itemKey: row.item_key, quantity: used, estimated };
}

export async function consumeBusinessInventoryCost(
  client: QueryClient,
  playerId: string,
  businessId: string,
  itemKey: string,
  quantityToConsume: number
): Promise<{ totalCost: number; quantityConsumed: number; estimated: boolean }> {
  const { data, error } = await client
    .from("business_inventory")
    .select("id, owner_player_id, business_id, item_key, quality, quantity, reserved_quantity, unit_cost, total_cost")
    .eq("owner_player_id", playerId)
    .eq("business_id", businessId)
    .eq("item_key", itemKey)
    .order("quality", { ascending: false });
  if (error) throw error;

  const rows = (data as InventoryRow[]) ?? [];
  let remaining = quantityToConsume;
  let totalCost = 0;
  let estimated = false;

  for (const row of rows) {
    if (remaining <= 0) break;
    const quantity = Math.max(0, toNumber(row.quantity) - toNumber(row.reserved_quantity));
    if (quantity <= 0) continue;
    const used = Math.min(remaining, quantity);
    const result = await consumeInventoryCostByRowId(client, row.id, used);
    totalCost = round2(totalCost + result.totalCost);
    estimated = estimated || result.estimated;
    remaining -= used;
  }

  return {
    totalCost,
    quantityConsumed: quantityToConsume - remaining,
    estimated,
  };
}

export async function insertBusinessFinancialEvents(
  client: QueryClient,
  playerId: string,
  rows: NewBusinessFinancialEvent[]
): Promise<void> {
  if (rows.length === 0) return;
  for (const row of rows) {
    const { error } = await client.rpc("append_business_financial_event", {
      p_player_id: playerId,
      p_business_id: row.business_id,
      p_account_code: row.account_code,
      p_amount: round2(Math.abs(row.amount)),
      p_quantity: row.quantity ?? null,
      p_item_key: row.item_key ?? null,
      p_reference_type: row.reference_type ?? null,
      p_reference_id: row.reference_id ?? null,
      p_description: row.description,
      p_effective_at: row.effective_at ?? new Date().toISOString(),
      p_metadata: row.metadata ?? {},
    });

    if (error) throw error;
  }
}
