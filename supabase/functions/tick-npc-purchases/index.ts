// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STORE_TYPES = ["general_store", "specialty_store"] as const;
const MARKET_TRANSACTION_FEE = 0.03;

const NPC_PRICE_CEILINGS: Record<string, number> = {
  iron_ore: 2.0,
  coal: 1.5,
  copper_ore: 2.8,
  gravel: 0.8,
  crude_oil: 1.6,
  raw_wood: 1.8,
  water: 0.25,
  wheat: 3.0,
  potato: 2.2,
  corn: 2.0,
  red_grape: 2.5,
  seeds: 0.8,
  wood_plank: 1.2,
  wood_handle: 5.5,
  iron_bar: 5.0,
  steel_bar: 8.0,
  steel_beam: 35.0,
  pickaxe: 28.0,
  axe: 24.0,
  drill_bit: 45.0,
  chair: 45.0,
  table: 120.0,
  flour: 0.8,
  chips: 0.7,
  red_wine: 8.0,
  whiskey: 10.0,
  corn_whiskey: 9.0,
};

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

function ceilForItem(itemKey: string): number {
  return NPC_PRICE_CEILINGS[itemKey] ?? 1;
}

function calcListingAttempts(level: number): number {
  return Math.max(1, Math.min(8, 1 + Math.floor(level * 0.6)));
}

function randBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

async function settleListingSale(
  supabase: ReturnType<typeof createClient>,
  listing: {
    id: string;
    owner_player_id: string;
    source_business_id: string;
    item_key: string;
    quality: number | string;
    quantity: number | string;
    reserved_quantity: number | string;
    unit_price: number | string;
    city_id: string;
  },
  soldQty: number
) {
  const listingQty = toNumber(listing.quantity);
  const listingReserved = toNumber(listing.reserved_quantity);
  const listingPrice = toNumber(listing.unit_price);

  const gross = Number((listingPrice * soldQty).toFixed(2));
  const fee = Number((gross * MARKET_TRANSACTION_FEE).toFixed(2));
  const net = Number((gross - fee).toFixed(2));

  const nextQty = listingQty - soldQty;
  const nextReserved = Math.max(0, listingReserved - soldQty);
  const nextStatus = nextQty <= 0 ? "filled" : "active";
  const now = new Date().toISOString();

  const { error: listingError } = await supabase
    .from("market_listings")
    .update({
      quantity: Math.max(0, nextQty),
      reserved_quantity: Math.max(0, nextReserved),
      status: nextStatus,
      filled_at: nextStatus === "filled" ? now : null,
      updated_at: now,
    })
    .eq("id", listing.id);
  if (listingError) throw listingError;

  await supabase.from("business_accounts").insert([
    {
      business_id: listing.source_business_id,
      amount: gross,
      entry_type: "credit",
      category: "npc_sale",
      description: `NPC market purchase: ${soldQty}x ${listing.item_key}`,
      reference_id: listing.id,
    },
    {
      business_id: listing.source_business_id,
      amount: fee,
      entry_type: "debit",
      category: "market_fee",
      description: `Market fee on NPC purchase: ${soldQty}x ${listing.item_key}`,
      reference_id: listing.id,
    },
  ]);

  await supabase.from("market_transactions").insert({
    listing_id: listing.id,
    seller_player_id: listing.owner_player_id,
    buyer_player_id: null,
    buyer_type: "npc",
    seller_business_id: listing.source_business_id,
    buyer_business_id: null,
    city_id: listing.city_id,
    item_key: listing.item_key,
    quality: Math.max(1, Math.min(100, toNumber(listing.quality))),
    quantity: soldQty,
    unit_price: listingPrice,
    gross_total: gross,
    market_fee: fee,
    net_total: net,
  });

  return { gross, fee, net };
}

Deno.serve(async () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: stores, error: storesError } = await supabase
    .from("businesses")
    .select("id, player_id, type, city_id")
    .in("type", [...STORE_TYPES]);

  if (storesError) {
    return new Response(JSON.stringify({ ok: false, error: storesError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let storesProcessed = 0;
  let salesCount = 0;
  let unitsSold = 0;
  let grossRevenue = 0;
  let feeTotal = 0;

  for (const store of stores ?? []) {
    const { data: upgrades } = await supabase
      .from("business_upgrades")
      .select("upgrade_key, level")
      .eq("business_id", store.id)
      .in("upgrade_key", ["listing_capacity", "storefront_appeal", "customer_service"]);

    const listingCapacityLevel =
      upgrades?.find((row) => row.upgrade_key === "listing_capacity")?.level ?? 0;
    const storefrontAppealLevel =
      upgrades?.find((row) => row.upgrade_key === "storefront_appeal")?.level ?? 0;
    const customerServiceLevel =
      upgrades?.find((row) => row.upgrade_key === "customer_service")?.level ?? 0;

    const listingAttempts = calcListingAttempts(Number(listingCapacityLevel));
    const trafficMultiplier = Math.pow(1.05, Math.max(0, Number(storefrontAppealLevel)));
    const priceToleranceMultiplier = Math.pow(1.03, Math.max(0, Number(customerServiceLevel)));
    const effectiveAttempts = Math.max(1, Math.floor(listingAttempts * trafficMultiplier));

    const { data: listingRows } = await supabase
      .from("market_listings")
      .select("id, owner_player_id, source_business_id, city_id, item_key, quality, quantity, reserved_quantity, unit_price")
      .eq("owner_player_id", store.player_id)
      .eq("source_business_id", store.id)
      .eq("status", "active")
      .gt("quantity", 0)
      .order("unit_price", { ascending: true })
      .limit(50);

    const availableRows = (listingRows ?? []).filter(
      (row) => toNumber(row.quantity) > 0 && toNumber(row.reserved_quantity) > 0
    );

    if (availableRows.length === 0) {
      storesProcessed += 1;
      continue;
    }

    for (let i = 0; i < effectiveAttempts; i += 1) {
      const activeRows = availableRows.filter((row) => toNumber(row.quantity) > 0);
      if (activeRows.length === 0) break;

      const shuffled = [...activeRows].sort(() => Math.random() - 0.5);
      const chosen = shuffled[0];
      const available = toNumber(chosen.quantity);
      if (available <= 0) continue;

      const demandRoll = Math.random();
      const baseConversion = 0.45;
      const conversionChance = Math.min(0.95, baseConversion * trafficMultiplier);
      if (demandRoll > conversionChance) continue;

      const maxUnitsPerSale = Math.max(1, Math.min(12, 2 + Math.floor(listingCapacityLevel / 2)));
      const soldQty = Math.max(1, Math.min(available, Math.floor(randBetween(1, maxUnitsPerSale + 1))));

      const quality = Math.max(1, Math.min(100, toNumber(chosen.quality)));
      const qualityFactor = 0.7 + (quality / 100) * 0.4;
      const ceiling = ceilForItem(chosen.item_key) * priceToleranceMultiplier;
      const listingPrice = toNumber(chosen.unit_price);
      const acceptablePrice = ceiling * qualityFactor;
      if (listingPrice > acceptablePrice) continue;

      const settled = await settleListingSale(supabase, chosen, soldQty);
      chosen.quantity = Math.max(0, toNumber(chosen.quantity) - soldQty);

      salesCount += 1;
      unitsSold += soldQty;
      grossRevenue += settled.gross;
      feeTotal += settled.fee;
    }

    storesProcessed += 1;
  }

  return new Response(
    JSON.stringify({
      ok: true,
      function: "tick-npc-purchases",
      storesProcessed,
      salesCount,
      unitsSold,
      grossRevenue: Number(grossRevenue.toFixed(2)),
      feeTotal: Number(feeTotal.toFixed(2)),
      netRevenue: Number((grossRevenue - feeTotal).toFixed(2)),
    }),
    { headers: { "Content-Type": "application/json" } }
  );
});
