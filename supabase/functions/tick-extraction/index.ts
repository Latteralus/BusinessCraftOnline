import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isRecord, readNumber, readString, startTickRequest, writeTickRunLog } from "../_shared/tick-runtime.ts";
import { isWorkerOperational } from "../_shared/employee-status.ts";
import { getResolvedBusinessUpgradeEffects } from "../_shared/business-upgrades.ts";
import {
  EXTRACTION_OUTPUT_ITEM_BY_BUSINESS,
  EXTRACTION_REQUIRED_TOOL_BY_BUSINESS,
  EXTRACTION_SKILL_KEY_BY_BUSINESS,
  EXTRACTION_XP_PER_LEVEL,
  EXTRACTION_XP_PER_TICK,
} from "../../../shared/production/extraction.ts";

type ExtractionSlotRow = {
  id: string;
  business_id: string;
  slot_number: number;
  employee_id: string | null;
  status: "active" | "idle" | "resting" | "tool_broken";
  tool_item_key: "pickaxe" | "axe" | "drill_bit" | null;
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
  status: string;
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

    if (!id || !businessId || slotNumber === null || employeeId === undefined) continue;
    if (!status || !["active", "idle", "resting", "tool_broken"].includes(status)) continue;
    if (toolItemKey !== null && !["pickaxe", "axe", "drill_bit"].includes(toolItemKey)) continue;

    rows.push({
      id,
      business_id: businessId,
      slot_number: slotNumber,
      employee_id: employeeId,
      status: status as ExtractionSlotRow["status"],
      tool_item_key: toolItemKey as ExtractionSlotRow["tool_item_key"],
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
  return { id, status, shift_ends_at: shiftEndsAt };
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
  supabase: ReturnType<typeof createClient>,
  slotId: string,
  status: "idle" | "resting" | "tool_broken"
) {
  const { error } = await supabase
    .from("extraction_slots")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", slotId);
  if (error) throw error;
}

async function consumeFarmInputs(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  ownerPlayerId: string,
  waterUseMultiplier: number
): Promise<boolean> {
  const consumeThisTick = Math.random() < Math.max(0, Math.min(1, waterUseMultiplier));
  if (!consumeThisTick) return true;

  const { data: water } = await supabase
    .from("business_inventory")
    .select("id, quantity, reserved_quantity")
    .eq("business_id", businessId)
    .eq("owner_player_id", ownerPlayerId)
    .eq("item_key", "water")
    .order("quality", { ascending: false })
    .order("updated_at", { ascending: true });

  const parsedWater = parseInventoryRows(water).find(
    (row) => row.quantity - row.reserved_quantity >= 1
  );
  const waterAvailable = parsedWater && parsedWater.quantity - parsedWater.reserved_quantity >= 1;
  if (!waterAvailable) return false;

  const nextWater = parsedWater.quantity - 1;
  if (nextWater <= 0) {
    const { error } = await supabase.from("business_inventory").delete().eq("id", parsedWater.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("business_inventory")
      .update({ quantity: nextWater, updated_at: new Date().toISOString() })
      .eq("id", parsedWater.id);
    if (error) throw error;
  }

  return true;
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
      .select("id, business_id, slot_number, employee_id, status, tool_item_key")
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

    for (const slot of parseExtractionSlotRows(slotRows)) {
    const { data: business } = await supabase
      .from("businesses")
      .select("id, player_id, city_id, type")
      .eq("id", slot.business_id)
      .maybeSingle();

    const typedBusiness = parseBusinessRow(business);
    if (!typedBusiness) {
      await failSlot(supabase, slot.id, "idle");
      continue;
    }

    const outputItem = EXTRACTION_OUTPUT_ITEM_BY_BUSINESS[typedBusiness.type as keyof typeof EXTRACTION_OUTPUT_ITEM_BY_BUSINESS];
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
    if (requiredTool) {
      const { data: tool } = await supabase
        .from("tool_durability")
        .select("id, item_type, uses_remaining")
        .eq("extraction_slot_id", slot.id)
        .maybeSingle();

      const parsedTool = parseToolDurabilityRow(tool);

      const invalidTool =
        !parsedTool ||
        parsedTool.item_type !== requiredTool ||
        parsedTool.uses_remaining <= 0 ||
        slot.tool_item_key !== requiredTool;

      if (invalidTool) {
        await failSlot(supabase, slot.id, "tool_broken");
        brokenTools += 1;
        continue;
      }

      const nextUses = parsedTool.uses_remaining - 1;
      const { error: toolUpdateError } = await supabase
        .from("tool_durability")
        .update({ uses_remaining: nextUses, updated_at: new Date().toISOString() })
        .eq("id", parsedTool.id);
      if (toolUpdateError) throw toolUpdateError;

      if (nextUses <= 0) {
        await failSlot(supabase, slot.id, "tool_broken");
        brokenTools += 1;
        continue;
      }
    }

    const effects = await getResolvedBusinessUpgradeEffects(
      supabase,
      typedBusiness.id,
      typedBusiness.type as BusinessRow["type"]
    );

    if (typedBusiness.type === "farm") {
      const consumed = await consumeFarmInputs(
        supabase,
        typedBusiness.id,
        typedBusiness.player_id,
        effects.farmWaterUseMultiplier
      );
      if (!consumed) {
        continue;
      }
    }
    const units = Math.max(1, Math.round(1 * effects.extractionOutputMultiplier));
    const quality = Math.max(1, Math.min(100, Math.round(40 + effects.extractionQualityBonus)));

    const { error: addInventoryError } = await supabase.rpc("add_business_inventory_quantity", {
      p_owner_player_id: typedBusiness.player_id,
      p_business_id: typedBusiness.id,
      p_city_id: typedBusiness.city_id,
      p_item_key: outputItem,
      p_quality: quality,
      p_quantity: units,
    });
    if (addInventoryError) throw addInventoryError;

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
      while (nextXp >= EXTRACTION_XP_PER_LEVEL) {
        nextXp -= EXTRACTION_XP_PER_LEVEL;
        nextLevel += 1;
      }

      const { error: skillUpdateError } = await supabase
        .from("employee_skills")
        .update({ level: nextLevel, xp: nextXp, updated_at: new Date().toISOString() })
        .eq("id", parsedSkill.id);
      if (skillUpdateError) throw skillUpdateError;
    }

    const { error: slotUpdateError } = await supabase
      .from("extraction_slots")
      .update({ last_extracted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", slot.id);
    if (slotUpdateError) throw slotUpdateError;

    processed += 1;
    producedTotal += units;
  }

    const finishedAtIso = new Date().toISOString();
    const payload = {
      ok: true,
      function: "tick-extraction",
      processed,
      producedTotal,
      restingCount,
      brokenTools,
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
