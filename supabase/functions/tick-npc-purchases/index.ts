// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STORE_TYPES = ["general_store", "specialty_store"] as const;
const MARKET_TRANSACTION_FEE = 0.03;
const NPC_SUBTICK_SECONDS = 30;
const NPC_SUBTICKS_PER_TICK = 20;
const NPC_SHOPPERS_PER_SUBTICK_BASE = 18;
const NPC_SUBTICK_VARIANCE = 0.3;
const NPC_PRICE_BAND_PERCENT = 0.05;
const STOREFRONT_TRAFFIC_MULTIPLIER_MIN = 0.5;
const STOREFRONT_TRAFFIC_MULTIPLIER_MAX = 3;
const STOREFRONT_AD_BUDGET_FOR_MAX_EFFECT = 200;
const STOREFRONT_AD_MAX_TRAFFIC_BOOST = 1;

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
  water: 2.5,
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

async function writeTickRunLog(
  supabase: ReturnType<typeof createClient>,
  input: {
    status: "ok" | "error";
    startedAtIso: string;
    finishedAtIso: string;
    durationMs: number;
    processedCount: number;
    metrics?: Record<string, unknown>;
    errorMessage?: string | null;
  }
) {
  await supabase.from("tick_run_logs").insert({
    tick_name: "tick-npc-purchases",
    status: input.status,
    started_at: input.startedAtIso,
    finished_at: input.finishedAtIso,
    duration_ms: Math.max(0, Math.floor(input.durationMs)),
    processed_count: Math.max(0, Math.floor(input.processedCount)),
    metrics: input.metrics ?? {},
    error_message: input.errorMessage ?? null,
  });
}

async function writeStorefrontSnapshot(
  supabase: ReturnType<typeof createClient>,
  input: {
    ownerPlayerId: string;
    businessId: string;
    cityId: string;
    tickWindowStartedAt: string;
    subTickIndex: number;
    shoppersGenerated: number;
    salesCount: number;
    unitsSold: number;
    grossRevenue: number;
    feeTotal: number;
    adSpend: number;
    trafficMultiplier: number;
    demandMultiplier: number;
  }
) {
  await supabase.from("market_storefront_performance_snapshots").insert({
    owner_player_id: input.ownerPlayerId,
    business_id: input.businessId,
    city_id: input.cityId,
    tick_window_started_at: input.tickWindowStartedAt,
    sub_tick_index: input.subTickIndex,
    shoppers_generated: Math.max(0, Math.floor(input.shoppersGenerated)),
    sales_count: Math.max(0, Math.floor(input.salesCount)),
    units_sold: Math.max(0, Math.floor(input.unitsSold)),
    gross_revenue: round2(Math.max(0, input.grossRevenue)),
    fee_total: round2(Math.max(0, input.feeTotal)),
    ad_spend: round2(Math.max(0, input.adSpend)),
    traffic_multiplier: Number(input.trafficMultiplier.toFixed(3)),
    demand_multiplier: Number(input.demandMultiplier.toFixed(3)),
  });
}

Deno.serve(async () => {
  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  try {
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

    const { data: activeListingRows, error: activeListingRowsError } = await supabase
      .from("market_listings")
      .select("source_business_id")
      .eq("status", "active")
      .gt("quantity", 0)
      .gt("reserved_quantity", 0);

    if (activeListingRowsError) {
      throw activeListingRowsError;
    }

    const activeBusinessIds = Array.from(
      new Set((activeListingRows ?? []).map((row) => String(row.source_business_id)).filter(Boolean))
    );

    const { data: stores, error: storesError } =
      activeBusinessIds.length > 0
        ? await supabase
            .from("businesses")
            .select("id, player_id, type, city_id")
            .in("id", activeBusinessIds)
        : { data: [], error: null };

    if (storesError) {
      throw storesError;
    }

    let storesProcessed = 0;
    let salesCount = 0;
    let unitsSold = 0;
    let grossRevenue = 0;
    let feeTotal = 0;
    let adSpendTotal = 0;
    let adEnabledStores = 0;

    const demandMultiplier = getDemandCurveMultiplierForHour(now.getUTCHours());

    for (const store of stores ?? []) {
      let storeSalesCount = 0;
      let storeUnitsSold = 0;
      let storeGrossRevenue = 0;
      let storeFeeTotal = 0;
      const isStoreType = STORE_TYPES.includes(store.type as (typeof STORE_TYPES)[number]);
      let listingCapacityLevel = 0;
      let storefrontAppealLevel = 0;
      let customerServiceLevel = 0;

      if (isStoreType) {
        const { data: upgrades } = await supabase
          .from("business_upgrades")
          .select("upgrade_key, level")
          .eq("business_id", store.id)
          .in("upgrade_key", ["listing_capacity", "storefront_appeal", "customer_service"]);

        listingCapacityLevel = upgrades?.find((row) => row.upgrade_key === "listing_capacity")?.level ?? 0;
        storefrontAppealLevel = upgrades?.find((row) => row.upgrade_key === "storefront_appeal")?.level ?? 0;
        customerServiceLevel = upgrades?.find((row) => row.upgrade_key === "customer_service")?.level ?? 0;
      }

      const trafficMultiplier = isStoreType ? Math.pow(1.05, Math.max(0, Number(storefrontAppealLevel))) : 1;
      const priceToleranceMultiplier = isStoreType ? Math.pow(1.03, Math.max(0, Number(customerServiceLevel))) : 1;

      const { data: storefront } = isStoreType
        ? await supabase
            .from("market_storefront_settings")
            .select("id, ad_budget_per_tick, traffic_multiplier, is_ad_enabled")
            .eq("owner_player_id", store.player_id)
            .eq("business_id", store.id)
            .maybeSingle()
        : { data: null };

      const configuredTrafficMultiplier = storefront
        ? clamp(
            toNumber(storefront.traffic_multiplier),
            STOREFRONT_TRAFFIC_MULTIPLIER_MIN,
            STOREFRONT_TRAFFIC_MULTIPLIER_MAX
          )
        : 1;

    let adBudgetApplied = 0;
    let adBoostMultiplier = 1;

    if (isStoreType && storefront?.is_ad_enabled) {
      const adBudget = Math.max(0, toNumber(storefront.ad_budget_per_tick));
      if (adBudget > 0) {
        const { data: balanceValue, error: balanceError } = await supabase.rpc("get_business_account_balance", {
          p_business_id: store.id,
        });

        const balance = balanceError ? 0 : toNumber(balanceValue);
        if (balance >= adBudget) {
          await supabase.from("business_accounts").insert({
            business_id: store.id,
            amount: adBudget,
            entry_type: "debit",
            category: "storefront_ads",
            reference_id: null,
            description: "Storefront ad spend for NPC traffic",
          });

          adBudgetApplied = adBudget;
          adBoostMultiplier =
            1 +
            Math.min(
              STOREFRONT_AD_MAX_TRAFFIC_BOOST,
              adBudget / Math.max(1, STOREFRONT_AD_BUDGET_FOR_MAX_EFFECT)
            );
          adEnabledStores += 1;
        }
      }
    }

    const seededRng = createRng(hashString(`${tickWindowStartedAt}|${subTickIndex}|${store.id}`));
    const variance = 1 + randBetweenWithRng(seededRng, -NPC_SUBTICK_VARIANCE, NPC_SUBTICK_VARIANCE);
    const shoppersThisSubtick = Math.max(
      1,
      Math.floor(
        NPC_SHOPPERS_PER_SUBTICK_BASE *
          demandMultiplier *
          trafficMultiplier *
          configuredTrafficMultiplier *
          adBoostMultiplier *
          variance
      )
    );

    adSpendTotal += adBudgetApplied;

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
      await writeStorefrontSnapshot(supabase, {
        ownerPlayerId: store.player_id,
        businessId: store.id,
        cityId: store.city_id,
        tickWindowStartedAt,
        subTickIndex,
        shoppersGenerated: shoppersThisSubtick,
        salesCount: 0,
        unitsSold: 0,
        grossRevenue: 0,
        feeTotal: 0,
        adSpend: adBudgetApplied,
        trafficMultiplier: trafficMultiplier * configuredTrafficMultiplier * adBoostMultiplier,
        demandMultiplier,
      });
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
        storeSalesCount += 1;
        unitsSold += soldQty;
        storeUnitsSold += soldQty;
        grossRevenue += settled.gross;
        storeGrossRevenue += settled.gross;
        feeTotal += settled.fee;
        storeFeeTotal += settled.fee;

        const continueShoppingChance = remainingItems > 0 ? 0.45 : 0;
        if (seededRng() > continueShoppingChance) break;
      }
    }

      await writeStorefrontSnapshot(supabase, {
        ownerPlayerId: store.player_id,
        businessId: store.id,
        cityId: store.city_id,
        tickWindowStartedAt,
        subTickIndex,
        shoppersGenerated: shoppersThisSubtick,
        salesCount: storeSalesCount,
        unitsSold: storeUnitsSold,
        grossRevenue: storeGrossRevenue,
        feeTotal: storeFeeTotal,
        adSpend: adBudgetApplied,
        trafficMultiplier: trafficMultiplier * configuredTrafficMultiplier * adBoostMultiplier,
        demandMultiplier,
      });

      storesProcessed += 1;
    }

    const payload = {
      ok: true,
      function: "tick-npc-purchases",
      storesProcessed,
      subTickIndex,
      tickWindowStartedAt,
      demandMultiplier,
      adSpendTotal: Number(adSpendTotal.toFixed(2)),
      adEnabledStores,
      salesCount,
      unitsSold,
      grossRevenue: Number(grossRevenue.toFixed(2)),
      feeTotal: Number(feeTotal.toFixed(2)),
      netRevenue: Number((grossRevenue - feeTotal).toFixed(2)),
    };

    const finishedAtIso = new Date().toISOString();
    await writeTickRunLog(supabase, {
      status: "ok",
      startedAtIso,
      finishedAtIso,
      durationMs: new Date(finishedAtIso).getTime() - startedAt.getTime(),
      processedCount: storesProcessed,
      metrics: payload,
      errorMessage: null,
    });

    return new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const finishedAtIso = new Date().toISOString();
    const message = error instanceof Error ? error.message : "tick-npc-purchases failed";

    await writeTickRunLog(supabase, {
      status: "error",
      startedAtIso,
      finishedAtIso,
      durationMs: new Date(finishedAtIso).getTime() - startedAt.getTime(),
      processedCount: 0,
      metrics: {},
      errorMessage: message,
    });

    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
