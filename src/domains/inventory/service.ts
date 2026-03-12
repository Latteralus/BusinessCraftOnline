import { randomUUID } from "node:crypto";
import { calculateShippingQuote, getCityById } from "@/domains/cities-travel";
import { computeWeightedAverageCost } from "@/domains/businesses/financial-events";
import { insertBusinessFinancialEvents } from "@/domains/businesses/financial-events";
import type { NewBusinessFinancialEvent } from "@/domains/businesses/financial-events";
import { toNumber } from "@/lib/core/number";
import { nowIso } from "@/lib/core/time";
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

type RpcErrorLike = {
  code?: string;
  message?: string;
  hint?: string;
};

function isMissingTransferSignatureError(error: RpcErrorLike | null | undefined) {
  const message = `${error?.message ?? ""} ${error?.hint ?? ""}`;
  return (
    error?.code === "PGRST202" ||
    message.includes("execute_inventory_transfer") ||
    message.includes("Could not find the function public.execute_inventory_transfer")
  );
}

async function executeInventoryTransferRpc(
  client: QueryClient,
  input: TransferItemsInput,
  shippingPlan: { transferType: "same_city" | "shipping"; shippingCost: number; shippingMinutes: number }
) {
  const fullArgs = {
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
  };

  const firstAttempt = await client.rpc("execute_inventory_transfer", fullArgs);
  if (!firstAttempt.error || !isMissingTransferSignatureError(firstAttempt.error)) {
    return firstAttempt;
  }

  const isCrossCityBusinessTransfer =
    shippingPlan.transferType === "shipping" &&
    input.sourceType === "business" &&
    input.destinationType === "business";

  if (isCrossCityBusinessTransfer && !input.fundingAccountId) {
    throw new Error(
      "Inventory transfer is blocked because the Supabase API is using an outdated execute_inventory_transfer signature. The database migration is recorded, but the API schema cache needs to be reloaded on the hosted project."
    );
  }

  const legacyArgsWithFunding = {
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
  };

  const secondAttempt = await client.rpc("execute_inventory_transfer", legacyArgsWithFunding);
  if (!secondAttempt.error || !isMissingTransferSignatureError(secondAttempt.error)) {
    return secondAttempt;
  }

  const legacyArgs = {
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
  };

  return client.rpc("execute_inventory_transfer", legacyArgs);
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
  await reconcileBusinessInventoryReservations(client, playerId, businessId);

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
  const isBusinessToBusiness =
    input.sourceType === "business" &&
    input.destinationType === "business" &&
    Boolean(input.sourceBusinessId) &&
    Boolean(input.destinationBusinessId);
  const sourceCostBasis =
    input.sourceType === "business" && input.sourceBusinessId
      ? await client
          .from("business_inventory")
          .select("id, quantity, unit_cost, total_cost")
          .eq("owner_player_id", playerId)
          .eq("business_id", input.sourceBusinessId)
          .eq("item_key", input.itemKey)
          .eq("quality", input.quality)
          .maybeSingle()
      : null;

  const { data, error } = await executeInventoryTransferRpc(client, input, shippingPlan);

  if (error) throw error;

  const result = data as {
    transferType?: "same_city" | "shipping";
    shippingQueueItem?: ShippingQueueItem | null;
    shippingCost?: number;
    shippingMinutes?: number;
    referenceId?: string;
  } | null;

  if (!result?.transferType) {
    throw new Error("Transfer did not return a valid result.");
  }

  if (
    isBusinessToBusiness &&
    input.sourceBusinessId &&
    input.destinationBusinessId &&
    input.unitPrice &&
    sourceCostBasis &&
    !sourceCostBasis.error
  ) {
    const sourceRow = sourceCostBasis.data as {
      quantity?: number | string;
      unit_cost?: number | string | null;
      total_cost?: number | string | null;
    } | null;
    const sourceQuantity = Math.max(0, toNumber(sourceRow?.quantity));
    const sourceTotalCost = sourceRow?.total_cost === undefined || sourceRow?.total_cost === null
      ? sourceQuantity * toNumber(sourceRow?.unit_cost)
      : toNumber(sourceRow?.total_cost);
    const transferredUnitCost = sourceQuantity > 0 ? sourceTotalCost / sourceQuantity : toNumber(sourceRow?.unit_cost);
    const purchaseUnitCost = input.unitPrice;
    const transferReferenceId = result.referenceId ?? result.shippingQueueItem?.id ?? randomUUID();
    const grossTransferAmount = Number((purchaseUnitCost * input.quantity).toFixed(2));
    const transferredTotalCost = Number((transferredUnitCost * input.quantity).toFixed(2));

    const financialEvents: NewBusinessFinancialEvent[] = [
      {
        business_id: input.sourceBusinessId,
        account_code: "revenue",
        amount: grossTransferAmount,
        quantity: input.quantity,
        item_key: input.itemKey,
        reference_type: "inventory_transfer",
        reference_id: transferReferenceId,
        description: `Intercompany transfer revenue: ${input.quantity}x ${input.itemKey}`,
      },
      {
        business_id: input.sourceBusinessId,
        account_code: "cogs",
        amount: transferredTotalCost,
        quantity: input.quantity,
        item_key: input.itemKey,
        reference_type: "inventory_transfer",
        reference_id: transferReferenceId,
        description: `Intercompany transfer COGS: ${input.quantity}x ${input.itemKey}`,
      },
      {
        business_id: input.sourceBusinessId,
        account_code: "inventory",
        amount: transferredTotalCost,
        quantity: input.quantity,
        item_key: input.itemKey,
        reference_type: "inventory_transfer",
        reference_id: transferReferenceId,
        description: `Inventory relieved for transfer: ${input.quantity}x ${input.itemKey}`,
        metadata: { direction: "out" },
      },
      {
        business_id: input.destinationBusinessId,
        account_code: "inventory",
        amount: grossTransferAmount,
        quantity: input.quantity,
        item_key: input.itemKey,
        reference_type: "inventory_transfer",
        reference_id: transferReferenceId,
        description: `Inventory acquired by transfer: ${input.quantity}x ${input.itemKey}`,
        metadata: { direction: "in" },
      },
    ];

    await insertBusinessFinancialEvents(
      client,
      playerId,
      financialEvents.filter(
        (row) => result.transferType === "same_city" || row.business_id !== input.destinationBusinessId
      )
    );

    if (result.transferType === "same_city") {
      const { data: destinationRow, error: destinationError } = await client
        .from("business_inventory")
        .select("id, quantity, unit_cost, total_cost")
        .eq("owner_player_id", playerId)
        .eq("business_id", input.destinationBusinessId)
        .eq("item_key", input.itemKey)
        .eq("quality", input.quality)
        .maybeSingle();

      if (!destinationError && destinationRow && purchaseUnitCost > 0) {
        const existingQuantity = Math.max(0, toNumber(destinationRow.quantity) - input.quantity);
        const existingTotalCost = destinationRow.total_cost === undefined || destinationRow.total_cost === null
          ? existingQuantity * toNumber(destinationRow.unit_cost)
          : toNumber(destinationRow.total_cost) - input.quantity * purchaseUnitCost;
        const next = computeWeightedAverageCost({
          existingQuantity: Math.max(0, existingQuantity),
          existingTotalCost: Math.max(0, existingTotalCost),
          addedQuantity: input.quantity,
          addedUnitCost: purchaseUnitCost,
        });

        await client
          .from("business_inventory")
          .update({
            unit_cost: next.nextUnitCost,
            total_cost: next.nextTotalCost,
            updated_at: nowIso(),
          })
          .eq("id", destinationRow.id);
      }
    }
  }

  return {
    transferType: result.transferType,
    shippingQueueItem: result.shippingQueueItem ? normalizeShippingRow(result.shippingQueueItem) : null,
    shippingCost: toNumber(result.shippingCost),
    shippingMinutes: toNumber(result.shippingMinutes),
  };
}
