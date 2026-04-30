import type { QueryClient } from "@/lib/db/query-client";
import { toNumber } from "@/lib/core/number";
import type {
  RemoveStoreShelfItemInput,
  StoreShelfItem,
  StoreShelfItemFilter,
  UpsertStoreShelfItemInput,
} from "./types";

function normalizeStoreShelfItem(row: StoreShelfItem): StoreShelfItem {
  return {
    ...row,
    quality: Number(row.quality),
    quantity: Number(row.quantity),
    unit_price: toNumber(row.unit_price),
  };
}

export async function getStoreShelfItems(
  client: QueryClient,
  playerId: string,
  filter: StoreShelfItemFilter = {}
): Promise<StoreShelfItem[]> {
  let query = client
    .from("store_shelf_items")
    .select("*")
    .eq("owner_player_id", playerId)
    .order("created_at", { ascending: false });

  if (filter.businessId) {
    query = query.eq("business_id", filter.businessId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return ((data as StoreShelfItem[]) ?? []).map(normalizeStoreShelfItem);
}

export async function upsertStoreShelfItem(
  client: QueryClient,
  playerId: string,
  input: UpsertStoreShelfItemInput
): Promise<StoreShelfItem> {
  const { data, error } = await client.rpc("upsert_store_shelf_item_atomic", {
    p_player_id: playerId,
    p_business_id: input.businessId,
    p_item_key: input.itemKey,
    p_quality: input.quality,
    p_quantity: input.quantity,
    p_unit_price: input.unitPrice,
  });

  if (error) throw error;
  if (!data) throw new Error("Shelf item was not saved.");
  return normalizeStoreShelfItem(data as StoreShelfItem);
}

export async function removeStoreShelfItem(
  client: QueryClient,
  playerId: string,
  input: RemoveStoreShelfItemInput
): Promise<void> {
  const { error } = await client.rpc("remove_store_shelf_item_atomic", {
    p_player_id: playerId,
    p_shelf_item_id: input.shelfItemId,
  });

  if (error) throw error;
}
