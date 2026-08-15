// @ts-nocheck
import {
  startTickRequest,
  type EdgeSupabaseClient,
} from "../_shared/tick-runtime.ts";
import { getResolvedBusinessUpgradeEffects } from "../_shared/business-upgrades.ts";
import {
  STORE_BUSINESS_TYPES,
  isStoreBusinessType,
} from "../../../shared/businesses/store.ts";
import {
  STOREFRONT_DEFAULT_ITEM_INTEREST_WEIGHT,
  STOREFRONT_ITEM_INTEREST_WEIGHT_BY_ITEM,
  clampStorefrontTrafficMultiplier,
  getStorefrontMaxUnitsPerPurchaseAttempt,
  getStorefrontShelfPurchaseScore,
} from "../_shared/store-config.ts";
import {
  NPC_BASKET_SIZE_DISTRIBUTION,
  NPC_PRICE_CEILINGS,
  NPC_STOREFRONT_FEE,
  NPC_DEMAND_CURVE,
  NPC_PRICE_BAND_PERCENT,
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
} from "../../../shared/economy.ts";
import { makeNpcShopperName } from "../../../shared/core/npc-shopper-names.ts";

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
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

async function getOrCreateSubtickState(supabase: EdgeSupabaseClient) {
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
  supabase: EdgeSupabaseClient,
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
  supabase: EdgeSupabaseClient,
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
  // Baseline cost = 55% of NPC price ceiling, matching INVENTORY_BASELINE_UNIT_COSTS in finance config.
  // Used by the RPC when no cost basis was recorded on the inventory row (produced goods, not purchased).
  // Computed here (not in SQL) so shared/economy.ts stays the single source of truth for pricing.
  const baselineUnitCost = round2((NPC_PRICE_CEILINGS[shelfRow.item_key as keyof typeof NPC_PRICE_CEILINGS] ?? 0) * 0.55);

  // The actual read-lock-write happens atomically in settle_store_inventory_sale_atomic,
  // mirroring execute_market_purchase's locking so concurrent NPC sales / player listing
  // changes against the same inventory row can't race.
  const { data, error } = await supabase.rpc("settle_store_inventory_sale_atomic", {
    p_shelf_item_id: shelfRow.id,
    p_owner_player_id: shelfRow.owner_player_id,
    p_business_id: shelfRow.business_id,
    p_item_key: shelfRow.item_key,
    p_quality: toNumber(shelfRow.quality),
    p_city_id: shelfRow.city_id,
    p_business_name: shelfRow.business_name ?? null,
    p_sold_qty: soldQty,
    p_unit_price: toNumber(shelfRow.unit_price),
    p_baseline_unit_cost: baselineUnitCost,
    p_shopper_name: meta?.shopperName ?? null,
    p_shopper_tier: meta?.shopperTier ?? null,
    p_shopper_budget: meta?.shopperBudget ?? null,
    p_sub_tick_index: meta?.subTickIndex ?? null,
    p_tick_window_started_at: meta?.tickWindowStartedAt ?? null,
  });

  if (error) throw error;
  const result = data as { gross: number; fee: number; net: number };
  return { gross: result.gross, fee: result.fee, net: result.net };
}

async function writeTickRunLog(
  supabase: EdgeSupabaseClient,
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
  supabase: EdgeSupabaseClient,
  input: {
    ownerPlayerId: string;
    businessId: string;
    cityId: string;
    tickWindowStartedAt: string;
    subTickIndex: number;
    shoppersGenerated: number;
    buyersCount: number;
    salesCount: number;
    unitsSold: number;
    grossRevenue: number;
    feeTotal: number;
    adSpend: number;
    trafficMultiplier: number;
    demandMultiplier: number;
    stockOutCount: number;
  }
) {
  const { error } = await supabase.from("market_storefront_performance_snapshots").insert({
    owner_player_id: input.ownerPlayerId,
    business_id: input.businessId,
    city_id: input.cityId,
    tick_window_started_at: input.tickWindowStartedAt,
    sub_tick_index: input.subTickIndex,
    shoppers_generated: Math.max(0, Math.floor(input.shoppersGenerated)),
    buyers_count: Math.max(0, Math.floor(input.buyersCount)),
    sales_count: Math.max(0, Math.floor(input.salesCount)),
    units_sold: Math.max(0, Math.floor(input.unitsSold)),
    gross_revenue: round2(Math.max(0, input.grossRevenue)),
    fee_total: round2(Math.max(0, input.feeTotal)),
    ad_spend: round2(Math.max(0, input.adSpend)),
    traffic_multiplier: Number(input.trafficMultiplier.toFixed(3)),
    demand_multiplier: Number(input.demandMultiplier.toFixed(3)),
    stock_out_count: Math.max(0, Math.floor(input.stockOutCount)),
  });
  if (error) throw error;
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
     try {
      let storeSalesCount = 0;
      let storeBuyersCount = 0;
      let storeUnitsSold = 0;
      let storeGrossRevenue = 0;
      let storeFeeTotal = 0;
      let storeStockOutCount = 0;
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
        ? clampStorefrontTrafficMultiplier(toNumber(storefront.traffic_multiplier))
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
        buyersCount: 0,
        salesCount: 0,
        unitsSold: 0,
        grossRevenue: 0,
        feeTotal: 0,
        adSpend: adBudgetApplied,
        trafficMultiplier: trafficMultiplier * configuredTrafficMultiplier * adBoostMultiplier,
        demandMultiplier,
        stockOutCount: 0,
      });
      storesProcessed += 1;
      continue;
    }

    const usedShopperNames = new Set<string>();
    const buyersThisSubtick = new Set<string>();

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

      // Pre-determine this shopper's basket size from the distribution, capped by tier max
      const basketBucket = pickWeighted(
        NPC_BASKET_SIZE_DISTRIBUTION as unknown as Array<(typeof NPC_BASKET_SIZE_DISTRIBUTION)[number]>,
        (bucket) => bucket.weight,
        seededRng
      );
      const sessionTarget = Math.min(
        shopperMaxItems,
        randomIntWithRng(seededRng, basketBucket.min, basketBucket.max)
      );

      let remainingBudget = shopperBudget;
      let remainingItems = shopperMaxItems;
      let shopperHasBought = false;

      for (let purchaseAttempt = 0; purchaseAttempt < sessionTarget; purchaseAttempt += 1) {
        const activeRows = availableRows.filter((row) => toNumber(row.backed_quantity) > 0);
        if (activeRows.length === 0 || remainingItems <= 0 || remainingBudget <= 0) break;

        const itemKeys = Array.from(new Set(activeRows.map((row) => String(row.item_key))));
        const targetItemKey = pickWeighted(
          itemKeys,
          (key) => STOREFRONT_ITEM_INTEREST_WEIGHT_BY_ITEM[key] ?? STOREFRONT_DEFAULT_ITEM_INTEREST_WEIGHT,
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
        const bestAvailableQuality = Math.max(...withinBand.map((row) => toNumber(row.quality)));

        const weightedCandidates = withinBand
          .map((row) => ({
            row,
            score: getStorefrontShelfPurchaseScore({
              itemKey: String(row.item_key),
              unitPrice: toNumber(row.unit_price),
              quality: toNumber(row.quality),
              bestAvailableQuality,
              shopperPriceSensitivity: priceSensitivity,
              shopperQualityPreference: qualityPreference,
              priceToleranceMultiplier,
            }),
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
        const maxByAttempt = getStorefrontMaxUnitsPerPurchaseAttempt(Number(listingCapacityBonus));
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

        // Track stock-out when an item reaches zero after this sale
        if (toNumber(chosen.backed_quantity) === 0) {
          storeStockOutCount += 1;
        }

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

        if (!shopperHasBought) {
          shopperHasBought = true;
          buyersThisSubtick.add(shopperName);
        }
      }
    }

    storeBuyersCount = buyersThisSubtick.size;

      await writeStorefrontSnapshot(supabase, {
        ownerPlayerId: store.player_id,
        businessId: store.id,
        cityId: store.city_id,
        tickWindowStartedAt,
        subTickIndex,
        shoppersGenerated: shoppersThisSubtick,
        buyersCount: storeBuyersCount,
        salesCount: storeSalesCount,
        unitsSold: storeUnitsSold,
        grossRevenue: storeGrossRevenue,
        feeTotal: storeFeeTotal,
        adSpend: adBudgetApplied,
        trafficMultiplier: trafficMultiplier * configuredTrafficMultiplier * adBoostMultiplier,
        demandMultiplier,
        stockOutCount: storeStockOutCount,
      });

      storesProcessed += 1;
     } catch (storeError) {
      // One store's failure (e.g. an orphaned inventory row) must not stop every
      // store after it in this pass from getting NPC shoppers this subtick.
      console.error(`[tick-npc-purchases] store ${store.id} failed, skipping:`, storeError);
     }
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
