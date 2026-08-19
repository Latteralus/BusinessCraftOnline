import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  isRecord,
  readNumber,
  readString,
  startTickRequest,
  writeTickRunLog,
  type EdgeSupabaseClient,
} from "../_shared/tick-runtime.ts";
import { isWorkerOperational } from "../_shared/employee-status.ts";
import { getResolvedBusinessUpgradeEffectsForBusinesses } from "../_shared/business-upgrades.ts";
import {
  EXTRACTION_BASE_OUTPUT_PER_TICK_BY_BUSINESS,
  EXTRACTION_MISSING_TOOL_OUTPUT_MULTIPLIER_BY_BUSINESS,
  EXTRACTION_OUTPUT_ITEM_BY_BUSINESS,
  EXTRACTION_REQUIRED_TOOL_BY_BUSINESS,
  EXTRACTION_SKILL_KEY_BY_BUSINESS,
  EXTRACTION_TOOL_OUTPUT_BONUS_BY_BUSINESS,
  EXTRACTION_XP_PER_LEVEL,
  EXTRACTION_XP_PER_TICK,
} from "../_shared/extraction-config.ts";

type ExtractionSlotRow = {
  id: string;
  business_id: string;
  slot_number: number;
  employee_id: string | null;
  status: "active" | "idle" | "resting" | "tool_broken";
  tool_item_key: "pickaxe" | "axe" | "drill_bit" | null;
  configured_item_key: string | null;
  input_progress: number;
  output_progress: number;
  last_extracted_at: string | null;
};

type BusinessRow = {
  id: string;
  player_id: string;
  city_id: string;
  type: "mine" | "farm" | "water_company" | "logging_camp" | "oil_well" | string;
};

type InventoryRow = {
  id: string;
  quantity: number;
  reserved_quantity: number;
};

type EmployeeRow = {
  id: string;
  status: "available" | "assigned" | "resting" | "unpaid" | "fired";
  shift_ends_at: string | null;
};

type AssignmentRow = {
  id: string;
  slot_number: number | null;
};

type ToolDurabilityRow = {
  id: string;
  item_type: "pickaxe" | "axe" | "drill_bit" | null;
  uses_remaining: number;
};

type SkillRow = {
  id: string;
  level: number;
  xp: number;
};

function parseExtractionSlotRows(value: unknown): ExtractionSlotRow[] {
  if (!Array.isArray(value)) return [];

  const rows: ExtractionSlotRow[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const id = readString(raw.id);
    const businessId = readString(raw.business_id);
    const slotNumber = readNumber(raw.slot_number);
    const employeeId = raw.employee_id === null ? null : readString(raw.employee_id);
    const status = readString(raw.status);
    const toolItemKey = raw.tool_item_key === null ? null : readString(raw.tool_item_key);
    const configuredItemKey = raw.configured_item_key === null ? null : readString(raw.configured_item_key);
    const inputProgress = readNumber(raw.input_progress);
    const outputProgress = readNumber(raw.output_progress);
    const lastExtractedAt = raw.last_extracted_at === null ? null : readString(raw.last_extracted_at);

    if (
      !id ||
      !businessId ||
      slotNumber === null ||
      employeeId === undefined ||
      configuredItemKey === undefined ||
      inputProgress === null ||
      outputProgress === null ||
      lastExtractedAt === undefined
    ) continue;
    if (!status || !["active", "idle", "resting", "tool_broken"].includes(status)) continue;
    if (toolItemKey !== null && !["pickaxe", "axe", "drill_bit"].includes(toolItemKey)) continue;

    rows.push({
      id,
      business_id: businessId,
      slot_number: slotNumber,
      employee_id: employeeId,
      status: status as ExtractionSlotRow["status"],
      tool_item_key: toolItemKey as ExtractionSlotRow["tool_item_key"],
      configured_item_key: configuredItemKey,
      input_progress: inputProgress,
      output_progress: outputProgress,
      last_extracted_at: lastExtractedAt,
    });
  }

  return rows;
}

function parseBusinessRow(value: unknown): BusinessRow | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const playerId = readString(value.player_id);
  const cityId = readString(value.city_id);
  const type = readString(value.type);
  if (!id || !playerId || !cityId || !type) return null;
  return { id, player_id: playerId, city_id: cityId, type };
}

function parseInventoryRow(value: unknown): InventoryRow | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const quantity = readNumber(value.quantity);
  const reservedQuantity = readNumber(value.reserved_quantity);
  if (!id || quantity === null || reservedQuantity === null) return null;
  return { id, quantity, reserved_quantity: reservedQuantity };
}

function parseInventoryRows(value: unknown): InventoryRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => parseInventoryRow(row))
    .filter((row): row is InventoryRow => Boolean(row));
}

function parseEmployeeRow(value: unknown): EmployeeRow | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const status = readString(value.status);
  const shiftEndsAt = value.shift_ends_at === null ? null : readString(value.shift_ends_at);
  if (!id || !status || shiftEndsAt === undefined) return null;
  if (!["available", "assigned", "resting", "unpaid", "fired"].includes(status)) return null;
  return { id, status: status as EmployeeRow["status"], shift_ends_at: shiftEndsAt };
}

function parseAssignmentRow(value: unknown): AssignmentRow | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const slotNumberRaw = value.slot_number;
  let slotNumber: number | null = null;
  if (slotNumberRaw !== null) {
    const parsed = readNumber(slotNumberRaw);
    if (parsed === null) return null;
    slotNumber = parsed;
  }
  if (!id) return null;
  return { id, slot_number: slotNumber };
}

function parseToolDurabilityRow(value: unknown): ToolDurabilityRow | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const itemTypeRaw = value.item_type;
  const usesRemaining = readNumber(value.uses_remaining);
  const itemType = itemTypeRaw === null ? null : readString(itemTypeRaw);
  if (!id || usesRemaining === null || itemType === undefined) return null;
  if (itemType !== null && !["pickaxe", "axe", "drill_bit"].includes(itemType)) return null;
  return {
    id,
    item_type: itemType as ToolDurabilityRow["item_type"],
    uses_remaining: usesRemaining,
  };
}

function parseSkillRow(value: unknown): SkillRow | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const level = readNumber(value.level);
  const xp = readNumber(value.xp);
  if (!id || level === null || xp === null) return null;
  return { id, level, xp };
}

async function failSlot(
  supabase: EdgeSupabaseClient,
  slotId: string,
  status: "idle" | "resting" | "tool_broken"
) {
  const { error } = await supabase
    .from("extraction_slots")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", slotId);
  if (error) throw error;
}

async function hasAvailableBusinessTool(
  supabase: EdgeSupabaseClient,
  businessId: string,
  ownerPlayerId: string,
  itemKey: "pickaxe" | "axe" | "drill_bit"
): Promise<boolean> {
  const { data } = await supabase
    .from("business_inventory")
    .select("id, quantity, reserved_quantity")
    .eq("business_id", businessId)
    .eq("owner_player_id", ownerPlayerId)
    .eq("item_key", itemKey)
    .order("quality", { ascending: false })
    .order("updated_at", { ascending: true });

  return parseInventoryRows(data).some((row) => row.quantity - row.reserved_quantity >= 1);
}

function hasOperationalTool(
  slot: ExtractionSlotRow,
  tool: ToolDurabilityRow | null,
  requiredTool: "pickaxe" | "axe" | "drill_bit"
): boolean {
  return Boolean(
    tool &&
      tool.item_type === requiredTool &&
      tool.uses_remaining > 0 &&
      slot.tool_item_key === requiredTool
  );
}

function resolveProducedUnits(
  existingProgress: number,
  outputMultiplier: number
): { units: number; remainingProgress: number } {
  const totalProgress = existingProgress + outputMultiplier;
  const units = Math.floor(totalProgress);
  return {
    units,
    remainingProgress: totalProgress - units,
  };
}

Deno.serve(async (request) => {
  const requestStart = await startTickRequest(request, "tick-extraction");
  if ("response" in requestStart) return requestStart.response;

  const { supabase, release } = requestStart;
  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();
  try {

    const { data: slotRows, error: slotError } = await supabase
      .from("extraction_slots")
      .select("id, business_id, slot_number, employee_id, status, tool_item_key, configured_item_key, input_progress, output_progress, last_extracted_at")
      .eq("status", "active");

    if (slotError) {
      return new Response(JSON.stringify({ ok: false, error: slotError.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    let processed = 0;
    let producedTotal = 0;
    let restingCount = 0;
    let brokenTools = 0;
    let reducedOutputCount = 0;

    const parsedSlots = parseExtractionSlotRows(slotRows);
    const slotBusinessIds = [...new Set(parsedSlots.map((slot) => slot.business_id))];

    const { data: businessRows } = slotBusinessIds.length
      ? await supabase
          .from("businesses")
          .select("id, player_id, city_id, type")
          .in("id", slotBusinessIds)
      : { data: [] as unknown[] };

    const businessById = new Map<string, BusinessRow>();
    for (const row of businessRows ?? []) {
      const parsed = parseBusinessRow(row);
      if (parsed) businessById.set(parsed.id, parsed);
    }

    // Resolved once per business per tick instead of once per active slot --
    // getResolvedBusinessUpgradeEffectsForBusinesses batches the underlying
    // upgrade/project lookups across every business touched this tick.
    const upgradeEffectsByBusiness = await getResolvedBusinessUpgradeEffectsForBusinesses(
      supabase,
      [...businessById.values()].map((business) => ({ id: business.id, type: business.type }))
    );

    for (const slot of parsedSlots) {
     try {
    const typedBusiness = businessById.get(slot.business_id) ?? null;
    if (!typedBusiness) {
      await failSlot(supabase, slot.id, "idle");
      continue;
    }

    const outputItem =
      slot.configured_item_key ??
      EXTRACTION_OUTPUT_ITEM_BY_BUSINESS[typedBusiness.type as keyof typeof EXTRACTION_OUTPUT_ITEM_BY_BUSINESS];
    if (!outputItem) {
      await failSlot(supabase, slot.id, "idle");
      continue;
    }

    if (!slot.employee_id) {
      await failSlot(supabase, slot.id, "idle");
      continue;
    }

    const [{ data: rawEmployee }, { data: rawAssignment }] = await Promise.all([
      supabase
        .from("employees")
        .select("id, status, shift_ends_at")
        .eq("id", slot.employee_id)
        .maybeSingle(),
      supabase
        .from("employee_assignments")
        .select("id, business_id, employee_id, slot_number, role")
        .eq("employee_id", slot.employee_id)
        .eq("business_id", slot.business_id)
        .eq("role", "production")
        .maybeSingle(),
    ]);

    const employee = parseEmployeeRow(rawEmployee);
    const assignment = parseAssignmentRow(rawAssignment);

    const assignmentMismatch =
      !assignment ||
      (assignment.slot_number !== null && Number(assignment.slot_number) !== Number(slot.slot_number));

    if (
      !employee ||
      assignmentMismatch ||
      employee.status === "fired" ||
      employee.status === "unpaid" ||
      !isWorkerOperational(employee.status, employee.shift_ends_at)
    ) {
      await failSlot(supabase, slot.id, "resting");
      restingCount += 1;
      continue;
    }

    const requiredTool =
      EXTRACTION_REQUIRED_TOOL_BY_BUSINESS[typedBusiness.type as keyof typeof EXTRACTION_REQUIRED_TOOL_BY_BUSINESS] ?? null;
      const missingToolOutputMultiplier =
        EXTRACTION_MISSING_TOOL_OUTPUT_MULTIPLIER_BY_BUSINESS[
          typedBusiness.type as keyof typeof EXTRACTION_MISSING_TOOL_OUTPUT_MULTIPLIER_BY_BUSINESS
        ] ?? null;
      let outputMultiplier =
        EXTRACTION_BASE_OUTPUT_PER_TICK_BY_BUSINESS[
          typedBusiness.type as keyof typeof EXTRACTION_BASE_OUTPUT_PER_TICK_BY_BUSINESS
        ] ?? 1;
      const toolOutputBonus =
        EXTRACTION_TOOL_OUTPUT_BONUS_BY_BUSINESS[
          typedBusiness.type as keyof typeof EXTRACTION_TOOL_OUTPUT_BONUS_BY_BUSINESS
        ] ?? 0;
      if (requiredTool) {
        const { data: tool } = await supabase
          .from("tool_durability")
          .select("id, item_type, uses_remaining")
        .eq("extraction_slot_id", slot.id)
        .maybeSingle();

        const parsedTool = parseToolDurabilityRow(tool);
        const toolOperational = hasOperationalTool(slot, parsedTool, requiredTool);

        if (!toolOperational) {
          if (missingToolOutputMultiplier !== null) {
            outputMultiplier = missingToolOutputMultiplier;
            reducedOutputCount += 1;
          } else {
            const hasInventoryTool = await hasAvailableBusinessTool(
              supabase,
              typedBusiness.id,
              typedBusiness.player_id,
              requiredTool
            );

            if (!hasInventoryTool) {
              await failSlot(supabase, slot.id, "tool_broken");
              brokenTools += 1;
              continue;
            }
          }
        } else {
          const operationalTool = parsedTool!;
          outputMultiplier += Math.max(0, toolOutputBonus);
          const nextUses = operationalTool.uses_remaining - 1;
          const { error: toolUpdateError } = await supabase
            .from("tool_durability")
            .update({ uses_remaining: nextUses, updated_at: new Date().toISOString() })
            .eq("id", operationalTool.id);
          if (toolUpdateError) throw toolUpdateError;

          if (nextUses <= 0) {
            if (missingToolOutputMultiplier === null) {
              await failSlot(supabase, slot.id, "tool_broken");
              brokenTools += 1;
            }
          }
        }
      }

    const effects = upgradeEffectsByBusiness.get(typedBusiness.id)!;

    // Only farms consume a tracked input (water) per shared/economy.ts --
    // mines/logging camps/oil wells/water companies have no consumable, so
    // their output's cost basis is exactly 0, never derived from what NPCs
    // might pay for it (AccountingFixPlan item 42).
    const waterUseMultiplier = typedBusiness.type === "farm" ? Math.max(0, effects.farmWaterUseMultiplier) : 0;
    const totalInputProgress = slot.input_progress + waterUseMultiplier;
    const waterRequired = typedBusiness.type === "farm" ? Math.floor(totalInputProgress) : 0;
    const nextInputProgress = typedBusiness.type === "farm" ? totalInputProgress - waterRequired : slot.input_progress;

    const { units, remainingProgress } = resolveProducedUnits(
      slot.output_progress,
      outputMultiplier * effects.extractionOutputMultiplier
    );
    // add_business_inventory_quantity requires p_quality between 1 and 100 —
    // extractionQualityBonus defaults to 0 with no quality upgrades, so this
    // must floor at 1, not 0, or every unqualified business's first produced
    // unit throws and (with no per-slot isolation below) takes down the
    // entire tick for every other business too.
    const quality = Math.max(1, Math.min(100, Math.round(effects.extractionQualityBonus)));

    // Atomically relieves water cost (if any) and creates the produced batch
    // with a cost basis derived only from what was actually consumed --
    // never NPC_PRICE_CEILINGS. Raises insufficient_input:water instead of
    // partially consuming when there isn't enough water for the tick yet;
    // that's a normal "retry next tick" outcome, not a real failure.
    try {
      const { error: productionError } = await supabase.rpc("run_extraction_slot_production", {
        p_slot_id: slot.id,
        p_owner_player_id: typedBusiness.player_id,
        p_business_id: typedBusiness.id,
        p_city_id: typedBusiness.city_id,
        p_water_required: waterRequired,
        p_next_input_progress: nextInputProgress,
        p_output_item_key: outputItem,
        p_output_quality: quality,
        p_output_units: units,
        p_next_output_progress: remainingProgress,
      });
      if (productionError) throw productionError;
    } catch (productionError) {
      const message = productionError instanceof Error ? productionError.message : String(productionError);
      if (message.includes("insufficient_input:")) {
        continue;
      }
      throw productionError;
    }

    const skillKey =
      EXTRACTION_SKILL_KEY_BY_BUSINESS[typedBusiness.type as keyof typeof EXTRACTION_SKILL_KEY_BY_BUSINESS] ??
      "logistics";
    const { data: skill } = await supabase
      .from("employee_skills")
      .select("id, level, xp")
      .eq("employee_id", slot.employee_id)
      .eq("skill_key", skillKey)
      .maybeSingle();

    const parsedSkill = parseSkillRow(skill);
    if (parsedSkill) {
      let nextXp = parsedSkill.xp + EXTRACTION_XP_PER_TICK;
      let nextLevel = parsedSkill.level;
      // employee_skills.level is capped at 100 by employee_skills_level_check;
      // stop leveling once maxed instead of letting nextLevel climb past it.
      while (nextXp >= EXTRACTION_XP_PER_LEVEL && nextLevel < 100) {
        nextXp -= EXTRACTION_XP_PER_LEVEL;
        nextLevel += 1;
      }

      const { error: skillUpdateError } = await supabase
        .from("employee_skills")
        .update({ level: nextLevel, xp: nextXp, updated_at: new Date().toISOString() })
        .eq("id", parsedSkill.id);
      if (skillUpdateError) throw skillUpdateError;
    }

    // input_progress/output_progress/last_extracted_at were already
    // persisted atomically by run_extraction_slot_production above, together
    // with the inventory relief/creation they're derived from.

    processed += 1;
    producedTotal += units;
     } catch (slotError) {
      // One slot's failure must not stop every other business's extraction
      // slots from being processed this tick.
      console.error(`[tick-extraction] slot ${slot.id} failed, skipping:`, slotError);
     }
  }

    const finishedAtIso = new Date().toISOString();
    const payload = {
      ok: true,
      function: "tick-extraction",
      processed,
      producedTotal,
      restingCount,
      brokenTools,
      reducedOutputCount,
    };

    await writeTickRunLog(supabase, {
      tickName: "tick-extraction",
      status: "ok",
      startedAtIso,
      finishedAtIso,
      durationMs: new Date(finishedAtIso).getTime() - startedAt.getTime(),
      processedCount: processed,
      metrics: payload,
      errorMessage: null,
    });

    return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
  } catch (error) {
    const finishedAtIso = new Date().toISOString();
    const message = error instanceof Error ? error.message : "tick-extraction failed";

    try {
      await writeTickRunLog(supabase, {
        tickName: "tick-extraction",
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
