import { MARKET_TRANSACTION_FEE } from "@/config/market";
import { ensureOwnedBusiness } from "@/domains/_shared/ownership";
import { round2, round4, toNumber } from "@/lib/core/number";
import { addHoursToNowIso, nowIso, toIso } from "@/lib/core/time";
import type { QueryClient } from "@/lib/db/query-client";
import type {
  AdminEconomySummary,
  BuyMarketListingInput,
  CancelMarketListingInput,
  CreateMarketListingInput,
  MarketListing,
  MarketListingFilter,
  MarketStorefrontPerformanceSnapshot,
  MarketStorefrontFilter,
  MarketStorefrontSetting,
  MarketTransaction,
  NpcMarketSubtickState,
  RecordNpcPurchaseInput,
  StorefrontPerformanceSummary,
  TickHealthSummary,
  TickRunLog,
  UpdateMarketStorefrontSettingsInput,
} from "./types";

function normalizeListing(row: MarketListing & { business?: { name: string } }): MarketListing {
  return {
    ...row,
    quality: Number(row.quality),
    quantity: Number(row.quantity),
    reserved_quantity: Number(row.reserved_quantity),
    unit_price: toNumber(row.unit_price),
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
    sales_count: Number(row.sales_count),
    units_sold: Number(row.units_sold),
    gross_revenue: toNumber(row.gross_revenue),
    fee_total: toNumber(row.fee_total),
    ad_spend: toNumber(row.ad_spend),
    traffic_multiplier: toNumber(row.traffic_multiplier),
    demand_multiplier: toNumber(row.demand_multiplier),
  };
}

async function getBusinessNameSafe(client: QueryClient, businessId: string | null | undefined): Promise<string | null> {
  if (!businessId) return null;
  const { data } = await client.from("businesses").select("name").eq("id", businessId).maybeSingle();
  return data?.name ? String(data.name) : null;
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

async function applySourceInventorySale(
  client: QueryClient,
  listing: MarketListing,
  soldQuantity: number
): Promise<void> {
  if (!listing.source_inventory_id) return;

  const { data: row, error } = await client
    .from("business_inventory")
    .select("id, quantity, reserved_quantity")
    .eq("id", listing.source_inventory_id)
    .maybeSingle();

  if (error) throw error;
  if (!row) return;

  const quantity = toNumber(row.quantity);
  const reserved = toNumber(row.reserved_quantity);
  const nextQuantity = quantity - soldQuantity;

  if (nextQuantity <= 0) {
    const { error: deleteError } = await client.from("business_inventory").delete().eq("id", row.id);
    if (deleteError) throw deleteError;
    return;
  }

  const { error: updateError } = await client
    .from("business_inventory")
    .update({
      quantity: nextQuantity,
      reserved_quantity: Math.max(0, Math.min(nextQuantity, reserved - soldQuantity)),
      updated_at: nowIso(),
    })
    .eq("id", row.id);

  if (updateError) throw updateError;
}

async function releaseSourceInventoryReservation(client: QueryClient, listing: MarketListing): Promise<void> {
  if (!listing.source_inventory_id) return;

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

async function settleSaleAccounting(
  client: QueryClient,
  listing: MarketListing,
  soldQuantity: number,
  buyerType: "player" | "npc",
  buyerPlayerId: string | null,
  buyerBusinessId: string | null,
  meta?: {
    shopperName?: string | null;
    shopperTier?: string | null;
    shopperBudget?: number | null;
    subTickIndex?: number | null;
    tickWindowStartedAt?: string | null;
  }
): Promise<MarketTransaction> {
  const gross = round2(listing.unit_price * soldQuantity);
  const fee = round2(gross * MARKET_TRANSACTION_FEE);
  const net = round2(gross - fee);
  const sellerBusinessName = await getBusinessNameSafe(client, listing.source_business_id);
  const buyerBusinessName = buyerType === "player" ? await getBusinessNameSafe(client, buyerBusinessId) : null;

  const { error: ledgerError } = await client.from("business_accounts").insert([
    {
      business_id: listing.source_business_id,
      amount: gross,
      entry_type: "credit",
      category: buyerType === "npc" ? "npc_sale" : "market_sale",
      reference_id: listing.id,
      description: `${buyerType.toUpperCase()} market sale: ${soldQuantity}x ${listing.item_key}`,
    },
    {
      business_id: listing.source_business_id,
      amount: fee,
      entry_type: "debit",
      category: "market_fee",
      reference_id: listing.id,
      description: `Market fee: ${soldQuantity}x ${listing.item_key}`,
    },
  ]);

  if (ledgerError) throw ledgerError;

  if (buyerType === "player") {
    if (buyerBusinessId) {
      const { error: buyerLedgerError } = await client.from("business_accounts").insert({
        business_id: buyerBusinessId,
        amount: gross,
        entry_type: "debit",
        category: "market_purchase",
        reference_id: listing.id,
        description: `Market purchase: ${soldQuantity}x ${listing.item_key}`,
      });
      if (buyerLedgerError) throw buyerLedgerError;
    } else if (buyerPlayerId) {
      const { data: bankAccounts, error: accountsError } = await client
        .from("bank_accounts")
        .select("id")
        .eq("player_id", buyerPlayerId)
        .eq("account_type", "checking")
        .maybeSingle();

      if (accountsError) throw accountsError;

      if (bankAccounts) {
        const { error: personalLedgerError } = await client.from("transactions").insert({
          account_id: bankAccounts.id,
          amount: gross,
          direction: "debit",
          transaction_type: "market_purchase",
          reference_id: listing.id,
          description: `Market purchase: ${soldQuantity}x ${listing.item_key}`,
        });
        if (personalLedgerError) throw personalLedgerError;
      }
    }
  }

  const { data: txRow, error: txError } = await client
    .from("market_transactions")
    .insert({
      listing_id: listing.id,
      seller_player_id: listing.owner_player_id,
      buyer_player_id: buyerPlayerId,
      buyer_type: buyerType,
      seller_business_id: listing.source_business_id,
      seller_business_name: sellerBusinessName,
      buyer_business_id: buyerBusinessId,
      buyer_business_name: buyerBusinessName,
      city_id: listing.city_id,
      item_key: listing.item_key,
      quality: listing.quality,
      quantity: soldQuantity,
      unit_price: listing.unit_price,
      gross_total: gross,
      market_fee: fee,
      net_total: net,
      shopper_name: meta?.shopperName ?? null,
      shopper_tier: meta?.shopperTier ?? null,
      shopper_budget: meta?.shopperBudget ?? null,
      sub_tick_index: meta?.subTickIndex ?? null,
      tick_window_started_at: meta?.tickWindowStartedAt ?? null,
    })
    .select("*")
    .single();

  if (txError) throw txError;
  return normalizeTransaction(txRow as MarketTransaction);
}

export async function getMarketListings(
  client: QueryClient,
  playerId: string,
  filter: MarketListingFilter = {}
): Promise<MarketListing[]> {
  let query = client.from("market_listings").select("*, business:businesses(name)").order("created_at", { ascending: false });

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
  const business = await ensureOwnedBusiness(client, playerId, input.sourceBusinessId);

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
      source_business_id: business.id,
      source_inventory_id: inventoryRow.id,
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
  return normalizeListing(data as MarketListing);
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

  await releaseSourceInventoryReservation(client, listing);

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

  return {
    listing: normalizeListing(result.listing),
    transaction: normalizeTransaction(result.transaction),
  };
}

export async function recordNpcPurchase(
  client: QueryClient,
  input: RecordNpcPurchaseInput & {
    shopperName?: string;
    shopperTier?: string;
    shopperBudget?: number;
    subTickIndex?: number;
    tickWindowStartedAt?: string;
  }
): Promise<{ listing: MarketListing; transaction: MarketTransaction }> {
  const listing = await getListing(client, input.listingId);
  if (listing.status !== "active") throw new Error("Listing is not active.");

  const soldQuantity = Math.max(1, Math.min(input.quantity, listing.quantity));
  await applySourceInventorySale(client, listing, soldQuantity);

  const nextQty = listing.quantity - soldQuantity;
  const nextReserved = Math.max(0, listing.reserved_quantity - soldQuantity);
  const nextStatus = nextQty <= 0 ? "filled" : "active";
  const now = nowIso();

  const { data: updatedRow, error: listingError } = await client
    .from("market_listings")
    .update({
      quantity: Math.max(0, nextQty),
      reserved_quantity: Math.max(0, nextReserved),
      status: nextStatus,
      filled_at: nextStatus === "filled" ? now : null,
      updated_at: now,
    })
    .eq("id", listing.id)
    .select("*")
    .single();
  if (listingError) throw listingError;

  const transaction = await settleSaleAccounting(client, listing, soldQuantity, "npc", null, null, {
    shopperName: input.shopperName ?? null,
    shopperTier: input.shopperTier ?? null,
    shopperBudget: input.shopperBudget ?? null,
    subTickIndex: input.subTickIndex ?? null,
    tickWindowStartedAt: input.tickWindowStartedAt ?? null,
  });

  return {
    listing: normalizeListing(updatedRow as MarketListing),
    transaction,
  };
}

export async function getMarketTransactions(
  client: QueryClient,
  playerId: string,
  limit = 100
): Promise<MarketTransaction[]> {
  const { data, error } = await client
    .from("market_transactions")
    .select("*")
    .or(`seller_player_id.eq.${playerId},buyer_player_id.eq.${playerId}`)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(300, limit)));

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

  const existing = ((data as MarketStorefrontSetting[]) ?? []).map(normalizeStorefrontSetting);
  const byBusinessId = new Map(existing.map((row) => [row.business_id, row]));

  let storesQuery = client
    .from("businesses")
    .select("id")
    .eq("player_id", playerId)
    .in("type", ["general_store", "specialty_store"]);

  if (filter.businessId) {
    storesQuery = storesQuery.eq("id", filter.businessId);
  }

  const { data: storeRows, error: storesError } = await storesQuery;
  if (storesError) throw storesError;

  const defaults = ((storeRows as Array<{ id: string }>) ?? [])
    .filter((store) => !byBusinessId.has(store.id))
    .map((store) => ({
      id: `default-${store.id}`,
      owner_player_id: playerId,
      business_id: store.id,
      ad_budget_per_tick: 0,
      traffic_multiplier: 1,
      is_ad_enabled: true,
      created_at: toIso(0),
      updated_at: toIso(0),
    }));

  return [...existing, ...defaults];
}

export async function updateMarketStorefrontSettings(
  client: QueryClient,
  playerId: string,
  input: UpdateMarketStorefrontSettingsInput
): Promise<MarketStorefrontSetting> {
  const business = await ensureOwnedBusiness(client, playerId, input.businessId);
  if (!["general_store", "specialty_store"].includes(business.type)) {
    throw new Error("Storefront settings are only available for store businesses.");
  }

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

function toRoi(adSpend: number, netRevenue: number): number | null {
  if (adSpend <= 0) return null;
  return round4(netRevenue / adSpend);
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

  const [snapshotsResult, businessesResult] = await Promise.all([
    client
      .from("market_storefront_performance_snapshots")
      .select("*")
      .eq("owner_player_id", playerId)
      .gte("captured_at", from)
      .order("captured_at", { ascending: false }),
    client.from("businesses").select("id, name").eq("player_id", playerId),
  ]);

  if (snapshotsResult.error) throw snapshotsResult.error;
  if (businessesResult.error) throw businessesResult.error;

  const snapshots = ((snapshotsResult.data as MarketStorefrontPerformanceSnapshot[]) ?? []).map(
    normalizeStorefrontSnapshot
  );
  const businessNameById = new Map(
    (((businessesResult.data as Array<{ id: string; name: string }>) ?? []) as Array<{
      id: string;
      name: string;
    }>).map((row) => [row.id, row.name])
  );

  const totals = snapshots.reduce(
    (acc, row) => {
      acc.ad_spend += row.ad_spend;
      acc.gross_revenue += row.gross_revenue;
      acc.fee_total += row.fee_total;
      acc.sales_count += row.sales_count;
      acc.units_sold += row.units_sold;
      acc.shoppers_generated += row.shoppers_generated;
      return acc;
    },
    {
      ad_spend: 0,
      gross_revenue: 0,
      fee_total: 0,
      sales_count: 0,
      units_sold: 0,
      shoppers_generated: 0,
    }
  );

  const byBusiness = new Map<string, StorefrontPerformanceSummary["businesses"][number]>();
  for (const row of snapshots) {
    const existing = byBusiness.get(row.business_id);
    if (!existing) {
      byBusiness.set(row.business_id, {
        business_id: row.business_id,
        business_name: businessNameById.get(row.business_id) ?? "Unknown Store",
        ad_spend: row.ad_spend,
        gross_revenue: row.gross_revenue,
        fee_total: row.fee_total,
        net_revenue: round2(row.gross_revenue - row.fee_total),
        sales_count: row.sales_count,
        units_sold: row.units_sold,
        shoppers_generated: row.shoppers_generated,
        roi: toRoi(row.ad_spend, row.gross_revenue - row.fee_total),
      });
      continue;
    }

    existing.ad_spend = round2(existing.ad_spend + row.ad_spend);
    existing.gross_revenue = round2(existing.gross_revenue + row.gross_revenue);
    existing.fee_total = round2(existing.fee_total + row.fee_total);
    existing.net_revenue = round2(existing.gross_revenue - existing.fee_total);
    existing.sales_count += row.sales_count;
    existing.units_sold += row.units_sold;
    existing.shoppers_generated += row.shoppers_generated;
    existing.roi = toRoi(existing.ad_spend, existing.net_revenue);
  }

  const netRevenue = round2(totals.gross_revenue - totals.fee_total);

  return {
    window_hours: windowHours,
    captured_from: from,
    captured_to: to,
    ad_spend: round2(totals.ad_spend),
    gross_revenue: round2(totals.gross_revenue),
    fee_total: round2(totals.fee_total),
    net_revenue: netRevenue,
    sales_count: totals.sales_count,
    units_sold: totals.units_sold,
    shoppers_generated: totals.shoppers_generated,
    roi: toRoi(totals.ad_spend, netRevenue),
    businesses: Array.from(byBusiness.values()).sort((a, b) => b.gross_revenue - a.gross_revenue),
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

  const [tickRowsResult, snapshotsResult] = await Promise.all([
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
  ]);

  if (tickRowsResult.error) throw tickRowsResult.error;
  if (snapshotsResult.error) throw snapshotsResult.error;

  const tickRows = ((tickRowsResult.data as TickRunLog[]) ?? []).map(normalizeTickRunLog);
  const snapshots = ((snapshotsResult.data as MarketStorefrontPerformanceSnapshot[]) ?? []).map(
    normalizeStorefrontSnapshot
  );

  const totals = snapshots.reduce(
    (acc, row) => {
      acc.ad_spend += row.ad_spend;
      acc.gross_revenue += row.gross_revenue;
      acc.fee_total += row.fee_total;
      acc.sales_count += row.sales_count;
      acc.units_sold += row.units_sold;
      acc.shoppers_generated += row.shoppers_generated;
      return acc;
    },
    {
      ad_spend: 0,
      gross_revenue: 0,
      fee_total: 0,
      sales_count: 0,
      units_sold: 0,
      shoppers_generated: 0,
    }
  );
  const netRevenue = round2(totals.gross_revenue - totals.fee_total);

  return {
    tick_health: summarizeTickRuns(tickRows, windowHours, from, to),
    storefront_performance: {
      window_hours: windowHours,
      captured_from: from,
      captured_to: to,
      snapshots: snapshots.length,
      ad_spend: round2(totals.ad_spend),
      gross_revenue: round2(totals.gross_revenue),
      fee_total: round2(totals.fee_total),
      net_revenue: netRevenue,
      sales_count: totals.sales_count,
      units_sold: totals.units_sold,
      shoppers_generated: totals.shoppers_generated,
      roi: toRoi(totals.ad_spend, netRevenue),
    },
  };
}
