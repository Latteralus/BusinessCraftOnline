import { SHIPPING_COST_PER_UNIT_BY_TIER } from "@/config/cities";
import { calculateTravelQuote, getCityById } from "@/domains/cities-travel";
import type {
  BusinessInventoryItem,
  PersonalInventoryItem,
  ShippingQueueItem,
  TransferItemsInput,
  TransferOutcome,
} from "./types";

type QueryClient = {
  from: (table: string) => any;
};

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

function shippingDestinationId(playerId: string, input: TransferItemsInput): string {
  if (input.destinationType === "personal") {
    return playerId;
  }

  if (!input.destinationBusinessId) {
    throw new Error("Destination business id is required for business destination.");
  }

  return input.destinationBusinessId;
}

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

async function decreasePersonalInventory(
  client: QueryClient,
  playerId: string,
  itemKey: string,
  quality: number,
  quantity: number
) {
  const { data, error } = await client
    .from("personal_inventory")
    .select("*")
    .eq("player_id", playerId)
    .eq("item_key", itemKey)
    .eq("quality", quality)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Source personal inventory item not found.");

  const row = normalizePersonalRow(data as PersonalInventoryItem);
  if (row.quantity < quantity) {
    throw new Error("Insufficient quantity in personal inventory.");
  }

  const remaining = row.quantity - quantity;

  if (remaining <= 0) {
    const { error: deleteError } = await client
      .from("personal_inventory")
      .delete()
      .eq("id", row.id)
      .eq("player_id", playerId);

    if (deleteError) throw deleteError;
    return;
  }

  const { error: updateError } = await client
    .from("personal_inventory")
    .update({ quantity: remaining, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("player_id", playerId);

  if (updateError) throw updateError;
}

async function increasePersonalInventory(
  client: QueryClient,
  playerId: string,
  itemKey: string,
  quality: number,
  quantity: number
) {
  const { data, error } = await client
    .from("personal_inventory")
    .select("*")
    .eq("player_id", playerId)
    .eq("item_key", itemKey)
    .eq("quality", quality)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    const { error: insertError } = await client.from("personal_inventory").insert({
      player_id: playerId,
      item_key: itemKey,
      quantity,
      quality,
    });

    if (insertError) throw insertError;
    return;
  }

  const row = normalizePersonalRow(data as PersonalInventoryItem);
  const { error: updateError } = await client
    .from("personal_inventory")
    .update({ quantity: row.quantity + quantity, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("player_id", playerId);

  if (updateError) throw updateError;
}

async function decreaseBusinessInventory(
  client: QueryClient,
  playerId: string,
  businessId: string,
  itemKey: string,
  quality: number,
  quantity: number
) {
  const { data, error } = await client
    .from("business_inventory")
    .select("*")
    .eq("owner_player_id", playerId)
    .eq("business_id", businessId)
    .eq("item_key", itemKey)
    .eq("quality", quality)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Source business inventory item not found.");

  const row = normalizeBusinessRow(data as BusinessInventoryItem);
  const available = row.quantity - row.reserved_quantity;

  if (available < quantity) {
    throw new Error("Insufficient available quantity in business inventory.");
  }

  const remaining = row.quantity - quantity;

  if (remaining <= 0) {
    const { error: deleteError } = await client
      .from("business_inventory")
      .delete()
      .eq("id", row.id)
      .eq("owner_player_id", playerId);

    if (deleteError) throw deleteError;
    return;
  }

  const reservedAfter = Math.min(row.reserved_quantity, remaining);
  const { error: updateError } = await client
    .from("business_inventory")
    .update({
      quantity: remaining,
      reserved_quantity: reservedAfter,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("owner_player_id", playerId);

  if (updateError) throw updateError;
}

async function increaseBusinessInventory(
  client: QueryClient,
  playerId: string,
  businessId: string,
  cityId: string,
  itemKey: string,
  quality: number,
  quantity: number
) {
  const { data, error } = await client
    .from("business_inventory")
    .select("*")
    .eq("owner_player_id", playerId)
    .eq("business_id", businessId)
    .eq("item_key", itemKey)
    .eq("quality", quality)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    const { error: insertError } = await client.from("business_inventory").insert({
      owner_player_id: playerId,
      business_id: businessId,
      city_id: cityId,
      item_key: itemKey,
      quantity,
      quality,
      reserved_quantity: 0,
    });

    if (insertError) throw insertError;
    return;
  }

  const row = normalizeBusinessRow(data as BusinessInventoryItem);
  const { error: updateError } = await client
    .from("business_inventory")
    .update({ quantity: row.quantity + quantity, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("owner_player_id", playerId);

  if (updateError) throw updateError;
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

  const sourceBusinessId = input.sourceBusinessId;
  const destinationBusinessId = input.destinationBusinessId;

  if (input.sourceType === "personal") {
    await decreasePersonalInventory(client, playerId, input.itemKey, input.quality, input.quantity);
  } else {
    if (!sourceBusinessId) {
      throw new Error("Source business id is required for business source.");
    }

    await decreaseBusinessInventory(
      client,
      playerId,
      sourceBusinessId,
      input.itemKey,
      input.quality,
      input.quantity
    );
  }

  if (shippingPlan.transferType === "same_city") {
    if (input.destinationType === "personal") {
      await increasePersonalInventory(client, playerId, input.itemKey, input.quality, input.quantity);
    } else {
      if (!destinationBusinessId || !input.destinationCityId) {
        throw new Error("Destination business and city are required for business destination.");
      }

      await increaseBusinessInventory(
        client,
        playerId,
        destinationBusinessId,
        input.destinationCityId,
        input.itemKey,
        input.quality,
        input.quantity
      );
    }

    return {
      transferType: "same_city",
      shippingQueueItem: null,
      shippingCost: 0,
      shippingMinutes: 0,
    };
  }

  if (!input.sourceCityId || !input.destinationCityId) {
    throw new Error("Source and destination city ids are required for cross-city shipping.");
  }

  const dispatchedAt = new Date();
  const arrivesAt = new Date(dispatchedAt.getTime() + shippingPlan.shippingMinutes * 60_000);

  const { data, error } = await client
    .from("shipping_queue")
    .insert({
      owner_player_id: playerId,
      from_city_id: input.sourceCityId,
      to_city_id: input.destinationCityId,
      item_key: input.itemKey,
      quantity: input.quantity,
      cost: shippingPlan.shippingCost,
      dispatched_at: dispatchedAt.toISOString(),
      arrives_at: arrivesAt.toISOString(),
      destination_type: input.destinationType,
      destination_id: shippingDestinationId(playerId, input),
      status: "in_transit",
    })
    .select("*")
    .single();

  if (error) throw error;

  return {
    transferType: "shipping",
    shippingQueueItem: normalizeShippingRow(data as ShippingQueueItem),
    shippingCost: shippingPlan.shippingCost,
    shippingMinutes: shippingPlan.shippingMinutes,
  };
}
