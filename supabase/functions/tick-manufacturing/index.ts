// @ts-nocheck
import {
  startTickRequest,
  writeTickRunLog,
  type EdgeSupabaseClient,
} from "../_shared/tick-runtime.ts";
import { isWorkerOperational } from "../_shared/employee-status.ts";
import {
  getManufacturingInputQuantityPerTick,
  getManufacturingOutputQuantityPerTick,
  getManufacturingRecipeByKey,
  MANUFACTURING_XP_PER_LEVEL,
} from "../_shared/manufacturing-config.ts";
import { getResolvedBusinessUpgradeEffectsForBusinesses } from "../_shared/business-upgrades.ts";
import {
  CONTRACT_FULFILLABLE_STATUSES,
  CONTRACT_LIVE_STATUSES,
} from "../../../src/domains/contracts/types.ts";

const XP_PER_TICK = 5;
const XP_PER_LEVEL = MANUFACTURING_XP_PER_LEVEL;

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

async function getInventoryRows(
  supabase: EdgeSupabaseClient,
  businessId: string,
  playerId: string,
  itemKey: string
) {
  const { data } = await supabase
    .from("business_inventory")
    .select("id, quantity, reserved_quantity, quality")
    .eq("business_id", businessId)
    .eq("owner_player_id", playerId)
    .eq("item_key", itemKey)
    .order("quality", { ascending: false });

  return (data ?? []) as Array<{
    id: string;
    quantity: number | string;
    reserved_quantity: number | string;
    quality: number | string;
  }>;
}

function normalizeProgressMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [key, toNumber(entryValue)])
  );
}

function resolveDeterministicQuantity(
  existingProgress: number,
  scaledQuantity: number
): { quantity: number; remainingProgress: number } {
  const totalProgress = Math.max(0, existingProgress + scaledQuantity);
  const quantity = Math.floor(totalProgress);
  return {
    quantity,
    remainingProgress: totalProgress - quantity,
  };
}

function resolveOutputQuality(
  consumedInputs: Array<{ used: number; quality: number }>,
  qualityBonus: number
): number {
  let totalUnits = 0;
  let weightedQuality = 0;

  for (const input of consumedInputs) {
    if (input.used <= 0) continue;
    totalUnits += input.used;
    weightedQuality += input.used * input.quality;
  }

  // add_business_inventory_quantity requires p_quality between 1 and 100 —
  // floor at 1, not 0, so a business with no quality-boosting inputs/upgrades
  // doesn't throw on its first produced unit and (with no per-job isolation
  // below) take down the entire tick for every other business too.
  if (totalUnits <= 0) {
    return Math.max(1, Math.min(100, Math.round(qualityBonus || 0)));
  }

  return Math.max(1, Math.min(100, Math.round(weightedQuality / totalUnits + qualityBonus)));
}

function resolveAvailableInputQuality(
  rows: Array<{ quantity: number | string; reserved_quantity: number | string; quality: number | string }>
): number | null {
  let totalUnits = 0;
  let weightedQuality = 0;

  for (const row of rows) {
    const available = Math.max(0, toNumber(row.quantity) - toNumber(row.reserved_quantity));
    if (available <= 0) continue;
    totalUnits += available;
    weightedQuality += available * toNumber(row.quality);
  }

  if (totalUnits <= 0) return null;
  return weightedQuality / totalUnits;
}

function resolveManufacturingQuality(
  consumedInputs: Array<{ used: number; quality: number }>,
  fallbackInputQuality: number | null,
  qualityBonus: number
): number {
  const consumedUnits = consumedInputs.reduce((sum, input) => sum + Math.max(0, input.used), 0);
  if (consumedUnits > 0) {
    return resolveOutputQuality(consumedInputs, qualityBonus);
  }

  return Math.max(1, Math.min(100, Math.round((fallbackInputQuality ?? 0) + qualityBonus)));
}

async function syncLegacyManufacturingJobForBusiness(
  supabase: EdgeSupabaseClient,
  businessId: string
) {
  const { data: lineRows, error: lineError } = await supabase
    .from("manufacturing_lines")
    .select(
      "business_id, configured_recipe_key, status, worker_assigned, employee_id, output_progress, input_progress, last_tick_at"
    )
    .eq("business_id", businessId)
    .order("line_number", { ascending: true });

  if (lineError) throw lineError;

  const lines = (lineRows ?? []) as Array<{
    business_id: string;
    configured_recipe_key: string | null;
    status: string;
    worker_assigned: boolean | null;
    employee_id: string | null;
    output_progress: number | string | null;
    input_progress: Record<string, unknown> | null;
    last_tick_at: string | null;
  }>;

  const legacySource =
    lines.find((line) => line.status === "active") ??
    lines.find((line) => Boolean(line.configured_recipe_key)) ??
    lines[0] ??
    null;

  const payload = {
    business_id: businessId,
    active_recipe_key: legacySource?.configured_recipe_key ?? null,
    status: legacySource?.status === "active" ? "active" : "idle",
    worker_assigned: Boolean(legacySource?.employee_id) && Boolean(legacySource?.worker_assigned),
    output_progress: toNumber(legacySource?.output_progress),
    input_progress:
      legacySource?.input_progress &&
      typeof legacySource.input_progress === "object" &&
      !Array.isArray(legacySource.input_progress)
        ? legacySource.input_progress
        : {},
    last_tick_at: legacySource?.last_tick_at ?? null,
    updated_at: new Date().toISOString(),
  };

  const { error: upsertError } = await supabase
    .from("manufacturing_jobs")
    .upsert(payload, { onConflict: "business_id" });

  if (upsertError) throw upsertError;
}

Deno.serve(async (request) => {
  const requestStart = await startTickRequest(request, "tick-manufacturing");
  if ("response" in requestStart) return requestStart.response;

  const { supabase, release } = requestStart;
  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();
  try {

    const nowIso = new Date().toISOString();
    const businessesNeedingLegacySync = new Set<string>();

    const { data: readyRetools } = await supabase
      .from("manufacturing_lines")
      .select("id, business_id, pending_recipe_key")
      .not("pending_recipe_key", "is", null)
      .not("retool_complete_at", "is", null)
      .lte("retool_complete_at", nowIso);

    for (const line of readyRetools ?? []) {
      await supabase
        .from("manufacturing_lines")
        .update({
          configured_recipe_key: line.pending_recipe_key,
          pending_recipe_key: null,
          retool_started_at: null,
          retool_complete_at: null,
          status: "idle",
          output_progress: 0,
          input_progress: {},
          updated_at: nowIso,
        })
        .eq("id", line.id);

      if (line.business_id) businessesNeedingLegacySync.add(String(line.business_id));
    }

    const { data: jobs, error: jobsError } = await supabase
      .from("manufacturing_lines")
      .select("id, business_id, employee_id, configured_recipe_key, status, output_progress, input_progress, last_tick_at")
      .eq("status", "active");

    if (jobsError) {
      return new Response(JSON.stringify({ ok: false, error: jobsError.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    let processed = 0;
    let producedTotal = 0;
    let contractsExpired = 0;
    let contractsFulfilled = 0;
    let workerlessJobs = 0;

    const jobBusinessIds = [...new Set((jobs ?? []).map((job) => job.business_id))];
    const { data: jobBusinessRows } = jobBusinessIds.length
      ? await supabase.from("businesses").select("id, player_id, city_id, type").in("id", jobBusinessIds)
      : { data: [] as Array<{ id: string; player_id: string; city_id: string; type: string }> };

    const businessById = new Map(
      (jobBusinessRows ?? []).map((row) => [row.id, row as { id: string; player_id: string; city_id: string; type: string }])
    );

    // Resolved once per business per tick instead of once per active line --
    // getResolvedBusinessUpgradeEffectsForBusinesses batches the underlying
    // upgrade/project lookups across every business touched this tick.
    const upgradeEffectsByBusiness = await getResolvedBusinessUpgradeEffectsForBusinesses(
      supabase,
      [...businessById.values()].map((business) => ({ id: business.id, type: business.type }))
    );

    for (const job of jobs ?? []) {
     try {
    businessesNeedingLegacySync.add(job.business_id);
    if (!job.configured_recipe_key) continue;

    const recipe = getManufacturingRecipeByKey(job.configured_recipe_key);
    if (!recipe) continue;
    const existingInputProgress = normalizeProgressMap(job.input_progress);

    const business = businessById.get(job.business_id) ?? null;

    if (!business) continue;

    const effects = upgradeEffectsByBusiness.get(business.id)!;
    const recipeInputs = recipe.inputs
      .map((input) => {
        const resolved = resolveDeterministicQuantity(
          existingInputProgress[input.itemKey] ?? 0,
          Math.max(0, getManufacturingInputQuantityPerTick(input.quantity) * effects.manufacturingInputUseMultiplier)
        );
        return {
          itemKey: input.itemKey,
          quantity: resolved.quantity,
          remainingProgress: resolved.remainingProgress,
        };
      });

    if (!job.employee_id) {
      const { error: workerFlagError } = await supabase
        .from("manufacturing_lines")
        .update({ worker_assigned: false, status: "idle", updated_at: new Date().toISOString() })
        .eq("id", job.id);
      if (workerFlagError) throw workerFlagError;
      workerlessJobs += 1;
      continue;
    }

    const { data: employee } = await supabase
      .from("employees")
      .select("id, status, shift_ends_at")
      .eq("id", job.employee_id)
      .maybeSingle();

    if (
      !employee ||
      employee.status === "fired" ||
      employee.status === "unpaid" ||
      !isWorkerOperational(employee.status, employee.shift_ends_at)
    ) {
      const { error: workerFlagError } = await supabase
        .from("manufacturing_lines")
        .update({ worker_assigned: false, status: "resting", updated_at: new Date().toISOString() })
        .eq("id", job.id);
      if (workerFlagError) throw workerFlagError;
      workerlessJobs += 1;
      continue;
    }

    let canProduce = true;
    const inventoryConsumptionPlan = new Map<
      string,
      { id: string; quantity: number; reserved_quantity: number; used: number; quality: number }
    >();
    const referenceInputQualities: number[] = [];

    for (const input of recipeInputs) {
      const rows = await getInventoryRows(supabase, business.id, business.player_id, input.itemKey);
      const availableInputQuality = resolveAvailableInputQuality(rows);
      if (availableInputQuality !== null) {
        referenceInputQualities.push(availableInputQuality);
      }

      if (input.quantity <= 0) continue;
      if (rows.length === 0) {
        canProduce = false;
        break;
      }

      let remainingRequired = input.quantity;
      for (const row of rows) {
        if (remainingRequired <= 0) break;
        const quantity = toNumber(row.quantity);
        const reservedQuantity = toNumber(row.reserved_quantity);
        const available = Math.max(0, quantity - reservedQuantity);
        if (available <= 0) continue;

        const used = Math.min(available, remainingRequired);
        const existingPlan = inventoryConsumptionPlan.get(row.id);
        if (existingPlan) {
          existingPlan.used += used;
        } else {
          inventoryConsumptionPlan.set(row.id, {
            id: row.id,
            quantity,
            reserved_quantity: reservedQuantity,
            used,
            quality: toNumber(row.quality),
          });
        }
        remainingRequired -= used;
      }

      if (remainingRequired > 0) {
        canProduce = false;
        break;
      }
    }

    if (!canProduce) {
      const { error: workerFlagError } = await supabase
        .from("manufacturing_lines")
        .update({ worker_assigned: true, updated_at: new Date().toISOString() })
        .eq("id", job.id);
      if (workerFlagError) throw workerFlagError;
      continue;
    }

    const outputState = resolveDeterministicQuantity(
      toNumber(job.output_progress),
      Math.max(0, getManufacturingOutputQuantityPerTick(recipe.baseOutputQuantity) * effects.manufacturingOutputMultiplier)
    );
    const outputQty = outputState.quantity;

    const { data: skill } = await supabase
      .from("employee_skills")
      .select("id, level, xp")
      .eq("employee_id", job.employee_id)
      .eq("skill_key", recipe.skillKey)
      .maybeSingle();

    const fallbackInputQuality =
      referenceInputQualities.length > 0
        ? referenceInputQualities.reduce((sum, quality) => sum + quality, 0) / referenceInputQualities.length
        : null;

    const quality = resolveManufacturingQuality(
      Array.from(inventoryConsumptionPlan.values()).map((row) => ({
        used: row.used,
        quality: row.quality,
      })),
      fallbackInputQuality,
      effects.manufacturingQualityBonus
    );

    const nextInputProgress = Object.fromEntries(
      recipeInputs.map((input) => [input.itemKey, input.remainingProgress])
    );

    // Atomically relieves each consumed input's exact weighted-average cost
    // (never a fallback derived from NPC_PRICE_CEILINGS) and creates the
    // finished good with a cost basis equal to exactly what was consumed --
    // no input cost is left behind or duplicated (AccountingFixPlan item 41).
    // Raises insufficient_input:<item_key> instead of partially consuming if
    // a concurrent write shrank availability since the pre-check above; that
    // race backstop is treated the same as the pre-check's own !canProduce
    // outcome below.
    try {
      const { error: productionError } = await supabase.rpc("run_manufacturing_line_production", {
        p_line_id: job.id,
        p_owner_player_id: business.player_id,
        p_business_id: business.id,
        p_city_id: business.city_id,
        p_inputs: recipeInputs
          .filter((input) => input.quantity > 0)
          .map((input) => ({ itemKey: input.itemKey, quantity: input.quantity })),
        p_output_item_key: recipe.outputItemKey,
        p_output_quality: quality,
        p_output_units: outputQty,
        p_next_input_progress: nextInputProgress,
        p_next_output_progress: outputState.remainingProgress,
      });
      if (productionError) throw productionError;
    } catch (productionError) {
      const message = productionError instanceof Error ? productionError.message : String(productionError);
      if (message.includes("insufficient_input:")) {
        const { error: workerFlagError } = await supabase
          .from("manufacturing_lines")
          .update({ worker_assigned: true, updated_at: new Date().toISOString() })
          .eq("id", job.id);
        if (workerFlagError) throw workerFlagError;
        continue;
      }
      throw productionError;
    }

    if (skill) {
      let nextXp = Number(skill.xp) + XP_PER_TICK;
      let nextLevel = Number(skill.level);
      // employee_skills.level is capped at 100 by employee_skills_level_check;
      // stop leveling once maxed instead of letting nextLevel climb past it.
      while (nextXp >= XP_PER_LEVEL && nextLevel < 100) {
        nextXp -= XP_PER_LEVEL;
        nextLevel += 1;
      }

      const { error: skillUpdateError } = await supabase
        .from("employee_skills")
        .update({ level: nextLevel, xp: nextXp, updated_at: new Date().toISOString() })
        .eq("id", skill.id);
      if (skillUpdateError) throw skillUpdateError;
    }

    // worker_assigned/output_progress/input_progress/last_tick_at were
    // already persisted atomically by run_manufacturing_line_production
    // above, together with the inventory relief/creation they're derived
    // from.

    processed += 1;
    producedTotal += outputQty;
     } catch (jobError) {
      // One job's failure must not stop every other business's manufacturing
      // lines from being processed this tick.
      console.error(`[tick-manufacturing] job ${job.id} failed, skipping:`, jobError);
     }
  }

  const { data: expiredContracts } = await supabase
    .from("contracts")
    .select("id")
    .in("status", CONTRACT_LIVE_STATUSES)
    .not("expires_at", "is", null)
    .lt("expires_at", nowIso);

  for (const contract of expiredContracts ?? []) {
    const { error: expireError } = await supabase
      .from("contracts")
      .update({ status: "expired", updated_at: nowIso })
      .eq("id", contract.id);
    if (expireError) throw expireError;
    contractsExpired += 1;
  }

  const { data: activeContracts } = await supabase
    .from("contracts")
    .select("id, owner_player_id, business_id, item_key, required_quantity, delivered_quantity, unit_price, due_at")
    .in("status", CONTRACT_FULFILLABLE_STATUSES)
    .order("created_at", { ascending: true });

  for (const contract of activeContracts ?? []) {
    if (contract.due_at && new Date(contract.due_at).getTime() <= Date.now()) {
      const { error: expireError } = await supabase
        .from("contracts")
        .update({ status: "expired", updated_at: nowIso })
        .eq("id", contract.id);
      if (expireError) throw expireError;
      contractsExpired += 1;
      continue;
    }

    const requiredQty = Math.max(
      0,
      toNumber(contract.required_quantity) - toNumber(contract.delivered_quantity)
    );

    if (requiredQty <= 0) {
      await supabase
        .from("contracts")
        .update({
          status: "fulfilled",
          completed_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", contract.id);
      contractsFulfilled += 1;
      continue;
    }

    // fulfill_contract_atomic (migration 106) relieves the exact
    // weighted-average inventory cost, credits the payout, writes
    // revenue/COGS/inventory financial events, and marks the contract
    // fulfilled -- all in one transaction. Same RPC the player-initiated
    // fulfillContract() path uses, so auto-fulfillment and manual
    // fulfillment can no longer produce different accounting.
    const { data: fulfillResult, error: fulfillError } = await supabase.rpc("fulfill_contract_atomic", {
      p_player_id: contract.owner_player_id,
      p_contract_id: contract.id,
    });
    if (fulfillError) throw fulfillError;

    if (!(fulfillResult as { ok?: boolean } | null)?.ok) {
      // fulfill_contract_atomic already committed the in_progress status
      // transition when inventory was short -- nothing else to do this tick.
      continue;
    }

    contractsFulfilled += 1;
    }

    for (const businessId of businessesNeedingLegacySync) {
      await syncLegacyManufacturingJobForBusiness(supabase, businessId);
    }

    const payload = {
      ok: true,
      function: "tick-manufacturing",
      processed,
      producedTotal,
      contractsFulfilled,
      contractsExpired,
      workerlessJobs,
    };

    await writeTickRunLog(supabase, {
      tickName: "tick-manufacturing",
      status: "ok",
      startedAtIso,
      finishedAtIso: nowIso,
      durationMs: new Date(nowIso).getTime() - startedAt.getTime(),
      processedCount: processed,
      metrics: payload,
      errorMessage: null,
    });

    return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
  } catch (error) {
    const finishedAtIso = new Date().toISOString();
    const message = error instanceof Error ? error.message : "tick-manufacturing failed";

    try {
      await writeTickRunLog(supabase, {
        tickName: "tick-manufacturing",
        status: "error",
        startedAtIso,
        finishedAtIso,
        durationMs: new Date(finishedAtIso).getTime() - startedAt.getTime(),
        processedCount: 0,
        metrics: {},
        errorMessage: message,
      });
    } catch {
      // Ignore secondary log failures in error path.
    }

    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  } finally {
    await release();
  }
});
