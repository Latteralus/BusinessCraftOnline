// @ts-nocheck
// NPC open-market purchases: a second, much lower-volume NPC shopper channel
// than tick-npc-purchases (which is storefront-shelf-only, see that file's
// comment). This one buys directly off active public.market_listings so the
// open market still has some background churn — but retailers stay the
// primary NPC sales channel, achieved by spawning far fewer shoppers
// (NPC_OPEN_MARKET_SHOPPERS_PER_SUBTICK_BASE), per CITY rather than per store,
// and only for a curated allowlist of items a person would plausibly buy
// directly off a market stall (NPC_OPEN_MARKET_ELIGIBLE_ITEMS) — no buying
// crude oil or iron ore off the open market, but water is fair game.
//
// Shopper generation (tiers, budgets, basket sizes, price/quality preference,
// demand curve) intentionally reuses the exact same distributions as the
// storefront tick, per design: "budget and purchase ranges should be the
// same" — only the volume and item eligibility differ.
import {
  startTickRequest,
  type EdgeSupabaseClient,
} from "../_shared/tick-runtime.ts";
import {
  STOREFRONT_DEFAULT_ITEM_INTEREST_WEIGHT,
  STOREFRONT_ITEM_INTEREST_WEIGHT_BY_ITEM,
  getStorefrontMaxUnitsPerPurchaseAttempt,
  getStorefrontShelfPurchaseScore,
} from "../_shared/store-config.ts";
import {
  NPC_BASKET_SIZE_DISTRIBUTION,
  NPC_OPEN_MARKET_ELIGIBLE_ITEMS,
  NPC_OPEN_MARKET_SHOPPERS_PER_SUBTICK_BASE,
  NPC_PRICE_CEILINGS,
  NPC_DEMAND_CURVE,
  NPC_PRICE_BAND_PERCENT,
  NPC_PRICE_SENSITIVITY_MAX,
  NPC_PRICE_SENSITIVITY_MIN,
  NPC_QUALITY_PREFERENCE_MAX,
  NPC_QUALITY_PREFERENCE_MIN,
  NPC_SHOPPER_TIERS,
  NPC_SUBTICKS_PER_TICK,
  NPC_SUBTICK_SECONDS,
  NPC_SUBTICK_VARIANCE,
} from "../../../shared/economy.ts";
import { makeNpcShopperName } from "../../../shared/core/npc-shopper-names.ts";

// Own subtick-state row in the same table the storefront tick uses, keyed
// separately so the two channels advance independently.
const SUBTICK_STATE_KEY = "open_market";
const ELIGIBLE_ITEM_KEYS = [...NPC_OPEN_MARKET_ELIGIBLE_ITEMS];
const MARKET_LISTING_ROW_CAP = 2000;

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
    .eq("state_key", SUBTICK_STATE_KEY)
    .maybeSingle();
  if (error) throw error;

  if (data) {
    return {
      tickWindowStartedAt: String(data.tick_window_started_at),
      subTickIndex: Number(data.sub_tick_index),
    };
  }

  const nowIso = new Date().toISOString();
  const { data: inserted, error: insertError } = await supabase
    .from("npc_market_subtick_state")
    .insert({
      state_key: SUBTICK_STATE_KEY,
      tick_window_started_at: nowIso,
      sub_tick_index: 0,
    })
    .select("tick_window_started_at, sub_tick_index")
    .single();

  if (insertError) throw insertError;

  return {
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
    .eq("state_key", SUBTICK_STATE_KEY);

  if (error) throw error;
}

async function settleMarketListingNpcSale(
  supabase: EdgeSupabaseClient,
  listing: { id: string; item_key: string },
  soldQty: number,
  meta: {
    shopperName: string | null;
    shopperTier: string | null;
    shopperBudget: number | null;
    subTickIndex: number;
    tickWindowStartedAt: string;
  }
) {
  // Baseline cost fallback for business-sourced listings with no recorded cost
  // basis, same 55%-of-ceiling convention used by the storefront tick.
  const baselineUnitCost = round2(
    (NPC_PRICE_CEILINGS[listing.item_key as keyof typeof NPC_PRICE_CEILINGS] ?? 0) * 0.55
  );

  const { data, error } = await supabase.rpc("settle_market_listing_npc_sale_atomic", {
    p_listing_id: listing.id,
    p_sold_qty: soldQty,
    p_baseline_unit_cost: baselineUnitCost,
    p_shopper_name: meta.shopperName,
    p_shopper_tier: meta.shopperTier,
    p_shopper_budget: meta.shopperBudget,
    p_sub_tick_index: meta.subTickIndex,
    p_tick_window_started_at: meta.tickWindowStartedAt,
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
    tick_name: "tick-npc-market-purchases",
    status: input.status,
    started_at: input.startedAtIso,
    finished_at: input.finishedAtIso,
    duration_ms: Math.max(0, Math.floor(input.durationMs)),
    processed_count: Math.max(0, Math.floor(input.processedCount)),
    metrics: input.metrics ?? {},
    error_message: input.errorMessage ?? null,
  });
}

Deno.serve(async (request) => {
  const requestStart = await startTickRequest(request, "tick-npc-market-purchases");
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

    // MARKET_LISTING_ROW_CAP is a deliberate bound, not a silent one -- if a
    // tick actually hits it, that's logged and surfaced in this run's
    // metrics instead of silently under-covering the open market. See audit
    // finding M10 (Documents/SBAudit.md).
    const { data: listingRows, error: listingsError } = await supabase
      .from("market_listings")
      .select(
        "id, owner_player_id, source_type, source_business_id, source_inventory_id, city_id, item_key, quality, quantity, reserved_quantity, unit_price"
      )
      .eq("status", "active")
      .in("item_key", ELIGIBLE_ITEM_KEYS)
      .gt("quantity", 0)
      .gt("unit_price", 0)
      .limit(MARKET_LISTING_ROW_CAP);

    if (listingsError) throw listingsError;

    const listingCapHit = (listingRows ?? []).length >= MARKET_LISTING_ROW_CAP;
    if (listingCapHit) {
      console.warn(
        `[tick-npc-market-purchases] active eligible listings hit the ${MARKET_LISTING_ROW_CAP}-row cap`
      );
    }

    const listingsByCity = new Map<string, typeof listingRows>();
    for (const row of listingRows ?? []) {
      const cityId = String(row.city_id);
      const existing = listingsByCity.get(cityId);
      if (existing) {
        existing.push(row);
      } else {
        listingsByCity.set(cityId, [row]);
      }
    }

    let citiesProcessed = 0;
    let salesCount = 0;
    let unitsSold = 0;
    let grossRevenue = 0;
    let feeTotal = 0;

    const demandMultiplier = getDemandCurveMultiplierForHour(now.getUTCHours());

    for (const [cityId, cityListings] of listingsByCity) {
      try {
        const seededRng = createRng(hashString(`${tickWindowStartedAt}|${subTickIndex}|${cityId}`));
        const variance = 1 + randBetweenWithRng(seededRng, -NPC_SUBTICK_VARIANCE, NPC_SUBTICK_VARIANCE);
        const shoppersThisSubtick = Math.max(
          0,
          Math.floor(NPC_OPEN_MARKET_SHOPPERS_PER_SUBTICK_BASE * demandMultiplier * variance)
        );

        if (shoppersThisSubtick === 0) {
          continue;
        }

        const activeRows = cityListings
          .map((row) => ({ ...row, quantity: toNumber(row.quantity) }))
          .filter((row) => row.quantity > 0);

        if (activeRows.length === 0) {
          continue;
        }

        const usedShopperNames = new Set<string>();

        for (let shopperIndex = 0; shopperIndex < shoppersThisSubtick; shopperIndex += 1) {
          const tier = pickWeighted(NPC_SHOPPER_TIERS as unknown as Array<(typeof NPC_SHOPPER_TIERS)[number]>, (row) => row.spawnWeight, seededRng);
          const shopperBudgetStart = round2(randBetweenWithRng(seededRng, tier.budgetMin, tier.budgetMax));
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

          const basketBucket = pickWeighted(
            NPC_BASKET_SIZE_DISTRIBUTION as unknown as Array<(typeof NPC_BASKET_SIZE_DISTRIBUTION)[number]>,
            (bucket) => bucket.weight,
            seededRng
          );
          const sessionTarget = Math.min(
            shopperMaxItems,
            randomIntWithRng(seededRng, basketBucket.min, basketBucket.max)
          );

          let remainingBudget = shopperBudgetStart;
          let remainingItems = shopperMaxItems;

          for (let purchaseAttempt = 0; purchaseAttempt < sessionTarget; purchaseAttempt += 1) {
            const liveRows = activeRows.filter((row) => row.quantity > 0);
            if (liveRows.length === 0 || remainingItems <= 0 || remainingBudget <= 0) break;

            const itemKeys = Array.from(new Set(liveRows.map((row) => String(row.item_key))));
            const targetItemKey = pickWeighted(
              itemKeys,
              (key) => STOREFRONT_ITEM_INTEREST_WEIGHT_BY_ITEM[key] ?? STOREFRONT_DEFAULT_ITEM_INTEREST_WEIGHT,
              seededRng
            );

            const candidates = liveRows.filter((row) => row.item_key === targetItemKey);
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
                  priceToleranceMultiplier: 1,
                }),
              }))
              .filter((entry) => entry.score > 0);
            if (weightedCandidates.length === 0) continue;

            const bestScore = Math.max(...weightedCandidates.map((entry) => entry.score));
            const purchaseChance = clamp(bestScore / 1.15, 0, 0.995);
            if (seededRng() > purchaseChance) continue;

            const chosen = pickWeighted(weightedCandidates, (entry) => entry.score, seededRng).row;

            const chosenPrice = toNumber(chosen.unit_price);
            if (chosenPrice <= 0) continue;

            const available = Math.max(0, toNumber(chosen.quantity));
            const affordable = Math.floor(remainingBudget / chosenPrice);
            const maxByAttempt = getStorefrontMaxUnitsPerPurchaseAttempt(0);
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

            const settled = await settleMarketListingNpcSale(
              supabase,
              { id: String(chosen.id), item_key: String(chosen.item_key) },
              soldQty,
              {
                shopperName,
                shopperTier: tier.key,
                shopperBudget: shopperBudgetStart,
                subTickIndex,
                tickWindowStartedAt,
              }
            );

            chosen.quantity = Math.max(0, toNumber(chosen.quantity) - soldQty);

            remainingBudget = round2(Math.max(0, remainingBudget - settled.gross));
            remainingItems = Math.max(0, remainingItems - soldQty);
            salesCount += 1;
            unitsSold += soldQty;
            grossRevenue += settled.gross;
            feeTotal += settled.fee;
          }
        }

        citiesProcessed += 1;
      } catch (cityError) {
        // One city's failure (e.g. a listing that changed out from under us)
        // must not stop every city after it in this pass from getting NPC
        // market traffic this subtick.
        console.error(`[tick-npc-market-purchases] city ${cityId} failed, skipping:`, cityError);
      }
    }

    const payload = {
      ok: true,
      function: "tick-npc-market-purchases",
      citiesProcessed,
      subTickIndex,
      tickWindowStartedAt,
      demandMultiplier,
      salesCount,
      unitsSold,
      grossRevenue: Number(grossRevenue.toFixed(2)),
      feeTotal: Number(feeTotal.toFixed(2)),
      netRevenue: Number((grossRevenue - feeTotal).toFixed(2)),
      listingCapHit,
    };

    const finishedAtIso = new Date().toISOString();
    await writeTickRunLog(supabase, {
      status: "ok",
      startedAtIso,
      finishedAtIso,
      durationMs: new Date(finishedAtIso).getTime() - startedAt.getTime(),
      processedCount: citiesProcessed,
      metrics: payload,
      errorMessage: null,
    });

    return new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const finishedAtIso = new Date().toISOString();
    const message = error instanceof Error ? error.message : "tick-npc-market-purchases failed";

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
