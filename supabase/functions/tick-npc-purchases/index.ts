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
    .select("id, player_id, type")
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

    const { data: inventoryRows } = await supabase
      .from("business_inventory")
      .select("id, item_key, quantity, reserved_quantity, quality")
      .eq("owner_player_id", store.player_id)
      .eq("business_id", store.id)
      .gt("quantity", 0)
      .order("updated_at", { ascending: true })
      .limit(50);

    const availableRows = (inventoryRows ?? []).filter(
      (row) => toNumber(row.quantity) - toNumber(row.reserved_quantity) > 0
    );

    if (availableRows.length === 0) {
      storesProcessed += 1;
      continue;
    }

    for (let i = 0; i < effectiveAttempts; i += 1) {
      const activeRows = availableRows.filter(
        (row) => toNumber(row.quantity) - toNumber(row.reserved_quantity) > 0
      );
      if (activeRows.length === 0) break;

      const chosen = activeRows[Math.floor(Math.random() * activeRows.length)];
      const available = toNumber(chosen.quantity) - toNumber(chosen.reserved_quantity);
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
      const unitPrice = Math.max(0.01, ceiling * qualityFactor * randBetween(0.6, 1));

      const saleGross = Number((soldQty * unitPrice).toFixed(2));
      const fee = Number((saleGross * MARKET_TRANSACTION_FEE).toFixed(2));
      const net = Number((saleGross - fee).toFixed(2));

      const nextQuantity = toNumber(chosen.quantity) - soldQty;
      if (nextQuantity <= 0) {
        await supabase.from("business_inventory").delete().eq("id", chosen.id);
      } else {
        await supabase
          .from("business_inventory")
          .update({
            quantity: nextQuantity,
            reserved_quantity: Math.min(toNumber(chosen.reserved_quantity), nextQuantity),
            updated_at: new Date().toISOString(),
          })
          .eq("id", chosen.id);
        chosen.quantity = nextQuantity;
      }

      await supabase.from("business_accounts").insert([
        {
          business_id: store.id,
          amount: saleGross,
          entry_type: "credit",
          category: "npc_sale",
          description: `NPC purchase: ${soldQty}x ${chosen.item_key}`,
          reference_id: null,
        },
        {
          business_id: store.id,
          amount: fee,
          entry_type: "debit",
          category: "market_fee",
          description: `Market fee on NPC purchase: ${soldQty}x ${chosen.item_key}`,
          reference_id: null,
        },
      ]);

      salesCount += 1;
      unitsSold += soldQty;
      grossRevenue += saleGross;
      feeTotal += fee;
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
