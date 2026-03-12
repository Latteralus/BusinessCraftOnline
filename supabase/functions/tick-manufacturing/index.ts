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
} from "../_shared/manufacturing-config.ts";
import { getResolvedBusinessUpgradeEffects } from "../_shared/business-upgrades.ts";

const XP_PER_TICK = 5;
const XP_PER_LEVEL = 100;
const CONTRACT_ACTIVE_STATUSES = ["accepted", "in_progress"];

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

  if (totalUnits <= 0) {
    return Math.max(0, Math.min(100, Math.round(qualityBonus || 0)));
  }

  return Math.max(0, Math.min(100, Math.round(weightedQuality / totalUnits + qualityBonus)));
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

  return Math.max(0, Math.min(100, Math.round((fallbackInputQuality ?? 0) + qualityBonus)));
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

async function consumeInventoryForContract(
  supabase: EdgeSupabaseClient,
  playerId: string,
  businessId: string,
  itemKey: string,
  requiredQuantity: number
): Promise<boolean> {
  const { data: rows } = await supabase
    .from("business_inventory")
    .select("id, quantity, reserved_quantity")
    .eq("owner_player_id", playerId)
    .eq("business_id", businessId)
    .eq("item_key", itemKey)
    .order("quality", { ascending: false });

  const inventoryRows = (rows ?? []) as Array<{
    id: string;
    quantity: number | string;
    reserved_quantity: number | string;
  }>;

  let availableTotal = 0;
  for (const row of inventoryRows) {
    availableTotal += Math.max(0, toNumber(row.quantity) - toNumber(row.reserved_quantity));
  }

  if (availableTotal < requiredQuantity) return false;

  let remaining = requiredQuantity;
  for (const row of inventoryRows) {
    if (remaining <= 0) break;

    const quantity = toNumber(row.quantity);
    const reserved = toNumber(row.reserved_quantity);
    const available = Math.max(0, quantity - reserved);
    if (available <= 0) continue;

    const used = Math.min(available, remaining);
    const nextQty = quantity - used;

    if (nextQty <= 0) {
      await supabase.from("business_inventory").delete().eq("id", row.id);
    } else {
      await supabase
        .from("business_inventory")
        .update({
          quantity: nextQty,
          reserved_quantity: Math.min(reserved, nextQty),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    }

    remaining -= used;
  }

  return true;
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
      .select("id, pending_recipe_key")
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
    }

    if ((readyRetools ?? []).length > 0) {
      const { data: retooledBusinessRows } = await supabase
        .from("manufacturing_lines")
        .select("business_id")
        .in("id", (readyRetools ?? []).map((line) => line.id));

      for (const row of retooledBusinessRows ?? []) {
        if (row.business_id) businessesNeedingLegacySync.add(String(row.business_id));
      }
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

    for (const job of jobs ?? []) {
    businessesNeedingLegacySync.add(job.business_id);
    if (!job.configured_recipe_key) continue;

    const recipe = getManufacturingRecipeByKey(job.configured_recipe_key);
    if (!recipe) continue;
    const existingInputProgress = normalizeProgressMap(job.input_progress);

    const { data: business } = await supabase
      .from("businesses")
      .select("id, player_id, city_id, type")
      .eq("id", job.business_id)
      .maybeSingle();

    if (!business) continue;

    const effects = await getResolvedBusinessUpgradeEffects(supabase, business.id, business.type);
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

    for (const row of inventoryConsumptionPlan.values()) {
      const nextQty = row.quantity - row.used;

      if (nextQty <= 0) {
        const { error: deleteError } = await supabase.from("business_inventory").delete().eq("id", row.id);
        if (deleteError) throw deleteError;
      } else {
        const nextReserved = Math.min(row.reserved_quantity, nextQty);
        const { error: updateError } = await supabase
          .from("business_inventory")
          .update({
            quantity: nextQty,
            reserved_quantity: nextReserved,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        if (updateError) throw updateError;
      }
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

    if (outputQty > 0) {
      const { error: addInventoryError } = await supabase.rpc("add_business_inventory_quantity", {
        p_owner_player_id: business.player_id,
        p_business_id: business.id,
        p_city_id: business.city_id,
        p_item_key: recipe.outputItemKey,
        p_quality: quality,
        p_quantity: outputQty,
      });
      if (addInventoryError) throw addInventoryError;
    }

    if (skill) {
      let nextXp = Number(skill.xp) + XP_PER_TICK;
      let nextLevel = Number(skill.level);
      while (nextXp >= XP_PER_LEVEL) {
        nextXp -= XP_PER_LEVEL;
        nextLevel += 1;
      }

      const { error: skillUpdateError } = await supabase
        .from("employee_skills")
        .update({ level: nextLevel, xp: nextXp, updated_at: new Date().toISOString() })
        .eq("id", skill.id);
      if (skillUpdateError) throw skillUpdateError;
    }

    const nextInputProgress = Object.fromEntries(
      recipeInputs.map((input) => [input.itemKey, input.remainingProgress])
    );

    const { error: jobUpdateError } = await supabase
      .from("manufacturing_lines")
      .update({
        worker_assigned: true,
        output_progress: outputState.remainingProgress,
        input_progress: nextInputProgress,
        last_tick_at: outputQty > 0 ? new Date().toISOString() : job.last_tick_at,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    if (jobUpdateError) throw jobUpdateError;

    processed += 1;
    producedTotal += outputQty;
  }

  const { data: expiredContracts } = await supabase
    .from("contracts")
    .select("id")
    .in("status", ["open", ...CONTRACT_ACTIVE_STATUSES])
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
    .in("status", CONTRACT_ACTIVE_STATUSES)
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

    const consumed = await consumeInventoryForContract(
      supabase,
      contract.owner_player_id,
      contract.business_id,
      contract.item_key,
      requiredQty
    );

    if (!consumed) {
      const { error: inProgressError } = await supabase
        .from("contracts")
        .update({ status: "in_progress", updated_at: nowIso })
        .eq("id", contract.id);
      if (inProgressError) throw inProgressError;
      continue;
    }

    const payout = Number((requiredQty * toNumber(contract.unit_price)).toFixed(2));

    const { error: payoutError } = await supabase.from("business_accounts").insert({
      business_id: contract.business_id,
      amount: payout,
      entry_type: "credit",
      category: "contract_payout",
      reference_id: contract.id,
      description: `Contract payout: ${requiredQty}x ${contract.item_key}`,
    });
    if (payoutError) throw payoutError;

    const { error: fulfillError } = await supabase
      .from("contracts")
      .update({
        delivered_quantity: toNumber(contract.required_quantity),
        status: "fulfilled",
        completed_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", contract.id);
    if (fulfillError) throw fulfillError;

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
