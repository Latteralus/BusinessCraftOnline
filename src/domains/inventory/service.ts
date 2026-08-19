import { calculateShippingQuote, getCityById } from "@/domains/cities-travel";
import { toNumber } from "@/lib/core/number";
import { nowIso } from "@/lib/core/time";
import type { QueryClient } from "@/lib/db/query-client";
import type {
  BusinessInventoryItem,
  PersonalInventoryItem,
  ShippingQueueItem,
  TransferItemsInput,
  TransferOutcome,
} from "./types";

function normalizePersonalRow(row: PersonalInventoryItem): PersonalInventoryItem {
  return {
    ...row,
    quantity: toNumber(row.quantity),
    quality: toNumber(row.quality),
  };
}

function normalizeBusinessRow(row: BusinessInventoryItem): BusinessInventoryItem {
  return {
    ...row,
    quantity: toNumber(row.quantity),
    quality: toNumber(row.quality),
    reserved_quantity: toNumber(row.reserved_quantity),
    unit_cost: row.unit_cost === undefined || row.unit_cost === null ? null : toNumber(row.unit_cost),
    total_cost: row.total_cost === undefined || row.total_cost === null ? null : toNumber(row.total_cost),
  };
}

function normalizeShippingRow(row: ShippingQueueItem): ShippingQueueItem {
  return {
    ...row,
    quality: toNumber(row.quality),
    quantity: toNumber(row.quantity),
    cost: toNumber(row.cost),
    declared_unit_price:
      row.declared_unit_price === undefined || row.declared_unit_price === null
        ? null
        : toNumber(row.declared_unit_price),
  };
}

export async function reconcileBusinessInventoryReservations(
  client: QueryClient,
  playerId: string,
  businessId?: string
): Promise<void> {
  let inventoryQuery = client
    .from("business_inventory")
    .select("id, business_id, item_key, quality, quantity, reserved_quantity")
    .eq("owner_player_id", playerId);

  let listingsQuery = client
    .from("market_listings")
    .select("source_business_id, item_key, quality, quantity, reserved_quantity")
    .eq("owner_player_id", playerId)
    .eq("status", "active");

  let shelvesQuery = client
    .from("store_shelf_items")
    .select("business_id, item_key, quality, quantity")
    .eq("owner_player_id", playerId);

  if (businessId) {
    inventoryQuery = inventoryQuery.eq("business_id", businessId);
    listingsQuery = listingsQuery.eq("source_business_id", businessId);
    shelvesQuery = shelvesQuery.eq("business_id", businessId);
  }

  const [inventoryResult, listingsResult, shelvesResult] = await Promise.all([
    inventoryQuery,
    listingsQuery,
    shelvesQuery,
  ]);

  if (inventoryResult.error) throw inventoryResult.error;
  if (listingsResult.error) throw listingsResult.error;
  if (shelvesResult.error) throw shelvesResult.error;

  const reservedByKey = new Map<string, number>();
  const makeKey = (row: { business_id: string; item_key: string; quality: number | string }) =>
    `${row.business_id}:${row.item_key}:${toNumber(row.quality)}`;

  for (const row of (shelvesResult.data as Array<{
    business_id: string;
    item_key: string;
    quality: number | string;
    quantity: number | string;
  }>) ?? []) {
    const key = makeKey(row);
    reservedByKey.set(key, (reservedByKey.get(key) ?? 0) + Math.max(0, toNumber(row.quantity)));
  }

  for (const row of (listingsResult.data as Array<{
    source_business_id: string | null;
    item_key: string;
    quality: number | string;
    quantity: number | string;
    reserved_quantity: number | string;
  }>) ?? []) {
    if (!row.source_business_id) continue;
    const key = `${row.source_business_id}:${row.item_key}:${toNumber(row.quality)}`;
    const committed = Math.max(0, Math.min(toNumber(row.quantity), toNumber(row.reserved_quantity)));
    reservedByKey.set(key, (reservedByKey.get(key) ?? 0) + committed);
  }

  const updates = ((inventoryResult.data as Array<{
    id: string;
    business_id: string;
    item_key: string;
    quality: number | string;
    quantity: number | string;
    reserved_quantity: number | string;
  }>) ?? [])
    .map((row) => {
      const quantity = Math.max(0, toNumber(row.quantity));
      const expectedReserved = Math.max(0, Math.min(quantity, reservedByKey.get(makeKey(row)) ?? 0));
      const currentReserved = Math.max(0, toNumber(row.reserved_quantity));
      if (currentReserved === expectedReserved) return null;
      return client
        .from("business_inventory")
        .update({
          reserved_quantity: expectedReserved,
          updated_at: nowIso(),
        })
        .eq("id", row.id);
    })
    .filter((operation): operation is Promise<{ error: unknown }> => Boolean(operation));

  if (updates.length === 0) return;

  const results = await Promise.all(updates);
  for (const result of results) {
    if (result.error) throw result.error;
  }
}

// Bounded defaults so a player's full inventory (every item/quality tier,
// across every business) can't become an unbounded result set. Resolves
// audit finding M1.
const PERSONAL_INVENTORY_DEFAULT_LIMIT = 1000;
const BUSINESS_INVENTORY_DEFAULT_LIMIT = 2000;

export async function getPersonalInventory(
  client: QueryClient,
  playerId: string,
  limit: number = PERSONAL_INVENTORY_DEFAULT_LIMIT
): Promise<PersonalInventoryItem[]> {
  const { data, error } = await client
    .from("personal_inventory")
    .select("*")
    .eq("player_id", playerId)
    .order("item_key", { ascending: true })
    .order("quality", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return ((data as PersonalInventoryItem[]) ?? []).map(normalizePersonalRow);
}

export async function getBusinessInventory(
  client: QueryClient,
  playerId: string,
  businessId?: string,
  limit: number = BUSINESS_INVENTORY_DEFAULT_LIMIT
): Promise<BusinessInventoryItem[]> {
  let query = client
    .from("business_inventory")
    .select("*")
    .eq("owner_player_id", playerId)
    .order("business_id", { ascending: true })
    .order("item_key", { ascending: true })
    .order("quality", { ascending: false })
    .limit(limit);

  if (businessId) {
    query = query.eq("business_id", businessId);
  }

  const { data, error } = await query;
  if (error) throw error;

  return ((data as BusinessInventoryItem[]) ?? []).map(normalizeBusinessRow);
}

export async function getShippingQueue(
  client: QueryClient,
  playerId: string
): Promise<ShippingQueueItem[]> {
  const { data, error } = await client
    .from("shipping_queue")
    .select("*")
    .eq("owner_player_id", playerId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;
  return ((data as ShippingQueueItem[]) ?? []).map(normalizeShippingRow);
}

async function resolveShippingPlan(client: QueryClient, input: TransferItemsInput) {
  if (!input.sourceCityId || !input.destinationCityId) {
    throw new Error("Source and destination city ids are required for shipping decisions.");
  }

  if (input.sourceCityId === input.destinationCityId) {
    return {
      transferType: "same_city" as const,
      shippingCost: 0,
      shippingMinutes: 0,
    };
  }

  const [sourceCity, destinationCity] = await Promise.all([
    getCityById(client, input.sourceCityId),
    getCityById(client, input.destinationCityId),
  ]);

  if (!sourceCity || !destinationCity) {
    throw new Error("Source or destination city does not exist.");
  }

  const quote = calculateShippingQuote(sourceCity, destinationCity, input.quantity);

  return {
    transferType: "shipping" as const,
    shippingCost: quote.totalCost,
    shippingMinutes: quote.minutes,
  };
}

export async function transferItems(
  client: QueryClient,
  playerId: string,
  input: TransferItemsInput
): Promise<TransferOutcome> {
  if (input.sourceType === "business" && input.sourceBusinessId) {
    await reconcileBusinessInventoryReservations(client, playerId, input.sourceBusinessId);
  }

  const shippingPlan = await resolveShippingPlan(client, input);

  const { data, error } = await client.rpc("execute_inventory_transfer", {
    p_source_type: input.sourceType,
    p_source_business_id: input.sourceBusinessId ?? null,
    p_source_city_id: input.sourceCityId ?? null,
    p_destination_type: input.destinationType,
    p_destination_business_id: input.destinationBusinessId ?? null,
    p_destination_city_id: input.destinationCityId ?? null,
    p_item_key: input.itemKey,
    p_quality: input.quality,
    p_quantity: input.quantity,
    p_shipping_cost: shippingPlan.shippingCost,
    p_shipping_minutes: shippingPlan.shippingMinutes,
    p_funding_account_id: input.fundingAccountId ?? null,
    p_unit_price: input.unitPrice ?? null,
  });

  if (error) throw error;

  const result = data as {
    transferType?: "same_city" | "shipping";
    shippingQueueItem?: ShippingQueueItem | null;
    shippingCost?: number;
    shippingMinutes?: number;
  } | null;

  if (!result?.transferType) {
    throw new Error("Transfer did not return a valid result.");
  }

  // execute_inventory_transfer (migration 106) now does the entire economic
  // transaction atomically for business-to-business transfers -- source
  // relief, destination acquisition cost basis, cash movement, and every
  // revenue/COGS/inventory financial event -- in one transaction. There is
  // no post-RPC accounting step left to perform here.

  return {
    transferType: result.transferType,
    shippingQueueItem: result.shippingQueueItem ? normalizeShippingRow(result.shippingQueueItem) : null,
    shippingCost: toNumber(result.shippingCost),
    shippingMinutes: toNumber(result.shippingMinutes),
  };
}
