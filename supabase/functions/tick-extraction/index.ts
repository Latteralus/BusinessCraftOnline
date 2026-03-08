// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

  const waterAvailable = water && Number(water.quantity) - Number(water.reserved_quantity) >= 1;
  const seedsAvailable = seeds && Number(seeds.quantity) - Number(seeds.reserved_quantity) >= 1;

  if (!waterAvailable || !seedsAvailable) return false;

  const nextWater = Number(water.quantity) - 1;
  if (nextWater <= 0) {
    const { error } = await supabase.from("business_inventory").delete().eq("id", water.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("business_inventory")
      .update({ quantity: nextWater, updated_at: new Date().toISOString() })
      .eq("id", water.id);
    if (error) throw error;
  }

  const nextSeeds = Number(seeds.quantity) - 1;
  if (nextSeeds <= 0) {
    const { error } = await supabase.from("business_inventory").delete().eq("id", seeds.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("business_inventory")
      .update({ quantity: nextSeeds, updated_at: new Date().toISOString() })
      .eq("id", seeds.id);
    if (error) throw error;
  }

  return true;
}

Deno.serve(async () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

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

  for (const slot of (slotRows as ExtractionSlotRow[]) ?? []) {
    const { data: business } = await supabase
      .from("businesses")
      .select("id, player_id, city_id, type")
      .eq("id", slot.business_id)
      .maybeSingle();

    if (!business) {
      await failSlot(supabase, slot.id, "idle");
      continue;
    }

    const typedBusiness = business as BusinessRow;
    const outputItem = OUTPUT_BY_TYPE[typedBusiness.type];
    if (!outputItem) {
      await failSlot(supabase, slot.id, "idle");
      continue;
    }

    if (!slot.employee_id) {
      await failSlot(supabase, slot.id, "idle");
      continue;
    }

    const [{ data: employee }, { data: assignment }] = await Promise.all([
      supabase
        .from("employees")
        .select("id, status")
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

    const assignmentMismatch =
      !assignment ||
      (assignment.slot_number !== null && Number(assignment.slot_number) !== Number(slot.slot_number));

    if (!employee || assignmentMismatch || employee.status === "fired" || employee.status === "unpaid") {
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

      const invalidTool =
        !tool ||
        tool.item_type !== requiredTool ||
        Number(tool.uses_remaining) <= 0 ||
        slot.tool_item_key !== requiredTool;

      if (invalidTool) {
        await failSlot(supabase, slot.id, "tool_broken");
        brokenTools += 1;
        continue;
      }

      const nextUses = Number(tool.uses_remaining) - 1;
      const { error: toolUpdateError } = await supabase
        .from("tool_durability")
        .update({ uses_remaining: nextUses, updated_at: new Date().toISOString() })
        .eq("id", tool.id);
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

    const level = upgrade ? Number(upgrade.level) : 0;
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

    const { error: slotUpdateError } = await supabase
      .from("extraction_slots")
      .update({ last_extracted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", slot.id);
    if (slotUpdateError) throw slotUpdateError;

    processed += 1;
    producedTotal += units;
  }

  return new Response(
    JSON.stringify({
      ok: true,
      function: "tick-extraction",
      processed,
      producedTotal,
      restingCount,
      brokenTools,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
});
