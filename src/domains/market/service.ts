import { MARKET_TRANSACTION_FEE } from "@/config/market";
import { getBusinessById } from "@/domains/businesses";
import type {
  BuyMarketListingInput,
  CancelMarketListingInput,
  CreateMarketListingInput,
  MarketListing,
  MarketListingFilter,
  MarketTransaction,
  RecordNpcPurchaseInput,
} from "./types";

type QueryClient = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

function normalizeListing(row: MarketListing): MarketListing {
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
  };
}

async function ensureOwnedBusiness(client: QueryClient, playerId: string, businessId: string) {
  const business = await getBusinessById(client, playerId, businessId);
  if (!business) throw new Error("Business not found.");
  return business;
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
      updated_at: new Date().toISOString(),
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
      updated_at: new Date().toISOString(),
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
  buyerBusinessId: string | null
): Promise<MarketTransaction> {
  const gross = Number((listing.unit_price * soldQuantity).toFixed(2));
  const fee = Number((gross * MARKET_TRANSACTION_FEE).toFixed(2));
  const net = Number((gross - fee).toFixed(2));

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

  const { data: txRow, error: txError } = await client
    .from("market_transactions")
    .insert({
      listing_id: listing.id,
      seller_player_id: listing.owner_player_id,
      buyer_player_id: buyerPlayerId,
      buyer_type: buyerType,
      seller_business_id: listing.source_business_id,
      buyer_business_id: buyerBusinessId,
      city_id: listing.city_id,
      item_key: listing.item_key,
      quality: listing.quality,
      quantity: soldQuantity,
      unit_price: listing.unit_price,
      gross_total: gross,
      market_fee: fee,
      net_total: net,
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
  let query = client.from("market_listings").select("*").order("created_at", { ascending: false });

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
      updated_at: new Date().toISOString(),
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

  const now = new Date().toISOString();
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
  const listing = await getListing(client, input.listingId);
  if (listing.status !== "active") throw new Error("Listing is not active.");
  if (listing.owner_player_id === playerId) throw new Error("Cannot buy your own listing.");
  if (input.quantity > listing.quantity) throw new Error("Requested quantity exceeds listing availability.");

  let buyerBusiness: { id: string; city_id: string } | null = null;
  if (input.buyerBusinessId) {
    const business = await ensureOwnedBusiness(client, playerId, input.buyerBusinessId);
    buyerBusiness = { id: business.id, city_id: business.city_id };
  }

  const soldQuantity = input.quantity;
  await applySourceInventorySale(client, listing, soldQuantity);

  const nextQty = listing.quantity - soldQuantity;
  const nextReserved = Math.max(0, listing.reserved_quantity - soldQuantity);
  const nextStatus = nextQty <= 0 ? "filled" : "active";
  const now = new Date().toISOString();

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

  if (buyerBusiness) {
    const { data: targetBusinessRow, error: targetBusinessError } = await client
      .from("business_inventory")
      .select("id, quantity")
      .eq("owner_player_id", playerId)
      .eq("business_id", buyerBusiness.id)
      .eq("item_key", listing.item_key)
      .eq("quality", listing.quality)
      .maybeSingle();

    if (targetBusinessError) throw targetBusinessError;

    if (!targetBusinessRow) {
      const { error: insertError } = await client.from("business_inventory").insert({
        owner_player_id: playerId,
        business_id: buyerBusiness.id,
        city_id: buyerBusiness.city_id,
        item_key: listing.item_key,
        quality: listing.quality,
        quantity: soldQuantity,
        reserved_quantity: 0,
      });
      if (insertError) throw insertError;
    } else {
      const { error: updateError } = await client
        .from("business_inventory")
        .update({
          quantity: toNumber(targetBusinessRow.quantity) + soldQuantity,
          updated_at: now,
        })
        .eq("id", targetBusinessRow.id);
      if (updateError) throw updateError;
    }
  } else {
    const { data: personalRow, error: personalError } = await client
      .from("personal_inventory")
      .select("id, quantity")
      .eq("player_id", playerId)
      .eq("item_key", listing.item_key)
      .eq("quality", listing.quality)
      .maybeSingle();

    if (personalError) throw personalError;

    if (!personalRow) {
      const { error: insertError } = await client.from("personal_inventory").insert({
        player_id: playerId,
        item_key: listing.item_key,
        quality: listing.quality,
        quantity: soldQuantity,
      });
      if (insertError) throw insertError;
    } else {
      const { error: updateError } = await client
        .from("personal_inventory")
        .update({
          quantity: toNumber(personalRow.quantity) + soldQuantity,
          updated_at: now,
        })
        .eq("id", personalRow.id);
      if (updateError) throw updateError;
    }
  }

  const transaction = await settleSaleAccounting(
    client,
    listing,
    soldQuantity,
    "player",
    playerId,
    buyerBusiness?.id ?? null
  );

  return {
    listing: normalizeListing(updatedRow as MarketListing),
    transaction,
  };
}

export async function recordNpcPurchase(
  client: QueryClient,
  input: RecordNpcPurchaseInput
): Promise<{ listing: MarketListing; transaction: MarketTransaction }> {
  const listing = await getListing(client, input.listingId);
  if (listing.status !== "active") throw new Error("Listing is not active.");

  const soldQuantity = Math.max(1, Math.min(input.quantity, listing.quantity));
  await applySourceInventorySale(client, listing, soldQuantity);

  const nextQty = listing.quantity - soldQuantity;
  const nextReserved = Math.max(0, listing.reserved_quantity - soldQuantity);
  const nextStatus = nextQty <= 0 ? "filled" : "active";
  const now = new Date().toISOString();

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

  const transaction = await settleSaleAccounting(client, listing, soldQuantity, "npc", null, null);

  return {
    listing: normalizeListing(updatedRow as MarketListing),
    transaction,
  };
}
