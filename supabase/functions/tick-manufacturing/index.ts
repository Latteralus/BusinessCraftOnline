// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { startTickRequest, writeTickRunLog } from "../_shared/tick-runtime.ts";

const RECIPE_INPUTS: Record<string, Array<{ itemKey: string; quantity: number }>> = {
  sawmill_planks: [{ itemKey: "raw_wood", quantity: 2 }],
  metal_iron_bars: [
    { itemKey: "iron_ore", quantity: 2 },
    { itemKey: "coal", quantity: 1 },
  ],
  food_flour: [{ itemKey: "wheat", quantity: 2 }],
  winery_red_wine: [{ itemKey: "red_grape", quantity: 3 }],
  carpentry_chair: [
    { itemKey: "wood_plank", quantity: 2 },
    { itemKey: "wood_handle", quantity: 1 },
  ],
};

const RECIPE_OUTPUT: Record<string, { itemKey: string; baseQty: number; skillKey: string }> = {
  sawmill_planks: { itemKey: "wood_plank", baseQty: 1, skillKey: "carpentry" },
  metal_iron_bars: { itemKey: "iron_bar", baseQty: 1, skillKey: "metalworking" },
  food_flour: { itemKey: "flour", baseQty: 1, skillKey: "food_production" },
  winery_red_wine: { itemKey: "red_wine", baseQty: 1, skillKey: "brewing" },
  carpentry_chair: { itemKey: "chair", baseQty: 1, skillKey: "carpentry" },
};

const XP_PER_TICK = 5;
const XP_PER_LEVEL = 100;
const GAIN_MULTIPLIER = 1.1;
const CONTRACT_ACTIVE_STATUSES = ["accepted", "in_progress"];

function isWorkerOperational(status: string, shiftEndsAt: string | null): boolean {
  if (status !== "assigned") return false;
  if (!shiftEndsAt) return false;
  return new Date(shiftEndsAt).getTime() > Date.now();
}

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

async function getInventoryRow(
  supabase: ReturnType<typeof createClient>,
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
    .order("quality", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data;
}

async function consumeInventoryForContract(
  supabase: ReturnType<typeof createClient>,
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

    const { data: jobs, error: jobsError } = await supabase
      .from("manufacturing_jobs")
      .select("id, business_id, active_recipe_key, status")
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
    if (!job.active_recipe_key) continue;

    const recipeInputs = RECIPE_INPUTS[job.active_recipe_key];
    const recipeOutput = RECIPE_OUTPUT[job.active_recipe_key];
    if (!recipeInputs || !recipeOutput) continue;

    const { data: business } = await supabase
      .from("businesses")
      .select("id, player_id, city_id")
      .eq("id", job.business_id)
      .maybeSingle();

    if (!business) continue;

      const { data: assignment, error: assignmentError } = await supabase
      .from("employee_assignments")
      .select("employee_id, assigned_at")
      .eq("business_id", job.business_id)
      .eq("role", "production")
      .order("assigned_at", { ascending: true });
      if (assignmentError) throw assignmentError;

    const workerAssignment = (assignment ?? []).find((candidate) => Boolean(candidate.employee_id)) ?? null;
    if (!workerAssignment) {
      const { error: workerFlagError } = await supabase
        .from("manufacturing_jobs")
        .update({ worker_assigned: false, updated_at: new Date().toISOString() })
        .eq("id", job.id);
      if (workerFlagError) throw workerFlagError;
      workerlessJobs += 1;
      continue;
    }

    const { data: employee } = await supabase
      .from("employees")
      .select("id, status, shift_ends_at")
      .eq("id", workerAssignment.employee_id)
      .maybeSingle();

    if (
      !employee ||
      employee.status === "fired" ||
      employee.status === "unpaid" ||
      !isWorkerOperational(employee.status, employee.shift_ends_at)
    ) {
      const { error: workerFlagError } = await supabase
        .from("manufacturing_jobs")
        .update({ worker_assigned: false, updated_at: new Date().toISOString() })
        .eq("id", job.id);
      if (workerFlagError) throw workerFlagError;
      workerlessJobs += 1;
      continue;
    }

    let canProduce = true;
    const inputRows: Array<{ id: string; quantity: number; reserved_quantity: number }> = [];

    for (const input of recipeInputs) {
      const row = await getInventoryRow(supabase, business.id, business.player_id, input.itemKey);
      if (!row) {
        canProduce = false;
        break;
      }

      const available = toNumber(row.quantity) - toNumber(row.reserved_quantity);
      if (available < input.quantity) {
        canProduce = false;
        break;
      }

      inputRows.push({
        id: row.id,
        quantity: toNumber(row.quantity),
        reserved_quantity: toNumber(row.reserved_quantity),
      });
    }

    if (!canProduce) {
      const { error: workerFlagError } = await supabase
        .from("manufacturing_jobs")
        .update({ worker_assigned: true, updated_at: new Date().toISOString() })
        .eq("id", job.id);
      if (workerFlagError) throw workerFlagError;
      continue;
    }

    for (let i = 0; i < recipeInputs.length; i += 1) {
      const input = recipeInputs[i];
      const row = inputRows[i];
      const nextQty = row.quantity - input.quantity;

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

    const [{ data: efficiencyUpgrade }, { data: qualityUpgrade }] = await Promise.all([
      supabase
        .from("business_upgrades")
        .select("level")
        .eq("business_id", business.id)
        .eq("upgrade_key", "production_efficiency")
        .maybeSingle(),
      supabase
        .from("business_upgrades")
        .select("level")
        .eq("business_id", business.id)
        .eq("upgrade_key", "equipment_quality")
        .maybeSingle(),
    ]);

    const efficiencyLevel = efficiencyUpgrade ? Number(efficiencyUpgrade.level) : 0;
    const qualityLevel = qualityUpgrade ? Number(qualityUpgrade.level) : 0;
    const outputQty = Math.max(
      1,
      Math.floor(recipeOutput.baseQty * Math.pow(GAIN_MULTIPLIER, Math.max(efficiencyLevel, 0)))
    );

    const { data: skill } = await supabase
      .from("employee_skills")
      .select("id, level, xp")
      .eq("employee_id", workerAssignment.employee_id)
      .eq("skill_key", recipeOutput.skillKey)
      .maybeSingle();

    const skillLevel = skill ? Number(skill.level) : 1;
    const quality = Math.max(
      1,
      Math.min(100, Math.round(skillLevel * 0.8 + qualityLevel * 5 + (Math.random() * 10 - 5)))
    );

    const { error: addInventoryError } = await supabase.rpc("add_business_inventory_quantity", {
      p_owner_player_id: business.player_id,
      p_business_id: business.id,
      p_city_id: business.city_id,
      p_item_key: recipeOutput.itemKey,
      p_quality: quality,
      p_quantity: outputQty,
    });
    if (addInventoryError) throw addInventoryError;

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

    const { error: jobUpdateError } = await supabase
      .from("manufacturing_jobs")
      .update({
        worker_assigned: true,
        last_tick_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    if (jobUpdateError) throw jobUpdateError;

    processed += 1;
    producedTotal += outputQty;
  }

    const nowIso = new Date().toISOString();

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
