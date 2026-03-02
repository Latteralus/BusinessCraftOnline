// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STORE_TYPES = ["general_store", "specialty_store"] as const;
const MARKET_TRANSACTION_FEE = 0.03;
const NPC_SUBTICK_SECONDS = 30;
const NPC_SUBTICKS_PER_TICK = 20;
const NPC_SHOPPERS_PER_SUBTICK_BASE = 18;
const NPC_SUBTICK_VARIANCE = 0.3;
const NPC_PRICE_BAND_PERCENT = 0.05;

const NPC_DEMAND_CURVE = [
  { startHour: 0, endHour: 5, multiplier: 0.3 },
  { startHour: 6, endHour: 8, multiplier: 0.6 },
  { startHour: 9, endHour: 11, multiplier: 1.0 },
  { startHour: 12, endHour: 13, multiplier: 1.3 },
  { startHour: 14, endHour: 16, multiplier: 0.85 },
  { startHour: 17, endHour: 20, multiplier: 1.15 },
  { startHour: 21, endHour: 23, multiplier: 0.5 },
] as const;

const NPC_SHOPPER_TIERS = [
  {
    key: "small",
    label: "Small",
    spawnWeight: 0.65,
    budgetMin: 5,
    budgetMax: 40,
    maxItemsMin: 1,
    maxItemsMax: 5,
  },
  {
    key: "medium",
    label: "Medium",
    spawnWeight: 0.28,
    budgetMin: 40,
    budgetMax: 100,
    maxItemsMin: 5,
    maxItemsMax: 15,
  },
  {
    key: "large",
    label: "Large",
    spawnWeight: 0.07,
    budgetMin: 100,
    budgetMax: 200,
    maxItemsMin: 15,
    maxItemsMax: 25,
  },
] as const;

const NPC_CATEGORY_INTEREST_WEIGHTS: Record<string, number> = {
  water: 1.4,
  iron_ore: 1.3,
  flour: 1.3,
  chips: 1.2,
  wheat: 1.1,
  wood_plank: 1.1,
  iron_bar: 1.1,
  red_wine: 1.0,
  chair: 0.9,
  pickaxe: 0.8,
  axe: 0.8,
  drill_bit: 0.7,
};

const SHOPPER_NAME_PREFIXES = ["Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Jamie"];
const SHOPPER_NAME_SUFFIXES = ["Stone", "Reed", "Baker", "Cole", "Hayes", "Fox", "Shaw"];

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

function randBetweenWithRng(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

function randomIntWithRng(rng: () => number, min: number, max: number): number {
  return Math.floor(randBetweenWithRng(rng, min, max + 1));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getDemandCurveMultiplierForHour(hour: number): number {
  const window = NPC_DEMAND_CURVE.find((entry) => hour >= entry.startHour && hour <= entry.endHour);
  return window?.multiplier ?? 1;
}

function pickWeighted<T>(rows: T[], getWeight: (row: T) => number, rng: () => number): T {
  const total = rows.reduce((sum, row) => sum + Math.max(0, getWeight(row)), 0);
  if (total <= 0) return rows[0];

  const roll = rng() * total;
  let running = 0;
  for (const row of rows) {
    running += Math.max(0, getWeight(row));
    if (roll <= running) return row;
  }

  return rows[rows.length - 1];
}

function makeShopperName(subTickIndex: number, shopperIndex: number, rng: () => number): string {
  const first = SHOPPER_NAME_PREFIXES[randomIntWithRng(rng, 0, SHOPPER_NAME_PREFIXES.length - 1)];
  const last = SHOPPER_NAME_SUFFIXES[randomIntWithRng(rng, 0, SHOPPER_NAME_SUFFIXES.length - 1)];
  return `${first} ${last} #${subTickIndex + 1}-${shopperIndex + 1}`;
}

async function getOrCreateSubtickState(supabase: ReturnType<typeof createClient>) {
  const { data, error } = await supabase
    .from("npc_market_subtick_state")
    .select("state_key, tick_window_started_at, sub_tick_index")
    .eq("state_key", "global")
    .maybeSingle();
  if (error) throw error;

  if (data) {
    return {
      stateKey: String(data.state_key),
      tickWindowStartedAt: String(data.tick_window_started_at),
      subTickIndex: Number(data.sub_tick_index),
    };
  }

  const nowIso = new Date().toISOString();
  const { data: inserted, error: insertError } = await supabase
    .from("npc_market_subtick_state")
    .insert({
      state_key: "global",
      tick_window_started_at: nowIso,
      sub_tick_index: 0,
    })
    .select("state_key, tick_window_started_at, sub_tick_index")
    .single();

  if (insertError) throw insertError;

  return {
    stateKey: String(inserted.state_key),
    tickWindowStartedAt: String(inserted.tick_window_started_at),
    subTickIndex: Number(inserted.sub_tick_index),
  };
}

async function persistSubtickState(
  supabase: ReturnType<typeof createClient>,
  input: { tickWindowStartedAt: string; subTickIndex: number }
) {
  const { error } = await supabase
    .from("npc_market_subtick_state")
    .update({
      tick_window_started_at: input.tickWindowStartedAt,
      sub_tick_index: input.subTickIndex,
      updated_at: new Date().toISOString(),
    })
    .eq("state_key", "global");

  if (error) throw error;
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
  soldQty: number,
  meta?: {
    shopperName?: string | null;
    shopperTier?: string | null;
    shopperBudget?: number | null;
    subTickIndex?: number | null;
    tickWindowStartedAt?: string | null;
  }
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
    shopper_name: meta?.shopperName ?? null,
    shopper_tier: meta?.shopperTier ?? null,
    shopper_budget: meta?.shopperBudget ?? null,
    sub_tick_index: meta?.subTickIndex ?? null,
    tick_window_started_at: meta?.tickWindowStartedAt ?? null,
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

  const now = new Date();
  const state = await getOrCreateSubtickState(supabase);
  const cycleDurationMs = NPC_SUBTICK_SECONDS * NPC_SUBTICKS_PER_TICK * 1000;
  const stateStartMs = Number(new Date(state.tickWindowStartedAt).getTime());
  const stateStartValid = Number.isFinite(stateStartMs);

  let tickWindowStartedAt = stateStartValid ? state.tickWindowStartedAt : now.toISOString();
  let subTickIndex = clamp(state.subTickIndex + 1, 0, NPC_SUBTICKS_PER_TICK - 1);

  if (!stateStartValid || now.getTime() - stateStartMs >= cycleDurationMs || subTickIndex >= NPC_SUBTICKS_PER_TICK) {
    tickWindowStartedAt = now.toISOString();
    subTickIndex = 0;
  }

  if (subTickIndex === 0 && stateStartValid && now.getTime() - stateStartMs < cycleDurationMs) {
    tickWindowStartedAt = now.toISOString();
  }

  await persistSubtickState(supabase, { tickWindowStartedAt, subTickIndex });

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

  const demandMultiplier = getDemandCurveMultiplierForHour(now.getUTCHours());

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

    const trafficMultiplier = Math.pow(1.05, Math.max(0, Number(storefrontAppealLevel)));
    const priceToleranceMultiplier = Math.pow(1.03, Math.max(0, Number(customerServiceLevel)));

    const seededRng = createRng(hashString(`${tickWindowStartedAt}|${subTickIndex}|${store.id}`));
    const variance = 1 + randBetweenWithRng(seededRng, -NPC_SUBTICK_VARIANCE, NPC_SUBTICK_VARIANCE);
    const shoppersThisSubtick = Math.max(
      1,
      Math.floor(NPC_SHOPPERS_PER_SUBTICK_BASE * demandMultiplier * trafficMultiplier * variance)
    );

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

    for (let shopperIndex = 0; shopperIndex < shoppersThisSubtick; shopperIndex += 1) {
      const tier = pickWeighted(NPC_SHOPPER_TIERS as unknown as Array<(typeof NPC_SHOPPER_TIERS)[number]>, (row) => row.spawnWeight, seededRng);
      const shopperBudget = round2(randBetweenWithRng(seededRng, tier.budgetMin, tier.budgetMax));
      const shopperMaxItems = Math.max(
        1,
        randomIntWithRng(seededRng, tier.maxItemsMin, Math.max(tier.maxItemsMin, tier.maxItemsMax))
      );
      const priceSensitivity = randBetweenWithRng(seededRng, 0.7, 1.0);
      const qualityPreference = randBetweenWithRng(seededRng, 0.0, 1.0);
      const shopperName = makeShopperName(subTickIndex, shopperIndex, seededRng);

      let remainingBudget = shopperBudget;
      let remainingItems = shopperMaxItems;
      const desiredPurchases = Math.max(1, Math.min(6, shopperMaxItems));

      for (let purchaseAttempt = 0; purchaseAttempt < desiredPurchases; purchaseAttempt += 1) {
        const activeRows = availableRows.filter((row) => toNumber(row.quantity) > 0 && toNumber(row.reserved_quantity) > 0);
        if (activeRows.length === 0 || remainingItems <= 0 || remainingBudget <= 0) break;

        const itemKeys = Array.from(new Set(activeRows.map((row) => String(row.item_key))));
        const targetItemKey = pickWeighted(
          itemKeys,
          (key) => NPC_CATEGORY_INTEREST_WEIGHTS[key] ?? 0.5,
          seededRng
        );

        const strictCeiling = ceilForItem(targetItemKey) * priceToleranceMultiplier * priceSensitivity;
        const candidates = activeRows.filter(
          (row) => row.item_key === targetItemKey && toNumber(row.unit_price) <= strictCeiling
        );
        if (candidates.length === 0) continue;

        const cheapest = Math.min(...candidates.map((row) => toNumber(row.unit_price)));
        const priceBandMax = cheapest * (1 + NPC_PRICE_BAND_PERCENT);
        const withinBand = candidates.filter((row) => toNumber(row.unit_price) <= priceBandMax);
        if (withinBand.length === 0) continue;

        const chosen = [...withinBand].sort((a, b) => {
          if (qualityPreference >= 0.5) {
            const qualityDiff = toNumber(b.quality) - toNumber(a.quality);
            if (qualityDiff !== 0) return qualityDiff;
            return toNumber(a.unit_price) - toNumber(b.unit_price);
          }

          const priceDiff = toNumber(a.unit_price) - toNumber(b.unit_price);
          if (priceDiff !== 0) return priceDiff;
          return toNumber(b.quality) - toNumber(a.quality);
        })[0];

        const chosenPrice = toNumber(chosen.unit_price);
        if (chosenPrice <= 0) continue;

        const available = Math.min(toNumber(chosen.quantity), toNumber(chosen.reserved_quantity));
        const affordable = Math.floor(remainingBudget / chosenPrice);
        const maxByAttempt = Math.max(1, Math.min(6, 1 + Math.floor(Number(listingCapacityLevel) / 2)));
        const soldQty = Math.max(
          1,
          Math.min(
            available,
            remainingItems,
            affordable,
            randomIntWithRng(seededRng, 1, Math.max(1, Math.min(maxByAttempt, remainingItems)))
          )
        );

        if (!Number.isFinite(soldQty) || soldQty <= 0 || soldQty > available || soldQty > affordable) {
          continue;
        }

        const settled = await settleListingSale(supabase, chosen, soldQty, {
          shopperName,
          shopperTier: tier.key,
          shopperBudget,
          subTickIndex,
          tickWindowStartedAt,
        });

        chosen.quantity = Math.max(0, toNumber(chosen.quantity) - soldQty);
        chosen.reserved_quantity = Math.max(0, toNumber(chosen.reserved_quantity) - soldQty);

        remainingBudget = round2(Math.max(0, remainingBudget - settled.gross));
        remainingItems = Math.max(0, remainingItems - soldQty);
        salesCount += 1;
        unitsSold += soldQty;
        grossRevenue += settled.gross;
        feeTotal += settled.fee;

        const continueShoppingChance = remainingItems > 0 ? 0.45 : 0;
        if (seededRng() > continueShoppingChance) break;
      }
    }

    storesProcessed += 1;
  }

  return new Response(
    JSON.stringify({
      ok: true,
      function: "tick-npc-purchases",
      storesProcessed,
      subTickIndex,
      tickWindowStartedAt,
      demandMultiplier,
      salesCount,
      unitsSold,
      grossRevenue: Number(grossRevenue.toFixed(2)),
      feeTotal: Number(feeTotal.toFixed(2)),
      netRevenue: Number((grossRevenue - feeTotal).toFixed(2)),
    }),
    { headers: { "Content-Type": "application/json" } }
  );
});
