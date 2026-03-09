import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isRecord, readNumber, readString, startTickRequest, writeTickRunLog } from "../_shared/tick-runtime.ts";

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

type UpgradeRow = {
  level: number;
};

type SkillRow = {
  id: string;
  level: number;
  xp: number;
};

const OUTPUT_BY_TYPE: Record<string, string> = {
  mine: "iron_ore",
  farm: "wheat",
  water_company: "water",
  logging_camp: "raw_wood",
  oil_well: "crude_oil",
};

const TOOL_BY_TYPE: Partial<Record<string, "pickaxe" | "axe" | "drill_bit">> = {
  mine: "pickaxe",
  logging_camp: "axe",
  oil_well: "drill_bit",
};

const UPGRADE_BY_TYPE: Record<string, string> = {
  mine: "extraction_efficiency",
  farm: "crop_yield",
  water_company: "extraction_efficiency",
  logging_camp: "extraction_efficiency",
  oil_well: "extraction_efficiency",
};

const SKILL_BY_TYPE: Record<string, string> = {
  mine: "mining",
  farm: "farming",
  water_company: "logistics",
  logging_camp: "logging",
  oil_well: "logistics",
};

const XP_PER_TICK = 5;
const XP_PER_LEVEL = 100;
const GAIN_MULTIPLIER = 1.1;

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

function parseEmployeeRow(value: unknown): EmployeeRow | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const status = readString(value.status);
  const shiftEndsAt = value.shift_ends_at === null ? null : readString(value.shift_ends_at);
  if (!id || !status || shiftEndsAt === undefined) return null;
  return { id, status, shift_ends_at: shiftEndsAt };
}

function isWorkerOperational(status: string, shiftEndsAt: string | null): boolean {
  if (status !== "assigned") return false;
  if (!shiftEndsAt) return false;
  return new Date(shiftEndsAt).getTime() > Date.now();
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

function parseUpgradeRow(value: unknown): UpgradeRow | null {
  if (!isRecord(value)) return null;
  const level = readNumber(value.level);
  if (level === null) return null;
  return { level };
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
  ownerPlayerId: string
): Promise<boolean> {
  const { data: water } = await supabase
    .from("business_inventory")
    .select("id, quantity, reserved_quantity")
    .eq("business_id", businessId)
    .eq("owner_player_id", ownerPlayerId)
    .eq("item_key", "water")
    .eq("quality", 40)
    .maybeSingle();

  const { data: seeds } = await supabase
    .from("business_inventory")
    .select("id, quantity, reserved_quantity")
    .eq("business_id", businessId)
    .eq("owner_player_id", ownerPlayerId)
    .eq("item_key", "seeds")
    .eq("quality", 40)
    .maybeSingle();

  const parsedWater = parseInventoryRow(water);
  const parsedSeeds = parseInventoryRow(seeds);

  const waterAvailable = parsedWater && parsedWater.quantity - parsedWater.reserved_quantity >= 1;
  const seedsAvailable = parsedSeeds && parsedSeeds.quantity - parsedSeeds.reserved_quantity >= 1;

  if (!waterAvailable || !seedsAvailable) return false;

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

  const nextSeeds = parsedSeeds.quantity - 1;
  if (nextSeeds <= 0) {
    const { error } = await supabase.from("business_inventory").delete().eq("id", parsedSeeds.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("business_inventory")
      .update({ quantity: nextSeeds, updated_at: new Date().toISOString() })
      .eq("id", parsedSeeds.id);
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

    const outputItem = OUTPUT_BY_TYPE[typedBusiness.type];
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

    const requiredTool = TOOL_BY_TYPE[typedBusiness.type] ?? null;
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

    if (typedBusiness.type === "farm") {
      const consumed = await consumeFarmInputs(supabase, typedBusiness.id, typedBusiness.player_id);
      if (!consumed) {
        continue;
      }
    }

    const upgradeKey = UPGRADE_BY_TYPE[typedBusiness.type] ?? "extraction_efficiency";
    const { data: upgrade } = await supabase
      .from("business_upgrades")
      .select("level")
      .eq("business_id", typedBusiness.id)
      .eq("upgrade_key", upgradeKey)
      .maybeSingle();

    const level = parseUpgradeRow(upgrade)?.level ?? 0;
    const units = Math.max(1, Math.round(1 * Math.pow(GAIN_MULTIPLIER, Math.max(level, 0))));

    const { error: addInventoryError } = await supabase.rpc("add_business_inventory_quantity", {
      p_owner_player_id: typedBusiness.player_id,
      p_business_id: typedBusiness.id,
      p_city_id: typedBusiness.city_id,
      p_item_key: outputItem,
      p_quality: 40,
      p_quantity: units,
    });
    if (addInventoryError) throw addInventoryError;

    const skillKey = SKILL_BY_TYPE[typedBusiness.type] ?? "logistics";
    const { data: skill } = await supabase
      .from("employee_skills")
      .select("id, level, xp")
      .eq("employee_id", slot.employee_id)
      .eq("skill_key", skillKey)
      .maybeSingle();

    const parsedSkill = parseSkillRow(skill);
    if (parsedSkill) {
      let nextXp = parsedSkill.xp + XP_PER_TICK;
      let nextLevel = parsedSkill.level;
      while (nextXp >= XP_PER_LEVEL) {
        nextXp -= XP_PER_LEVEL;
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
