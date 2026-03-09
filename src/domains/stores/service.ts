import { isStoreBusinessType } from "@/config/businesses";
import { ensureOwnedBusinessType } from "@/domains/_shared/ownership";
import type { QueryClient } from "@/lib/db/query-client";
import type {
  RemoveStoreShelfItemInput,
  StoreShelfItem,
  StoreShelfItemFilter,
  UpsertStoreShelfItemInput,
} from "./types";

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

function normalizeStoreShelfItem(row: StoreShelfItem): StoreShelfItem {
  return {
    ...row,
    quality: Number(row.quality),
    quantity: Number(row.quantity),
    unit_price: toNumber(row.unit_price),
  };
}

async function getOwnedShelfItem(client: QueryClient, playerId: string, shelfItemId: string): Promise<StoreShelfItem> {
  const { data, error } = await client
    .from("store_shelf_items")
    .select("*")
    .eq("owner_player_id", playerId)
    .eq("id", shelfItemId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Shelf item not found.");
  return normalizeStoreShelfItem(data as StoreShelfItem);
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
  const business = await ensureOwnedBusinessType(
    client,
    playerId,
    input.businessId,
    isStoreBusinessType,
    () => "Only store businesses can stock shelf items."
  );

  const { data: inventoryRow, error: inventoryError } = await client
    .from("business_inventory")
    .select("id, quantity, reserved_quantity")
    .eq("owner_player_id", playerId)
    .eq("business_id", business.id)
    .eq("item_key", input.itemKey)
    .eq("quality", input.quality)
    .maybeSingle();

  if (inventoryError) throw inventoryError;
  if (!inventoryRow) throw new Error("Business inventory item not found for requested shelf item.");

  const { data: existingShelfRow, error: existingShelfError } = await client
    .from("store_shelf_items")
    .select("*")
    .eq("owner_player_id", playerId)
    .eq("business_id", business.id)
    .eq("item_key", input.itemKey)
    .eq("quality", input.quality)
    .maybeSingle();

  if (existingShelfError) throw existingShelfError;

  const inventoryQuantity = toNumber(inventoryRow.quantity);
  const inventoryReserved = toNumber(inventoryRow.reserved_quantity);
  const existingShelfQuantity = existingShelfRow ? toNumber(existingShelfRow.quantity) : 0;
  const delta = input.quantity - existingShelfQuantity;
  const availableOutsideShelf = inventoryQuantity - inventoryReserved;

  if (delta > availableOutsideShelf) {
    throw new Error("Not enough available inventory to stock that many items on the shelf.");
  }

  const { error: reserveError } = await client
    .from("business_inventory")
    .update({
      reserved_quantity: Math.max(0, Math.min(inventoryQuantity, inventoryReserved + delta)),
      updated_at: new Date().toISOString(),
    })
    .eq("id", inventoryRow.id);

  if (reserveError) throw reserveError;

  if (existingShelfRow) {
    const { data, error } = await client
      .from("store_shelf_items")
      .update({
        quantity: input.quantity,
        unit_price: input.unitPrice,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingShelfRow.id)
      .select("*")
      .single();

    if (error) throw error;
    return normalizeStoreShelfItem(data as StoreShelfItem);
  }

  const { data, error } = await client
    .from("store_shelf_items")
    .insert({
      owner_player_id: playerId,
      business_id: business.id,
      item_key: input.itemKey,
      quality: input.quality,
      quantity: input.quantity,
      unit_price: input.unitPrice,
    })
    .select("*")
    .single();

  if (error) throw error;
  return normalizeStoreShelfItem(data as StoreShelfItem);
}

export async function removeStoreShelfItem(
  client: QueryClient,
  playerId: string,
  input: RemoveStoreShelfItemInput
): Promise<void> {
  const shelfItem = await getOwnedShelfItem(client, playerId, input.shelfItemId);

  const { data: inventoryRow, error: inventoryError } = await client
    .from("business_inventory")
    .select("id, quantity, reserved_quantity")
    .eq("owner_player_id", playerId)
    .eq("business_id", shelfItem.business_id)
    .eq("item_key", shelfItem.item_key)
    .eq("quality", shelfItem.quality)
    .maybeSingle();

  if (inventoryError) throw inventoryError;

  if (inventoryRow) {
    const quantity = toNumber(inventoryRow.quantity);
    const reserved = toNumber(inventoryRow.reserved_quantity);
    const nextReserved = Math.max(0, Math.min(quantity, reserved - shelfItem.quantity));

    const { error: updateInventoryError } = await client
      .from("business_inventory")
      .update({
        reserved_quantity: nextReserved,
        updated_at: new Date().toISOString(),
      })
      .eq("id", inventoryRow.id);

    if (updateInventoryError) throw updateInventoryError;
  }

  const { error: deleteError } = await client.from("store_shelf_items").delete().eq("id", shelfItem.id);
  if (deleteError) throw deleteError;
}
