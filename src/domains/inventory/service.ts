import { SHIPPING_COST_PER_UNIT_BY_TIER } from "@/config/cities";
import { calculateTravelQuote, getCityById } from "@/domains/cities-travel";
import { toNumber } from "@/lib/core/number";
import type {
  BusinessInventoryItem,
  PersonalInventoryItem,
  ShippingQueueItem,
  TransferItemsInput,
  TransferOutcome,
} from "./types";

type QueryClient = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

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
  };
}

function normalizeShippingRow(row: ShippingQueueItem): ShippingQueueItem {
  return {
    ...row,
    quantity: toNumber(row.quantity),
    cost: toNumber(row.cost),
  };
}

export async function getPersonalInventory(
  client: QueryClient,
  playerId: string
): Promise<PersonalInventoryItem[]> {
  const { data, error } = await client
    .from("personal_inventory")
    .select("*")
    .eq("player_id", playerId)
    .order("item_key", { ascending: true })
    .order("quality", { ascending: false });

  if (error) throw error;
  return ((data as PersonalInventoryItem[]) ?? []).map(normalizePersonalRow);
}

export async function getBusinessInventory(
  client: QueryClient,
  playerId: string,
  businessId?: string
): Promise<BusinessInventoryItem[]> {
  let query = client
    .from("business_inventory")
    .select("*")
    .eq("owner_player_id", playerId)
    .order("business_id", { ascending: true })
    .order("item_key", { ascending: true })
    .order("quality", { ascending: false });

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

  const quote = calculateTravelQuote(sourceCity, destinationCity);
  const costPerUnit = SHIPPING_COST_PER_UNIT_BY_TIER[quote.tier];

  return {
    transferType: "shipping" as const,
    shippingCost: Number((input.quantity * costPerUnit).toFixed(2)),
    shippingMinutes: quote.minutes,
  };
}

export async function transferItems(
  client: QueryClient,
  playerId: string,
  input: TransferItemsInput
): Promise<TransferOutcome> {
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

  return {
    transferType: result.transferType,
    shippingQueueItem: result.shippingQueueItem ? normalizeShippingRow(result.shippingQueueItem) : null,
    shippingCost: toNumber(result.shippingCost),
    shippingMinutes: toNumber(result.shippingMinutes),
  };
}