// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { startTickRequest } from "../_shared/tick-runtime.ts";
import { getResolvedBusinessUpgradeEffects } from "../_shared/business-upgrades.ts";
import {
  STORE_BUSINESS_TYPES,
  isStoreBusinessType,
} from "../../../shared/businesses/store.ts";
import {
  getNpcBuyerPriceRange,
  NPC_STOREFRONT_FEE,
  NPC_CATEGORY_INTEREST_WEIGHTS,
  NPC_DEMAND_CURVE,
  NPC_PRICE_BAND_PERCENT,
  NPC_PRICE_CEILINGS,
  NPC_PRICE_RESPONSE_CURVE,
  NPC_PRICE_SENSITIVITY_MAX,
  NPC_PRICE_SENSITIVITY_MIN,
  NPC_QUALITY_PREFERENCE_MAX,
  NPC_QUALITY_PREFERENCE_MIN,
  NPC_SHOPPERS_PER_SUBTICK_BASE,
  NPC_SHOPPER_TIERS,
  NPC_SUBTICKS_PER_TICK,
  NPC_SUBTICK_SECONDS,
  NPC_SUBTICK_VARIANCE,
  STOREFRONT_AD_BUDGET_FOR_MAX_EFFECT,
  STOREFRONT_AD_MAX_TRAFFIC_BOOST,
  STOREFRONT_TRAFFIC_MULTIPLIER_MAX,
  STOREFRONT_TRAFFIC_MULTIPLIER_MIN,
} from "../../../shared/economy.ts";
import { makeNpcShopperName } from "../../../shared/core/npc-shopper-names.ts";

const NPC_CATEGORY_INTEREST_WEIGHT_BY_ITEM = Object.fromEntries(
  NPC_CATEGORY_INTEREST_WEIGHTS.map((entry) => [entry.itemKey, entry.weight])
) as Record<string, number>;

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

function ceilForItem(itemKey: string): number {
  return getNpcBuyerPriceRange(itemKey).max;
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

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
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

function getPriceCurveMultiplier(priceRatio: number): number {
  if (!Number.isFinite(priceRatio)) return 0;

  const first = NPC_PRICE_RESPONSE_CURVE[0];
  if (priceRatio <= first.ratio) return first.multiplier;

  for (let index = 1; index < NPC_PRICE_RESPONSE_CURVE.length; index += 1) {
    const previous = NPC_PRICE_RESPONSE_CURVE[index - 1];
    const current = NPC_PRICE_RESPONSE_CURVE[index];
    if (priceRatio <= current.ratio) {
      const span = current.ratio - previous.ratio;
      const t = span <= 0 ? 0 : (priceRatio - previous.ratio) / span;
      return lerp(previous.multiplier, current.multiplier, clamp(t, 0, 1));
    }
  }

  return NPC_PRICE_RESPONSE_CURVE[NPC_PRICE_RESPONSE_CURVE.length - 1]?.multiplier ?? 0;
}

function getShelfPurchaseScore(
  row: {
    item_key: string;
    unit_price: number | string;
    quality: number | string;
  },
  shopper: {
    priceSensitivity: number;
    qualityPreference: number;
  },
  priceToleranceMultiplier: number
): number {
  const baseWorth = Math.max(0.01, ceilForItem(String(row.item_key)));
  const rawPrice = Math.max(0.01, toNumber(row.unit_price));
  const baseRatio = rawPrice / baseWorth;
  if (baseRatio >= 2) return 0;

  const sensitivityRange = Math.max(0.0001, NPC_PRICE_SENSITIVITY_MAX - NPC_PRICE_SENSITIVITY_MIN);
  const qualityRange = Math.max(0.0001, NPC_QUALITY_PREFERENCE_MAX - NPC_QUALITY_PREFERENCE_MIN);
  const priceTolerance = clamp(priceToleranceMultiplier, 1, 1.5);
  const normalizedSensitivity = clamp(
    (shopper.priceSensitivity - NPC_PRICE_SENSITIVITY_MIN) / sensitivityRange,
    0,
    1
  );
  const normalizedQualityPreference = clamp(
    (shopper.qualityPreference - NPC_QUALITY_PREFERENCE_MIN) / qualityRange,
    0,
    1
  );
  const perceivedRatio = baseRatio / lerp(0.92, priceTolerance, normalizedSensitivity);
  const priceScore = getPriceCurveMultiplier(perceivedRatio);
  if (priceScore <= 0) return 0;

  const normalizedQuality = clamp(toNumber(row.quality) / 100, 0, 1);
  const qualityScore = lerp(0.85 + normalizedQuality * 0.3, 0.7 + normalizedQuality * 0.8, normalizedQualityPreference);
  return priceScore * qualityScore;
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

async function settleStoreInventorySale(
  supabase: ReturnType<typeof createClient>,
  shelfRow: {
    id: string;
    owner_player_id: string;
    business_id: string;
    item_key: string;
    quality: number | string;
    quantity: number | string;
    unit_price: number | string;
    city_id: string;
    business_name?: string;
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
  const { data: inventoryRow, error: inventoryError } = await supabase
    .from("business_inventory")
    .select("id, quantity, reserved_quantity")
    .eq("owner_player_id", shelfRow.owner_player_id)
    .eq("business_id", shelfRow.business_id)
    .eq("item_key", shelfRow.item_key)
    .eq("quality", shelfRow.quality)
    .maybeSingle();

  if (inventoryError) throw inventoryError;
  if (!inventoryRow) throw new Error("Shelf inventory backing row not found.");

  const inventoryQty = toNumber(inventoryRow.quantity);
  const inventoryReserved = toNumber(inventoryRow.reserved_quantity);
  const shelfQty = toNumber(shelfRow.quantity);
  const listingPrice = Math.max(0.01, toNumber(shelfRow.unit_price));
  const availableBackedQty = Math.max(0, Math.min(shelfQty, inventoryQty, inventoryReserved));

  if (soldQty > availableBackedQty) {
    throw new Error("Shelf sale exceeds reserved inventory backing.");
  }

  const gross = Number((listingPrice * soldQty).toFixed(2));
  const fee = round2(gross * NPC_STOREFRONT_FEE);
  const net = round2(gross - fee);

  const nextQty = inventoryQty - soldQty;
  const nextReserved = Math.max(0, Math.min(nextQty, inventoryReserved - soldQty));
  const nextShelfQty = shelfQty - soldQty;
  const now = new Date().toISOString();

  if (nextQty <= 0) {
    const { error: deleteError } = await supabase.from("business_inventory").delete().eq("id", inventoryRow.id);
    if (deleteError) throw deleteError;
  } else {
    const { error: updateError } = await supabase
      .from("business_inventory")
      .update({
        quantity: Math.max(0, nextQty),
        reserved_quantity: Math.max(0, nextReserved),
        updated_at: now,
      })
      .eq("id", inventoryRow.id);
    if (updateError) throw updateError;
  }

  if (nextShelfQty <= 0) {
    const { error: deleteShelfError } = await supabase.from("store_shelf_items").delete().eq("id", shelfRow.id);
    if (deleteShelfError) throw deleteShelfError;
  } else {
    const { error: updateShelfError } = await supabase
      .from("store_shelf_items")
      .update({
        quantity: nextShelfQty,
        updated_at: now,
      })
      .eq("id", shelfRow.id);
    if (updateShelfError) throw updateShelfError;
  }

  const { error: ledgerError } = await supabase.from("business_accounts").insert([
    {
      business_id: shelfRow.business_id,
      amount: gross,
      entry_type: "credit",
      category: "npc_sale",
      description: `Storefront purchase: ${soldQty}x ${shelfRow.item_key}`,
      reference_id: shelfRow.id,
    },
    {
      business_id: shelfRow.business_id,
      amount: fee,
      entry_type: "debit",
      category: "market_fee",
      description: `Storefront fee: ${soldQty}x ${shelfRow.item_key}`,
      reference_id: shelfRow.id,
    },
  ]);
  if (ledgerError) throw ledgerError;

  const { error: txError } = await supabase.from("market_transactions").insert({
    listing_id: null,
    seller_player_id: shelfRow.owner_player_id,
    buyer_player_id: null,
    buyer_type: "npc",
    seller_business_id: shelfRow.business_id,
    seller_business_name: shelfRow.business_name ?? "Unknown Business",
    buyer_business_id: null,
    buyer_business_name: null,
    city_id: shelfRow.city_id,
    item_key: shelfRow.item_key,
    quality: Math.max(1, Math.min(100, toNumber(shelfRow.quality))),
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
  if (txError) throw txError;

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

Deno.serve(async (request) => {
  const requestStart = await startTickRequest(request, "tick-npc-purchases");
  if ("response" in requestStart) return requestStart.response;

  const { supabase, release } = requestStart;
  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();
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

    const { data: stores, error: storesError } =
      await supabase
        .from("businesses")
        .select("id, name, player_id, type, city_id")
        .in("type", [...STORE_BUSINESS_TYPES]);

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
      const isStoreType = isStoreBusinessType(String(store.type));
      const effects = isStoreType
        ? await getResolvedBusinessUpgradeEffects(supabase, store.id, store.type)
        : null;

      const trafficMultiplier = isStoreType ? effects?.storefrontTrafficMultiplier ?? 1 : 1;
      const priceToleranceMultiplier = isStoreType
        ? effects?.storefrontPriceToleranceMultiplier ?? 1
        : 1;
      const conversionMultiplier = isStoreType ? effects?.storefrontConversionMultiplier ?? 1 : 1;
      const listingCapacityBonus = isStoreType ? effects?.storefrontListingCapacityBonus ?? 0 : 0;

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

    const [{ data: inventoryRows }, { data: shelfRows }] = await Promise.all([
      supabase
        .from("business_inventory")
        .select("id, owner_player_id, business_id, city_id, item_key, quality, quantity, reserved_quantity")
        .eq("owner_player_id", store.player_id)
        .eq("business_id", store.id)
        .gt("reserved_quantity", 0)
        .gt("quantity", 0)
        .limit(200),
      supabase
        .from("store_shelf_items")
        .select("id, owner_player_id, business_id, item_key, quality, quantity, unit_price")
        .eq("owner_player_id", store.player_id)
        .eq("business_id", store.id)
        .gt("quantity", 0)
        .limit(200),
    ]);

    const inventoryByKey = new Map(
      (inventoryRows ?? []).map((row) => [`${row.item_key}:${row.quality}`, row])
    );

    // NPC storefront traffic is shelf-only. Inventory rows are read solely to verify
    // the reserved stock that backs each shelf position before any sale can happen.
    const availableRows = (shelfRows ?? [])
      .map((row) => {
        const inventory = inventoryByKey.get(`${row.item_key}:${row.quality}`);
        const backedQuantity = Math.max(
          0,
          Math.min(toNumber(row.quantity), toNumber(inventory?.quantity), toNumber(inventory?.reserved_quantity))
        );
        return {
          ...row,
          city_id: String(store.city_id),
          business_name: String(store.name ?? "Unknown Business"),
          inventory_quantity: inventory?.quantity ?? 0,
          backing_reserved_quantity: inventory?.reserved_quantity ?? 0,
          backed_quantity: backedQuantity,
        };
      })
      .filter((row) => toNumber(row.backed_quantity) > 0 && toNumber(row.unit_price) > 0);

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

    const usedShopperNames = new Set<string>();

    for (let shopperIndex = 0; shopperIndex < shoppersThisSubtick; shopperIndex += 1) {
      const tier = pickWeighted(NPC_SHOPPER_TIERS as unknown as Array<(typeof NPC_SHOPPER_TIERS)[number]>, (row) => row.spawnWeight, seededRng);
      const shopperBudget = round2(randBetweenWithRng(seededRng, tier.budgetMin, tier.budgetMax));
      const shopperMaxItems = Math.max(
        1,
        randomIntWithRng(seededRng, tier.maxItemsMin, Math.max(tier.maxItemsMin, tier.maxItemsMax))
      );
      const priceSensitivity = randBetweenWithRng(seededRng, NPC_PRICE_SENSITIVITY_MIN, NPC_PRICE_SENSITIVITY_MAX);
      const qualityPreference = randBetweenWithRng(
        seededRng,
        NPC_QUALITY_PREFERENCE_MIN,
        NPC_QUALITY_PREFERENCE_MAX
      );
      const shopperName = makeNpcShopperName(seededRng, usedShopperNames);

      let remainingBudget = shopperBudget;
      let remainingItems = shopperMaxItems;
      const desiredPurchases = Math.max(1, Math.min(6, shopperMaxItems));

      for (let purchaseAttempt = 0; purchaseAttempt < desiredPurchases; purchaseAttempt += 1) {
        const activeRows = availableRows.filter((row) => toNumber(row.backed_quantity) > 0);
        if (activeRows.length === 0 || remainingItems <= 0 || remainingBudget <= 0) break;

        const itemKeys = Array.from(new Set(activeRows.map((row) => String(row.item_key))));
        const targetItemKey = pickWeighted(
          itemKeys,
          (key) => NPC_CATEGORY_INTEREST_WEIGHT_BY_ITEM[key] ?? 0.5,
          seededRng
        );

        const candidates = activeRows.filter((row) => row.item_key === targetItemKey);
        if (candidates.length === 0) continue;

        const cheapest = Math.min(...candidates.map((row) => toNumber(row.unit_price)));
        const withinBand = candidates.filter((row) => {
          const unitPrice = toNumber(row.unit_price);
          return unitPrice <= cheapest * (1 + NPC_PRICE_BAND_PERCENT * 6) && unitPrice <= remainingBudget;
        });
        if (withinBand.length === 0) continue;

        const weightedCandidates = withinBand
          .map((row) => ({
            row,
            score: getShelfPurchaseScore(
              row,
              { priceSensitivity, qualityPreference },
              priceToleranceMultiplier
            ),
          }))
          .filter((entry) => entry.score > 0);
        if (weightedCandidates.length === 0) continue;

        const bestScore = Math.max(...weightedCandidates.map((entry) => entry.score));
        const purchaseChance = clamp((bestScore * conversionMultiplier) / 1.15, 0, 0.995);
        if (seededRng() > purchaseChance) continue;

        const chosen = pickWeighted(
          weightedCandidates,
          (entry) => entry.score,
          seededRng
        ).row;

        const chosenPrice = toNumber(chosen.unit_price);
        if (chosenPrice <= 0) continue;

        const available = Math.max(0, toNumber(chosen.backed_quantity));
        const affordable = Math.floor(remainingBudget / chosenPrice);
        const maxByAttempt = Math.max(1, Math.min(6, 1 + Math.floor(Number(listingCapacityBonus) / 2)));
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

        const settled = await settleStoreInventorySale(supabase, chosen, soldQty, {
          shopperName,
          shopperTier: tier.key,
          shopperBudget,
          subTickIndex,
          tickWindowStartedAt,
        });

        chosen.quantity = Math.max(0, toNumber(chosen.quantity) - soldQty);
        chosen.inventory_quantity = Math.max(0, toNumber(chosen.inventory_quantity) - soldQty);
        chosen.backing_reserved_quantity = Math.max(0, toNumber(chosen.backing_reserved_quantity) - soldQty);
        chosen.backed_quantity = Math.max(
          0,
          Math.min(
            toNumber(chosen.quantity),
            toNumber(chosen.inventory_quantity),
            toNumber(chosen.backing_reserved_quantity)
          )
        );

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
  } finally {
    await release();
  }
});
