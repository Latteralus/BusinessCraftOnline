import { STORE_BUSINESS_TYPES, type BusinessType } from "@/config/businesses";
import {
  STOREFRONT_DEFAULT_SETTINGS,
} from "@/config/market";
import { supportsStorefront } from "@/domains/businesses";
import { addBusinessAccountEntry } from "@/domains/businesses/service";
import { ensureOwnedBusiness } from "@/domains/_shared/ownership";
import {
  insertBusinessFinancialEvents,
  previewInventoryCostByRowId,
  refreshInventoryCostByRowId,
} from "@/domains/businesses/financial-events";
import { reconcileBusinessInventoryReservations } from "@/domains/inventory";
import { round2, round4, toNumber } from "@/lib/core/number";
import { addHoursToNowIso, nowIso, toIso } from "@/lib/core/time";
import type { QueryClient } from "@/lib/db/query-client";
import {
  buildStorefrontAnalytics,
  summarizeStorefrontSnapshots,
  summarizeStorefrontTransactionAggregate,
} from "./storefront-metrics";
import type {
  AdminEconomySummary,
  BuyMarketListingInput,
  CancelMarketBuyOrderInput,
  CancelMarketListingInput,
  CreateMarketBuyOrderInput,
  CreateMarketListingInput,
  FulfillMarketBuyOrderInput,
  MarketBuyOrder,
  MarketBuyOrderFilter,
  MarketListing,
  MarketListingFilter,
  MarketStorefrontPerformanceSnapshot,
  MarketStorefrontFilter,
  MarketStorefrontSetting,
  MarketTransactionFilter,
  MarketTransaction,
  NpcMarketSubtickState,
  StorefrontPerformanceBusinessSummary,
  StorefrontPerformanceSummary,
  TickHealthSummary,
  TickRunLog,
  UpdateMarketStorefrontSettingsInput,
} from "./types";
import type { StorefrontTransactionAggregate } from "./storefront-metrics";

function normalizeListing(row: MarketListing & { business?: { name: string } }): MarketListing {
  return {
    ...row,
    quality: Number(row.quality),
    quantity: Number(row.quantity),
    reserved_quantity: Number(row.reserved_quantity),
    unit_price: toNumber(row.unit_price),
  };
}

function normalizeBuyOrder(row: MarketBuyOrder & { business?: { name: string } }): MarketBuyOrder {
  return {
    ...row,
    quality_min: Number(row.quality_min),
    quality_max: Number(row.quality_max),
    quantity: Number(row.quantity),
    max_unit_price: toNumber(row.max_unit_price),
  };
}

function normalizeTransaction(row: MarketTransaction): MarketTransaction {
  return {
    ...row,
    quality: Number(row.quality),
    quantity: Number(row.quantity),
    unit_price: toNumber(row.unit_price),
    gross_total: toNumber(row.gross_total),
    market_fee: toNumber(row.market_fee),
    net_total: toNumber(row.net_total),
    shopper_budget: row.shopper_budget === null ? null : toNumber(row.shopper_budget),
    sub_tick_index: row.sub_tick_index === null ? null : Number(row.sub_tick_index),
  };
}

function normalizeSubtickState(row: NpcMarketSubtickState): NpcMarketSubtickState {
  return {
    ...row,
    sub_tick_index: Number(row.sub_tick_index),
  };
}

function normalizeStorefrontSetting(row: MarketStorefrontSetting): MarketStorefrontSetting {
  return {
    ...row,
    ad_budget_per_tick: toNumber(row.ad_budget_per_tick),
    traffic_multiplier: toNumber(row.traffic_multiplier),
    is_ad_enabled: Boolean(row.is_ad_enabled),
  };
}

function normalizeTickRunLog(row: TickRunLog): TickRunLog {
  return {
    ...row,
    duration_ms: Number(row.duration_ms),
    processed_count: Number(row.processed_count),
    metrics:
      row.metrics && typeof row.metrics === "object" && !Array.isArray(row.metrics)
        ? (row.metrics as Record<string, unknown>)
        : {},
  };
}

function normalizeStorefrontSnapshot(
  row: MarketStorefrontPerformanceSnapshot
): MarketStorefrontPerformanceSnapshot {
  return {
    ...row,
    sub_tick_index: row.sub_tick_index === null ? null : Number(row.sub_tick_index),
    shoppers_generated: Number(row.shoppers_generated),
    buyers_count: Number(row.buyers_count ?? 0),
    sales_count: Number(row.sales_count),
    units_sold: Number(row.units_sold),
    gross_revenue: toNumber(row.gross_revenue),
    fee_total: toNumber(row.fee_total),
    ad_spend: toNumber(row.ad_spend),
    traffic_multiplier: toNumber(row.traffic_multiplier),
    demand_multiplier: toNumber(row.demand_multiplier),
    stock_out_count: Number(row.stock_out_count ?? 0),
  };
}

function normalizeStorefrontTransactionAggregate(row: Partial<StorefrontTransactionAggregate> | null | undefined): StorefrontTransactionAggregate {
  return {
    transaction_count: Number(row?.transaction_count ?? 0),
    units_sold: Number(row?.units_sold ?? 0),
    gross_revenue: toNumber(row?.gross_revenue),
    fee_total: toNumber(row?.fee_total),
    net_revenue: toNumber(row?.net_revenue),
    distinct_shopper_count: Number(row?.distinct_shopper_count ?? 0),
    first_transaction_at: row?.first_transaction_at ?? null,
    last_transaction_at: row?.last_transaction_at ?? null,
  };
}

async function getStorefrontTransactionAggregate(
  client: QueryClient,
  input: {
    playerId?: string | null;
    businessId?: string | null;
    from: string;
    to: string;
  }
): Promise<StorefrontTransactionAggregate> {
  const { data, error } = await client.rpc("get_storefront_transaction_aggregate", {
    p_seller_player_id: input.playerId ?? null,
    p_seller_business_id: input.businessId ?? null,
    p_from: input.from,
    p_to: input.to,
  });

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return normalizeStorefrontTransactionAggregate(row as Partial<StorefrontTransactionAggregate> | null | undefined);
}

async function getOwnedListing(client: QueryClient, playerId: string, listingId: string): Promise<MarketListing> {
  const { data, error } = await client
    .from("market_listings")
    .select("*")
    .eq("owner_player_id", playerId)
    .eq("id", listingId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Listing not found.");

  return normalizeListing(data as MarketListing);
}

async function getListing(client: QueryClient, listingId: string): Promise<MarketListing> {
  const { data, error } = await client.from("market_listings").select("*").eq("id", listingId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Listing not found.");
  return normalizeListing(data as MarketListing);
}

async function ensurePersistedStorefrontSettings(
  client: QueryClient,
  playerId: string,
  filter: MarketStorefrontFilter = {}
): Promise<void> {
  let storesQuery = client
    .from("businesses")
    .select("id, type")
    .eq("player_id", playerId)
    .in("type", [...STORE_BUSINESS_TYPES]);

  if (filter.businessId) {
    storesQuery = storesQuery.eq("id", filter.businessId);
  }

  const { data: storeRows, error: storesError } = await storesQuery;
  if (storesError) throw storesError;

  const stores = ((storeRows as Array<{ id: string; type: string }>) ?? []).filter((store) =>
    supportsStorefront(store.type as BusinessType)
  );
  if (stores.length === 0) {
    return;
  }

  const businessIds = stores.map((store) => store.id);
  const { data: existingRows, error: existingError } = await client
    .from("market_storefront_settings")
    .select("business_id")
    .eq("owner_player_id", playerId)
    .in("business_id", businessIds);
  if (existingError) throw existingError;

  const existingIds = new Set(
    (((existingRows as Array<{ business_id: string }>) ?? []) as Array<{ business_id: string }>).map(
      (row) => row.business_id
    )
  );
  const missingIds = businessIds.filter((businessId) => !existingIds.has(businessId));
  if (missingIds.length === 0) {
    return;
  }

  const timestamp = nowIso();
  const { error: insertError } = await client.from("market_storefront_settings").upsert(
    missingIds.map((businessId) => ({
      owner_player_id: playerId,
      business_id: businessId,
      ad_budget_per_tick: STOREFRONT_DEFAULT_SETTINGS.ad_budget_per_tick,
      traffic_multiplier: STOREFRONT_DEFAULT_SETTINGS.traffic_multiplier,
      is_ad_enabled: STOREFRONT_DEFAULT_SETTINGS.is_ad_enabled,
      updated_at: timestamp,
    })),
    { onConflict: "business_id" }
  );
  if (insertError) throw insertError;
}

async function releaseSourceInventoryReservation(client: QueryClient, listing: MarketListing): Promise<void> {
  if (listing.source_type !== "business" || !listing.source_inventory_id) return;

  const { data: row, error } = await client
    .from("business_inventory")
    .select("id, quantity, reserved_quantity")
    .eq("id", listing.source_inventory_id)
    .maybeSingle();

  if (error) throw error;
  if (!row) return;

  const quantity = toNumber(row.quantity);
  const reserved = toNumber(row.reserved_quantity);
  const nextReserved = Math.max(0, Math.min(quantity, reserved - listing.quantity));

  const { error: updateError } = await client
    .from("business_inventory")
    .update({
      reserved_quantity: nextReserved,
      updated_at: nowIso(),
    })
    .eq("id", row.id);

  if (updateError) throw updateError;
}

async function restorePersonalListingToInventory(client: QueryClient, listing: MarketListing): Promise<void> {
  if (listing.source_type !== "personal") return;

  const { data: existingRow, error: existingError } = await client
    .from("personal_inventory")
    .select("id, quantity")
    .eq("player_id", listing.owner_player_id)
    .eq("item_key", listing.item_key)
    .eq("quality", listing.quality)
    .maybeSingle();
  if (existingError) throw existingError;

  if (existingRow) {
    const { error: updateError } = await client
      .from("personal_inventory")
      .update({
        quantity: toNumber(existingRow.quantity) + listing.quantity,
        updated_at: nowIso(),
      })
      .eq("id", existingRow.id);
    if (updateError) throw updateError;
    return;
  }

  const { error: insertError } = await client.from("personal_inventory").insert({
    player_id: listing.owner_player_id,
    item_key: listing.item_key,
    quality: listing.quality,
    quantity: listing.quantity,
  });
  if (insertError) throw insertError;
}

export async function getMarketListings(
  client: QueryClient,
  playerId: string,
  filter: MarketListingFilter = {}
): Promise<MarketListing[]> {
  const limit = Math.max(1, Math.min(100, filter.limit ?? 50));
  const offset = Math.max(0, filter.offset ?? 0);
  let query = client
    .from("market_listings")
    .select("*, business:businesses(name)")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (filter.ownOnly) {
    query = query.eq("owner_player_id", playerId);
  }

  if (filter.cityId) {
    query = query.eq("city_id", filter.cityId);
  }

  if (filter.itemKey) {
    query = query.eq("item_key", filter.itemKey);
  }

  if (filter.status) {
    query = query.eq("status", filter.status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return ((data as MarketListing[]) ?? []).map(normalizeListing);
}

export async function createMarketListing(
  client: QueryClient,
  playerId: string,
  input: CreateMarketListingInput
): Promise<MarketListing> {
  if (input.sourceType === "business") {
    if (!input.sourceBusinessId) throw new Error("Business id is required.");
    const business = await ensureOwnedBusiness(client, playerId, input.sourceBusinessId);
    await reconcileBusinessInventoryReservations(client, playerId, business.id);

    const { data: inventoryRow, error: inventoryError } = await client
      .from("business_inventory")
      .select("id, quantity, reserved_quantity")
      .eq("owner_player_id", playerId)
      .eq("business_id", business.id)
      .eq("item_key", input.itemKey)
      .eq("quality", input.quality)
      .maybeSingle();

    if (inventoryError) throw inventoryError;
    if (!inventoryRow) throw new Error("Source inventory not found for requested item and quality.");

    const quantity = toNumber(inventoryRow.quantity);
    const reserved = toNumber(inventoryRow.reserved_quantity);
    const available = quantity - reserved;
    if (available < input.quantity) {
      throw new Error("Not enough available inventory to create listing.");
    }

    const { error: reserveError } = await client
      .from("business_inventory")
      .update({
        reserved_quantity: reserved + input.quantity,
        updated_at: nowIso(),
      })
      .eq("id", inventoryRow.id);
    if (reserveError) throw reserveError;

    const { data, error } = await client
      .from("market_listings")
      .insert({
        owner_player_id: playerId,
        source_type: "business",
        source_business_id: business.id,
        source_inventory_id: inventoryRow.id,
        source_personal_inventory_id: null,
        city_id: business.city_id,
        item_key: input.itemKey,
        quality: input.quality,
        quantity: input.quantity,
        reserved_quantity: input.quantity,
        unit_price: input.unitPrice,
        listing_type: "sell",
        status: "active",
        expires_at: input.expiresAt ?? null,
      })
      .select("*")
      .single();

    if (error) throw error;
    const listing = normalizeListing(data as MarketListing);
    await sweepBuyOrdersForNewListingSafely(client, listing.id);
    return listing;
  }

  const { data: personalRow, error: personalError } = await client
    .from("personal_inventory")
    .select("id, quantity")
    .eq("player_id", playerId)
    .eq("item_key", input.itemKey)
    .eq("quality", input.quality)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (personalError) throw personalError;
  if (!personalRow) throw new Error("Personal inventory not found for requested item and quality.");

  const available = toNumber(personalRow.quantity);
  if (available < input.quantity) {
    throw new Error("Not enough personal inventory to create listing.");
  }

  if (available === input.quantity) {
    const { error: deleteError } = await client.from("personal_inventory").delete().eq("id", personalRow.id);
    if (deleteError) throw deleteError;
  } else {
    const { error: updateError } = await client
      .from("personal_inventory")
      .update({
        quantity: available - input.quantity,
        updated_at: nowIso(),
      })
      .eq("id", personalRow.id);
    if (updateError) throw updateError;
  }

  const { data: characterRow, error: characterError } = await client
    .from("characters")
    .select("current_city_id")
    .eq("player_id", playerId)
    .maybeSingle();
  if (characterError) throw characterError;
  if (!characterRow?.current_city_id) throw new Error("Current city is required to list personal inventory on the market.");

  const { data, error } = await client
    .from("market_listings")
    .insert({
      owner_player_id: playerId,
      source_type: "personal",
      source_business_id: null,
      source_inventory_id: null,
      source_personal_inventory_id: null,
      city_id: characterRow.current_city_id,
      item_key: input.itemKey,
      quality: input.quality,
      quantity: input.quantity,
      reserved_quantity: input.quantity,
      unit_price: input.unitPrice,
      listing_type: "sell",
      status: "active",
      expires_at: input.expiresAt ?? null,
    })
    .select("*")
    .single();

  if (error) throw error;
  const listing = normalizeListing(data as MarketListing);
  await sweepBuyOrdersForNewListingSafely(client, listing.id);
  return listing;
}

// Best-effort: a failure here shouldn't fail listing creation. The listing
// still exists and remains matchable later (by a future buy order's own
// sweep, or a manual purchase) — only the instant-match opportunity is
// missed. sweep_buy_orders_for_new_listing re-validates everything itself
// under fresh row locks, so skipping it here never risks a stale/blind trade.
async function sweepBuyOrdersForNewListingSafely(client: QueryClient, listingId: string): Promise<void> {
  const { error } = await client.rpc("sweep_buy_orders_for_new_listing", { p_listing_id: listingId });
  if (error) {
    console.error("sweep_buy_orders_for_new_listing failed for listing", listingId, error);
  }
}

export async function cancelMarketListing(
  client: QueryClient,
  playerId: string,
  input: CancelMarketListingInput
): Promise<MarketListing> {
  const listing = await getOwnedListing(client, playerId, input.listingId);
  if (listing.status !== "active") {
    throw new Error("Only active listings can be cancelled.");
  }

  if (listing.source_type === "business") {
    await releaseSourceInventoryReservation(client, listing);
  } else {
    await restorePersonalListingToInventory(client, listing);
  }

  const now = nowIso();
  const { data, error } = await client
    .from("market_listings")
    .update({
      status: "cancelled",
      reserved_quantity: 0,
      cancelled_at: now,
      updated_at: now,
    })
    .eq("id", listing.id)
    .select("*")
    .single();

  if (error) throw error;
  return normalizeListing(data as MarketListing);
}

export async function buyMarketListing(
  client: QueryClient,
  playerId: string,
  input: BuyMarketListingInput
): Promise<{ listing: MarketListing; transaction: MarketTransaction }> {
  const listingBeforePurchase = await getListing(client, input.listingId);
  const sellerInventoryCost =
    listingBeforePurchase.source_type === "business" && listingBeforePurchase.source_inventory_id
      ? await previewInventoryCostByRowId(client, listingBeforePurchase.source_inventory_id, input.quantity)
      : null;

  const { data, error } = await client.rpc("execute_market_purchase", {
    p_listing_id: input.listingId,
    p_quantity: input.quantity,
    p_buyer_business_id: input.buyerBusinessId,
  });
  if (error) throw error;

  const result =
    data && typeof data === "object"
      ? (data as { listing?: MarketListing; transaction?: MarketTransaction })
      : null;

  if (!result?.listing || !result.transaction) {
    throw new Error("Market purchase did not return listing and transaction.");
  }

  const transaction = normalizeTransaction(result.transaction);
  if (
    listingBeforePurchase.source_type === "business" &&
    listingBeforePurchase.source_business_id &&
    listingBeforePurchase.source_inventory_id &&
    sellerInventoryCost
  ) {
    await refreshInventoryCostByRowId(
      client,
      listingBeforePurchase.source_inventory_id,
      sellerInventoryCost.unitCost
    );

    await insertBusinessFinancialEvents(client, listingBeforePurchase.owner_player_id, [
      {
        business_id: listingBeforePurchase.source_business_id,
        account_code: "revenue",
        amount: transaction.gross_total,
        quantity: transaction.quantity,
        item_key: transaction.item_key,
        reference_type: "market_transaction",
        reference_id: transaction.id,
        description: `Player sale revenue: ${transaction.quantity}x ${transaction.item_key}`,
        metadata: { buyerType: "player" },
      },
      {
        business_id: listingBeforePurchase.source_business_id,
        account_code: "cogs",
        amount: sellerInventoryCost.totalCost,
        quantity: sellerInventoryCost.quantity,
        item_key: transaction.item_key,
        reference_type: "market_transaction",
        reference_id: transaction.id,
        description: `COGS on player sale: ${transaction.quantity}x ${transaction.item_key}`,
        metadata: { estimatedCost: sellerInventoryCost.estimated },
      },
      {
        business_id: listingBeforePurchase.source_business_id,
        account_code: "inventory",
        amount: sellerInventoryCost.totalCost,
        quantity: sellerInventoryCost.quantity,
        item_key: transaction.item_key,
        reference_type: "market_transaction",
        reference_id: transaction.id,
        description: `Inventory relieved on player sale: ${transaction.quantity}x ${transaction.item_key}`,
        metadata: { direction: "out", estimatedCost: sellerInventoryCost.estimated },
      },
      {
        business_id: listingBeforePurchase.source_business_id,
        account_code: "operating_expense",
        amount: transaction.market_fee,
        quantity: transaction.quantity,
        item_key: transaction.item_key,
        reference_type: "market_transaction",
        reference_id: transaction.id,
        description: `Market fee expense: ${transaction.quantity}x ${transaction.item_key}`,
      },
    ]);
  }

  // Weighted-average cost basis on the buyer's inventory row is now computed
  // inside execute_market_purchase itself (see
  // 20260815070000_079_execute_market_purchase_cost_basis.sql), under the same
  // lock that updates quantity — a separate read-then-write here raced with
  // concurrent purchases of the same item and could clobber the cost basis.
  await insertBusinessFinancialEvents(client, playerId, [
    {
      business_id: input.buyerBusinessId,
      account_code: "inventory",
      amount: transaction.gross_total,
      quantity: transaction.quantity,
      item_key: transaction.item_key,
      reference_type: "market_transaction",
      reference_id: transaction.id,
      description: `Inventory acquired: ${transaction.quantity}x ${transaction.item_key}`,
    },
  ]);

  return {
    listing: normalizeListing(result.listing),
    transaction,
  };
}

export function recordNpcPurchase(): never {
  throw new Error("NPC purchases must be executed through storefront shelf stock, not direct inventory or market listings.");
}

export async function getMarketBuyOrders(
  client: QueryClient,
  playerId: string,
  filter: MarketBuyOrderFilter = {}
): Promise<MarketBuyOrder[]> {
  const limit = Math.max(1, Math.min(100, filter.limit ?? 50));
  const offset = Math.max(0, filter.offset ?? 0);
  let query = client
    .from("market_buy_orders")
    .select("*, business:businesses(name)")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (filter.ownOnly) {
    query = query.eq("owner_player_id", playerId);
  }

  if (filter.cityId) {
    query = query.eq("city_id", filter.cityId);
  }

  if (filter.itemKey) {
    query = query.eq("item_key", filter.itemKey);
  }

  if (filter.status) {
    query = query.eq("status", filter.status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return ((data as MarketBuyOrder[]) ?? []).map(normalizeBuyOrder);
}

export async function createMarketBuyOrder(
  client: QueryClient,
  playerId: string,
  input: CreateMarketBuyOrderInput
): Promise<{ buyOrder: MarketBuyOrder }> {
  let cityId: string | null = null;

  if (input.purchaserType === "personal") {
    const { data: characterRow, error: characterError } = await client
      .from("characters")
      .select("current_city_id")
      .eq("player_id", playerId)
      .maybeSingle();
    if (characterError) throw characterError;
    if (!characterRow?.current_city_id) {
      throw new Error("Current city is required to place a personal buy order.");
    }
    cityId = characterRow.current_city_id;
  }

  const { data, error } = await client.rpc("place_market_buy_order", {
    p_purchaser_type: input.purchaserType,
    p_purchaser_business_id: input.purchaserType === "business" ? (input.purchaserBusinessId ?? null) : null,
    p_city_id: cityId,
    p_item_key: input.itemKey,
    p_quality_min: input.qualityMin,
    p_quality_max: input.qualityMax,
    p_quantity: input.quantity,
    p_max_unit_price: input.maxUnitPrice,
    p_expires_at: input.expiresAt ?? null,
  });
  if (error) throw error;

  const result = data && typeof data === "object" ? (data as { buyOrder?: MarketBuyOrder }) : null;
  if (!result?.buyOrder) {
    throw new Error("Buy order placement did not return an order.");
  }

  return { buyOrder: normalizeBuyOrder(result.buyOrder) };
}

export async function cancelMarketBuyOrder(
  client: QueryClient,
  playerId: string,
  input: CancelMarketBuyOrderInput
): Promise<MarketBuyOrder> {
  void playerId; // ownership is enforced inside cancel_market_buy_order via auth.uid()
  const { data, error } = await client.rpc("cancel_market_buy_order", {
    p_buy_order_id: input.buyOrderId,
  });
  if (error) throw error;
  if (!data) {
    throw new Error("Buy order cancellation did not return an order.");
  }

  return normalizeBuyOrder(data as MarketBuyOrder);
}

export async function fulfillMarketBuyOrder(
  client: QueryClient,
  playerId: string,
  input: FulfillMarketBuyOrderInput
): Promise<{ buyOrder: MarketBuyOrder; transaction: MarketTransaction }> {
  void playerId; // ownership/source checks are enforced inside fulfill_market_buy_order via auth.uid()
  const { data, error } = await client.rpc("fulfill_market_buy_order", {
    p_buy_order_id: input.buyOrderId,
    p_quantity: input.quantity,
    p_source_type: input.sourceType,
    p_source_business_id: input.sourceType === "business" ? (input.sourceBusinessId ?? null) : null,
    p_source_business_inventory_id: input.sourceType === "business" ? (input.sourceBusinessInventoryId ?? null) : null,
    p_source_personal_inventory_id: input.sourceType === "personal" ? (input.sourcePersonalInventoryId ?? null) : null,
  });
  if (error) throw error;

  const result =
    data && typeof data === "object"
      ? (data as { buyOrder?: MarketBuyOrder; transaction?: MarketTransaction })
      : null;
  if (!result?.buyOrder || !result.transaction) {
    throw new Error("Buy order fulfillment did not return an order and transaction.");
  }

  return {
    buyOrder: normalizeBuyOrder(result.buyOrder),
    transaction: normalizeTransaction(result.transaction),
  };
}

export async function getMarketTransactions(
  client: QueryClient,
  playerId: string,
  limit = 100,
  filter: MarketTransactionFilter = {}
): Promise<MarketTransaction[]> {
  let query = client
    .from("market_transactions")
    .select("*")
    .or(`seller_player_id.eq.${playerId},buyer_player_id.eq.${playerId}`)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(300, limit)));

  if (filter.buyerType) {
    query = query.eq("buyer_type", filter.buyerType);
  }

  if (filter.requireListing) {
    query = query.not("listing_id", "is", null);
  }

  const { data, error } = await query;

  if (error) throw error;
  return ((data as MarketTransaction[]) ?? []).map(normalizeTransaction);
}

export async function getOrCreateNpcMarketSubtickState(
  client: QueryClient
): Promise<NpcMarketSubtickState> {
  const { data, error } = await client
    .from("npc_market_subtick_state")
    .select("*")
    .eq("state_key", "global")
    .maybeSingle();
  if (error) throw error;

  if (data) {
    return normalizeSubtickState(data as NpcMarketSubtickState);
  }

  const { data: inserted, error: insertError } = await client
    .from("npc_market_subtick_state")
    .insert({
      state_key: "global",
      tick_window_started_at: nowIso(),
      sub_tick_index: 0,
    })
    .select("*")
    .single();
  if (insertError) throw insertError;

  return normalizeSubtickState(inserted as NpcMarketSubtickState);
}

export async function updateNpcMarketSubtickState(
  client: QueryClient,
  input: { tickWindowStartedAt: string; subTickIndex: number }
): Promise<NpcMarketSubtickState> {
  const { data, error } = await client
    .from("npc_market_subtick_state")
    .update({
      tick_window_started_at: input.tickWindowStartedAt,
      sub_tick_index: input.subTickIndex,
      updated_at: nowIso(),
    })
    .eq("state_key", "global")
    .select("*")
    .single();

  if (error) throw error;
  return normalizeSubtickState(data as NpcMarketSubtickState);
}

export async function getMarketStorefrontSettings(
  client: QueryClient,
  playerId: string,
  filter: MarketStorefrontFilter = {}
): Promise<MarketStorefrontSetting[]> {
  await ensurePersistedStorefrontSettings(client, playerId, filter);

  let query = client
    .from("market_storefront_settings")
    .select("*")
    .eq("owner_player_id", playerId)
    .order("created_at", { ascending: false });

  if (filter.businessId) {
    query = query.eq("business_id", filter.businessId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return ((data as MarketStorefrontSetting[]) ?? []).map(normalizeStorefrontSetting);
}

export async function updateMarketStorefrontSettings(
  client: QueryClient,
  playerId: string,
  input: UpdateMarketStorefrontSettingsInput
): Promise<MarketStorefrontSetting> {
  const business = await ensureOwnedBusiness(client, playerId, input.businessId);
  if (!supportsStorefront(business.type)) {
    throw new Error("Storefront settings are only available for store businesses.");
  }

  await ensurePersistedStorefrontSettings(client, playerId, { businessId: business.id });

  const payload = {
    owner_player_id: playerId,
    business_id: business.id,
    ad_budget_per_tick: input.adBudgetPerTick,
    traffic_multiplier: input.trafficMultiplier,
    is_ad_enabled: input.isAdEnabled,
    updated_at: nowIso(),
  };

  const { data, error } = await client
    .from("market_storefront_settings")
    .upsert(payload, { onConflict: "business_id" })
    .select("*")
    .single();

  if (error) throw error;
  return normalizeStorefrontSetting(data as MarketStorefrontSetting);
}

function toWindowHours(value: number): number {
  if (!Number.isFinite(value)) return 24;
  return Math.max(1, Math.min(168, Math.floor(value)));
}

function summarizeTickRuns(
  rows: TickRunLog[],
  windowHours: number,
  capturedFrom: string,
  capturedTo: string
): TickHealthSummary {
  const byTick = new Map<
    string,
    {
      tick_name: string;
      total_runs: number;
      error_runs: number;
      duration_sum: number;
      last_status: "ok" | "error";
      last_finished_at: string;
    }
  >();

  for (const row of rows) {
    const existing = byTick.get(row.tick_name);
    if (!existing) {
      byTick.set(row.tick_name, {
        tick_name: row.tick_name,
        total_runs: 1,
        error_runs: row.status === "error" ? 1 : 0,
        duration_sum: row.duration_ms,
        last_status: row.status,
        last_finished_at: row.finished_at,
      });
      continue;
    }

    existing.total_runs += 1;
    existing.error_runs += row.status === "error" ? 1 : 0;
    existing.duration_sum += row.duration_ms;
  }

  const totalRuns = rows.length;
  const errorRuns = rows.reduce((sum, row) => sum + (row.status === "error" ? 1 : 0), 0);
  const successRate = totalRuns === 0 ? 1 : round4((totalRuns - errorRuns) / totalRuns);

  return {
    window_hours: windowHours,
    captured_from: capturedFrom,
    captured_to: capturedTo,
    total_runs: totalRuns,
    error_runs: errorRuns,
    success_rate: successRate,
    recent_runs: rows.slice(0, 10),
    by_tick: Array.from(byTick.values())
      .map((item) => ({
        tick_name: item.tick_name,
        total_runs: item.total_runs,
        error_runs: item.error_runs,
        success_rate:
          item.total_runs === 0
            ? 1
            : round4((item.total_runs - item.error_runs) / item.total_runs),
        average_duration_ms: round2(item.duration_sum / Math.max(1, item.total_runs)),
        last_status: item.last_status,
        last_finished_at: item.last_finished_at,
      }))
      .sort((a, b) => a.tick_name.localeCompare(b.tick_name)),
  };
}

export async function getStorefrontPerformanceSummary(
  client: QueryClient,
  playerId: string,
  windowHoursInput = 24
): Promise<StorefrontPerformanceSummary> {
  const windowHours = toWindowHours(windowHoursInput);
  const from = addHoursToNowIso(-windowHours);
  const to = nowIso();

  const [snapshotsResult, transactionAggregate, businessesResult] = await Promise.all([
    client
      .from("market_storefront_performance_snapshots")
      .select("*")
      .eq("owner_player_id", playerId)
      .gte("captured_at", from)
      .order("captured_at", { ascending: false }),
    getStorefrontTransactionAggregate(client, { playerId, from, to }),
    client.from("businesses").select("id, name").eq("player_id", playerId),
  ]);

  if (snapshotsResult.error) throw snapshotsResult.error;
  if (businessesResult.error) throw businessesResult.error;

  const snapshots = ((snapshotsResult.data as MarketStorefrontPerformanceSnapshot[]) ?? []).map(
    normalizeStorefrontSnapshot
  );
  const businessRows = ((businessesResult.data as Array<{ id: string; name: string }>) ?? []) as Array<{
    id: string;
    name: string;
  }>;
  const businessNameById = new Map(businessRows.map((row) => [row.id, row.name]));

  const snapshotTotals = summarizeStorefrontSnapshots(snapshots);
  const transactionTotals = summarizeStorefrontTransactionAggregate(transactionAggregate);
  const analytics = buildStorefrontAnalytics({
    snapshotTotals,
    transactionTotals,
    snapshotCount: snapshots.length,
    transactionAggregate,
    capturedFrom: from,
    capturedTo: to,
  });

  const snapshotsByBusiness = new Map<string, MarketStorefrontPerformanceSnapshot[]>();
  for (const snapshot of snapshots) {
    const existing = snapshotsByBusiness.get(snapshot.business_id) ?? [];
    existing.push(snapshot);
    snapshotsByBusiness.set(snapshot.business_id, existing);
  }

  const businessSummaries = await Promise.all(
    businessRows.map(async (business) => {
      const businessSnapshots = snapshotsByBusiness.get(business.id) ?? [];
      const businessTransactionAggregate = await getStorefrontTransactionAggregate(client, {
        playerId,
        businessId: business.id,
        from,
        to,
      });
      const businessAnalytics = buildStorefrontAnalytics({
        snapshotTotals: summarizeStorefrontSnapshots(businessSnapshots),
        transactionTotals: summarizeStorefrontTransactionAggregate(businessTransactionAggregate),
        snapshotCount: businessSnapshots.length,
        transactionAggregate: businessTransactionAggregate,
        capturedFrom: from,
        capturedTo: to,
      });

      if (businessAnalytics.source === "empty") return null;

      return {
        business_id: business.id,
        business_name: businessNameById.get(business.id) ?? "Unknown Store",
        ...businessAnalytics,
      };
    })
  );

  return {
    window_hours: windowHours,
    captured_from: from,
    captured_to: to,
    ad_spend: analytics.ad_spend,
    gross_revenue: analytics.gross_revenue,
    fee_total: analytics.fee_total,
    net_revenue: analytics.net_revenue,
    sales_count: analytics.sales_count,
    buyers_count: analytics.buyers_count,
    units_sold: analytics.units_sold,
    shoppers_generated: analytics.shoppers_generated,
    stock_out_count: analytics.stock_out_count,
    roi: analytics.roi,
    source: analytics.source,
    warnings: analytics.warnings,
    snapshot_count: analytics.snapshot_count,
    transaction_count: analytics.transaction_count,
    audit: analytics.audit,
    businesses: businessSummaries
      .filter((item): item is StorefrontPerformanceSummary["businesses"][number] => Boolean(item))
      .sort((a, b) => b.gross_revenue - a.gross_revenue),
  };
}

export async function getStorefrontPerformanceForBusiness(
  client: QueryClient,
  playerId: string,
  businessId: string,
  windowHoursInput = 24
): Promise<StorefrontPerformanceBusinessSummary | null> {
  const windowHours = toWindowHours(windowHoursInput);
  const from = addHoursToNowIso(-windowHours);
  const to = nowIso();

  const [snapshotsResult, transactionAggregate, businessResult] = await Promise.all([
    client
      .from("market_storefront_performance_snapshots")
      .select("*")
      .eq("owner_player_id", playerId)
      .eq("business_id", businessId)
      .gte("captured_at", from)
      .order("captured_at", { ascending: false }),
    getStorefrontTransactionAggregate(client, { playerId, businessId, from, to }),
    client.from("businesses").select("id, name").eq("id", businessId).eq("player_id", playerId).maybeSingle(),
  ]);

  if (snapshotsResult.error) throw snapshotsResult.error;

  const snapshots = ((snapshotsResult.data as MarketStorefrontPerformanceSnapshot[]) ?? []).map(
    normalizeStorefrontSnapshot
  );
  if (snapshots.length === 0 && transactionAggregate.transaction_count === 0) return null;

  const businessName = (businessResult.data as { id: string; name: string } | null)?.name ?? "Unknown Store";

  const summary = buildStorefrontAnalytics({
    snapshotTotals: summarizeStorefrontSnapshots(snapshots),
    transactionTotals: summarizeStorefrontTransactionAggregate(transactionAggregate),
    snapshotCount: snapshots.length,
    transactionAggregate,
    capturedFrom: from,
    capturedTo: to,
  });

  return {
    business_id: businessId,
    business_name: businessName,
    ...summary,
  };
}

export async function getTickHealthSummary(
  client: QueryClient,
  windowHoursInput = 24
): Promise<TickHealthSummary> {
  const windowHours = toWindowHours(windowHoursInput);
  const from = addHoursToNowIso(-windowHours);
  const to = nowIso();

  const { data, error } = await client
    .from("tick_run_logs")
    .select("*")
    .gte("created_at", from)
    .order("created_at", { ascending: false })
    .limit(800);

  if (error) throw error;
  const rows = ((data as TickRunLog[]) ?? []).map(normalizeTickRunLog);
  return summarizeTickRuns(rows, windowHours, from, to);
}

export async function getAdminEconomySummary(
  client: QueryClient,
  windowHoursInput = 24
): Promise<AdminEconomySummary> {
  const windowHours = toWindowHours(windowHoursInput);
  const from = addHoursToNowIso(-windowHours);
  const to = nowIso();

  const [tickRowsResult, snapshotsResult, transactionAggregate] = await Promise.all([
    client
      .from("tick_run_logs")
      .select("*")
      .gte("created_at", from)
      .order("created_at", { ascending: false })
      .limit(1200),
    client
      .from("market_storefront_performance_snapshots")
      .select("*")
      .gte("captured_at", from)
      .order("captured_at", { ascending: false })
      .limit(3000),
    getStorefrontTransactionAggregate(client, { from, to }),
  ]);

  if (tickRowsResult.error) throw tickRowsResult.error;
  if (snapshotsResult.error) throw snapshotsResult.error;

  const tickRows = ((tickRowsResult.data as TickRunLog[]) ?? []).map(normalizeTickRunLog);
  const snapshots = ((snapshotsResult.data as MarketStorefrontPerformanceSnapshot[]) ?? []).map(
    normalizeStorefrontSnapshot
  );

  const totals = buildStorefrontAnalytics({
    snapshotTotals: summarizeStorefrontSnapshots(snapshots),
    transactionTotals: summarizeStorefrontTransactionAggregate(transactionAggregate),
    snapshotCount: snapshots.length,
    transactionAggregate,
    capturedFrom: from,
    capturedTo: to,
  });

  return {
    tick_health: summarizeTickRuns(tickRows, windowHours, from, to),
    storefront_performance: {
      window_hours: windowHours,
      captured_from: from,
      captured_to: to,
      snapshots: snapshots.length,
      ad_spend: totals.ad_spend,
      gross_revenue: totals.gross_revenue,
      fee_total: totals.fee_total,
      net_revenue: totals.net_revenue,
      sales_count: totals.sales_count,
      units_sold: totals.units_sold,
      shoppers_generated: totals.shoppers_generated,
      roi: totals.roi,
    },
  };
}
