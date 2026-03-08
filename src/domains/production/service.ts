import {
  EXTRACTION_BUSINESS_TYPES,
  EXTRACTION_SLOT_STATUSES,
  TOOL_BASE_DURABILITY,
  getManufacturingRecipeByKey,
  getManufacturingRecipesForBusinessType,
  isExtractionBusinessType,
  isManufacturingBusinessType,
  type ExtractionBusinessType,
  type ManufacturingBusinessType,
} from "@/config/production";
import { getBusinessUpgrades } from "@/domains/businesses";
import { ensureOwnedBusinessType } from "@/domains/_shared/ownership";
import { getEmployeeAssignment, getEmployeeById, getEmployeeStatusFromShift } from "@/domains/employees";
import type { QueryClient } from "@/lib/db/query-client";
import type {
  AssignExtractionSlotInput,
  ExtractionSlot,
  ExtractionSlotWithDetails,
  InstallToolInput,
  ManufacturingJob,
  ManufacturingJobWithDetails,
  ManufacturingStatusView,
  ProductionStatus,
  SetExtractionSlotStatusInput,
  SetManufacturingRecipeInput,
  StartManufacturingInput,
  StopManufacturingInput,
  ToolDurability,
  UnassignExtractionSlotInput,
} from "./types";

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

function normalizeSlot(row: ExtractionSlot): ExtractionSlot {
  return {
    ...row,
    slot_number: Number(row.slot_number),
  };
}

function normalizeTool(row: ToolDurability): ToolDurability {
  return {
    ...row,
    uses_remaining: Number(row.uses_remaining),
  };
}

function normalizeManufacturingJob(row: ManufacturingJob): ManufacturingJob {
  return {
    ...row,
    worker_assigned: Boolean(row.worker_assigned),
  };
}

function getMaxSlots(workerCapacityLevel: number): number {
  return 1 + Math.max(0, workerCapacityLevel);
}

async function ensureOwnedExtractionBusiness(
  client: QueryClient,
  playerId: string,
  businessId: string
): Promise<{ id: string; player_id: string; city_id: string; type: ExtractionBusinessType }> {
  const business = await ensureOwnedBusinessType(
    client,
    playerId,
    businessId,
    isExtractionBusinessType,
    (type) => `Business type '${type}' does not support extraction slots.`
  );

  return {
    id: business.id,
    player_id: business.player_id,
    city_id: business.city_id,
    type: business.type,
  };
}

async function ensureOwnedManufacturingBusiness(
  client: QueryClient,
  playerId: string,
  businessId: string
): Promise<{ id: string; player_id: string; city_id: string; type: ManufacturingBusinessType }> {
  const business = await ensureOwnedBusinessType(
    client,
    playerId,
    businessId,
    isManufacturingBusinessType,
    (type) => `Business type '${type}' does not support manufacturing jobs.`
  );

  return {
    id: business.id,
    player_id: business.player_id,
    city_id: business.city_id,
    type: business.type,
  };
}

async function ensureManufacturingJob(
  client: QueryClient,
  playerId: string,
  businessId: string
): Promise<ManufacturingJobWithDetails> {
  const business = await ensureOwnedManufacturingBusiness(client, playerId, businessId);

  const { data: existingRow, error: existingError } = await client
    .from("manufacturing_jobs")
    .select("*")
    .eq("business_id", business.id)
    .maybeSingle();

  if (existingError) throw existingError;

  let job: ManufacturingJob;

  if (!existingRow) {
    const { data: insertedRow, error: insertError } = await client
      .from("manufacturing_jobs")
      .insert({
        business_id: business.id,
        status: "idle",
        active_recipe_key: null,
        worker_assigned: false,
      })
      .select("*")
      .single();

    if (insertError) throw insertError;
    job = normalizeManufacturingJob(insertedRow as ManufacturingJob);
  } else {
    job = normalizeManufacturingJob(existingRow as ManufacturingJob);
  }

  const recipes = getManufacturingRecipesForBusinessType(business.type);
  const activeRecipe = job.active_recipe_key ? getManufacturingRecipeByKey(job.active_recipe_key) : null;

  return {
    ...job,
    business_type: business.type,
    recipes,
    active_recipe: activeRecipe,
  };
}

async function getSlotByIdForPlayer(
  client: QueryClient,
  playerId: string,
  slotId: string
): Promise<ExtractionSlot & { business_type: ExtractionBusinessType }> {
  const { data: slotRow, error: slotError } = await client
    .from("extraction_slots")
    .select("*")
    .eq("id", slotId)
    .maybeSingle();

  if (slotError) throw slotError;
  if (!slotRow) throw new Error("Extraction slot not found.");

  const slot = normalizeSlot(slotRow as ExtractionSlot);
  const business = await ensureOwnedExtractionBusiness(client, playerId, slot.business_id);

  return {
    ...slot,
    business_type: business.type,
  };
}

export async function ensureExtractionSlots(
  client: QueryClient,
  playerId: string,
  businessId: string
): Promise<ExtractionSlot[]> {
  const business = await ensureOwnedExtractionBusiness(client, playerId, businessId);
  const upgrades = await getBusinessUpgrades(client, playerId, business.id);
  const workerCapacityLevel = upgrades.find((upgrade) => upgrade.upgrade_key === "worker_capacity")?.level ?? 0;
  const targetSlots = getMaxSlots(workerCapacityLevel);

  const { data: existingRows, error: existingError } = await client
    .from("extraction_slots")
    .select("*")
    .eq("business_id", business.id)
    .order("slot_number", { ascending: true });

  if (existingError) throw existingError;

  const existing = ((existingRows as ExtractionSlot[]) ?? []).map(normalizeSlot);
  const existingNumbers = new Set(existing.map((row) => row.slot_number));

  const inserts: Array<{ business_id: string; slot_number: number; status: "idle" }> = [];
  for (let slotNumber = 1; slotNumber <= targetSlots; slotNumber += 1) {
    if (!existingNumbers.has(slotNumber)) {
      inserts.push({ business_id: business.id, slot_number: slotNumber, status: "idle" });
    }
  }

  if (inserts.length > 0) {
    const { error: insertError } = await client.from("extraction_slots").insert(inserts);
    if (insertError) throw insertError;
  }

  const { data: finalRows, error: finalError } = await client
    .from("extraction_slots")
    .select("*")
    .eq("business_id", business.id)
    .order("slot_number", { ascending: true });

  if (finalError) throw finalError;
  return ((finalRows as ExtractionSlot[]) ?? []).map(normalizeSlot);
}

export async function getProductionStatus(
  client: QueryClient,
  playerId: string,
  businessId: string
): Promise<ProductionStatus> {
  const business = await ensureOwnedExtractionBusiness(client, playerId, businessId);
  const slots = await ensureExtractionSlots(client, playerId, business.id);

  const { data: toolRows, error: toolError } = await client
    .from("tool_durability")
    .select("*")
    .in(
      "extraction_slot_id",
      slots.map((slot) => slot.id)
    );

  if (toolError) throw toolError;
  const tools = ((toolRows as ToolDurability[]) ?? []).map(normalizeTool);
  const toolBySlot = new Map(tools.map((tool) => [tool.extraction_slot_id, tool]));

  const upgrades = await getBusinessUpgrades(client, playerId, business.id);
  const workerCapacityLevel = upgrades.find((upgrade) => upgrade.upgrade_key === "worker_capacity")?.level ?? 0;
  const maxSlots = getMaxSlots(workerCapacityLevel);

  const detailed: ExtractionSlotWithDetails[] = [];
  for (const slot of slots) {
    const employee = slot.employee_id ? await getEmployeeById(client, playerId, slot.employee_id) : null;

    detailed.push({
      ...slot,
      business_type: business.type,
      employee_status: employee?.status ?? null,
      tool: toolBySlot.get(slot.id) ?? null,
    });
  }

  const summary = {
    total: detailed.length,
    active: detailed.filter((slot) => slot.status === "active").length,
    idle: detailed.filter((slot) => slot.status === "idle").length,
    resting: detailed.filter((slot) => slot.status === "resting").length,
    toolBroken: detailed.filter((slot) => slot.status === "tool_broken").length,
    occupied: detailed.filter((slot) => Boolean(slot.employee_id)).length,
  };

  return {
    businessId: business.id,
    businessType: business.type,
    maxSlots,
    slots: detailed,
    summary,
  };
}

export async function assignExtractionSlot(
  client: QueryClient,
  playerId: string,
  input: AssignExtractionSlotInput
): Promise<ExtractionSlot> {
  const slot = await getSlotByIdForPlayer(client, playerId, input.slotId);

  const employee = await getEmployeeById(client, playerId, input.employeeId);
  if (!employee) throw new Error("Employee not found.");
  if (employee.status === "fired") throw new Error("Cannot assign a fired employee.");
  if (getEmployeeStatusFromShift(employee.status, employee.shift_ends_at) !== "assigned") {
    throw new Error("Employee must be active before slot assignment.");
  }

  const assignment = await getEmployeeAssignment(client, playerId, employee.id);
  if (!assignment || assignment.business_id !== slot.business_id) {
    throw new Error("Employee must be assigned to this business before slot assignment.");
  }
  if (assignment.role !== "production") {
    throw new Error("Employee must be assigned with production role before slot assignment.");
  }

  const { data: existingSlot, error: existingSlotError } = await client
    .from("extraction_slots")
    .select("id")
    .eq("employee_id", employee.id)
    .neq("id", slot.id)
    .maybeSingle();
  if (existingSlotError) throw existingSlotError;
  if (existingSlot) {
    throw new Error("Employee is already assigned to another production slot.");
  }

  const { error: assignmentUpdateError } = await client
    .from("employee_assignments")
    .update({
      slot_number: slot.slot_number,
      updated_at: new Date().toISOString(),
    })
    .eq("id", assignment.id);
  if (assignmentUpdateError) throw assignmentUpdateError;

  const { data, error } = await client
    .from("extraction_slots")
    .update({
      employee_id: employee.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", slot.id)
    .select("*")
    .single();

  if (error) throw error;
  return normalizeSlot(data as ExtractionSlot);
}

export async function unassignExtractionSlot(
  client: QueryClient,
  playerId: string,
  input: UnassignExtractionSlotInput
): Promise<ExtractionSlot> {
  const slot = await getSlotByIdForPlayer(client, playerId, input.slotId);

  if (slot.employee_id) {
    const assignment = await getEmployeeAssignment(client, playerId, slot.employee_id);
    if (assignment && assignment.business_id === slot.business_id && assignment.slot_number === slot.slot_number) {
      const { error: assignmentUpdateError } = await client
        .from("employee_assignments")
        .update({
          slot_number: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", assignment.id);
      if (assignmentUpdateError) throw assignmentUpdateError;
    }
  }

  const { data, error } = await client
    .from("extraction_slots")
    .update({
      employee_id: null,
      status: "idle",
      updated_at: new Date().toISOString(),
    })
    .eq("id", slot.id)
    .select("*")
    .single();

  if (error) throw error;
  return normalizeSlot(data as ExtractionSlot);
}

export async function installToolForSlot(
  client: QueryClient,
  playerId: string,
  input: InstallToolInput
): Promise<{ slot: ExtractionSlot; tool: ToolDurability }> {
  const slot = await getSlotByIdForPlayer(client, playerId, input.slotId);
  const business = await ensureOwnedExtractionBusiness(client, playerId, slot.business_id);

  const requiredToolByType: Partial<Record<ExtractionBusinessType, string>> = {
    mine: "pickaxe",
    logging_camp: "axe",
    oil_well: "drill_bit",
  };

  const requiredTool = requiredToolByType[business.type] ?? null;
  if (requiredTool && requiredTool !== input.itemType) {
    throw new Error(`Business type '${business.type}' requires tool '${requiredTool}'.`);
  }

  const upgrades = await getBusinessUpgrades(client, playerId, business.id);
  const durabilityLevel = upgrades.find((upgrade) => upgrade.upgrade_key === "tool_durability")?.level ?? 0;
  const uses = Math.max(1, Math.round(TOOL_BASE_DURABILITY[input.itemType] * Math.pow(1.1, durabilityLevel)));

  const { data: toolRow, error: toolError } = await client
    .from("tool_durability")
    .upsert(
      {
        extraction_slot_id: slot.id,
        item_type: input.itemType,
        uses_remaining: uses,
        installed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "extraction_slot_id" }
    )
    .select("*")
    .single();

  if (toolError) throw toolError;

  const { data: updatedSlotRow, error: slotError } = await client
    .from("extraction_slots")
    .update({
      tool_item_key: input.itemType,
      status: slot.employee_id ? "active" : "idle",
      updated_at: new Date().toISOString(),
    })
    .eq("id", slot.id)
    .select("*")
    .single();

  if (slotError) throw slotError;

  return {
    slot: normalizeSlot(updatedSlotRow as ExtractionSlot),
    tool: normalizeTool(toolRow as ToolDurability),
  };
}

export async function setExtractionSlotStatus(
  client: QueryClient,
  playerId: string,
  input: SetExtractionSlotStatusInput
): Promise<ExtractionSlot> {
  const slot = await getSlotByIdForPlayer(client, playerId, input.slotId);

  if (!EXTRACTION_SLOT_STATUSES.includes(input.status)) {
    throw new Error("Invalid slot status.");
  }

  if (input.status === "active" && !slot.employee_id) {
    throw new Error("Cannot activate a slot without an assigned employee.");
  }

  if (input.status === "active" && slot.employee_id) {
    const [employee, assignment] = await Promise.all([
      getEmployeeById(client, playerId, slot.employee_id),
      getEmployeeAssignment(client, playerId, slot.employee_id),
    ]);

    if (!employee) {
      throw new Error("Cannot activate slot because assigned employee could not be found.");
    }

    if (getEmployeeStatusFromShift(employee.status, employee.shift_ends_at) !== "assigned") {
      throw new Error("Cannot activate slot with a resting or unavailable employee.");
    }

    if (!assignment || assignment.business_id !== slot.business_id || assignment.role !== "production") {
      throw new Error("Cannot activate slot unless employee has a production assignment in this business.");
    }
  }

  if (input.status === "active" && EXTRACTION_BUSINESS_TYPES.includes(slot.business_type)) {
    const requiredToolByType: Partial<Record<ExtractionBusinessType, string>> = {
      mine: "pickaxe",
      logging_camp: "axe",
      oil_well: "drill_bit",
    };

    const requiredTool = requiredToolByType[slot.business_type] ?? null;
    if (requiredTool && slot.tool_item_key !== requiredTool) {
      throw new Error(`Cannot activate slot without required tool '${requiredTool}'.`);
    }
  }

  const { data, error } = await client
    .from("extraction_slots")
    .update({
      status: input.status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", slot.id)
    .select("*")
    .single();

  if (error) throw error;
  return normalizeSlot(data as ExtractionSlot);
}

export async function getManufacturingStatus(
  client: QueryClient,
  playerId: string,
  businessId: string
): Promise<ManufacturingStatusView> {
  const business = await ensureOwnedManufacturingBusiness(client, playerId, businessId);
  const job = await ensureManufacturingJob(client, playerId, business.id);

  return {
    businessId: business.id,
    businessType: business.type,
    job,
  };
}

export async function setManufacturingRecipe(
  client: QueryClient,
  playerId: string,
  input: SetManufacturingRecipeInput
): Promise<ManufacturingStatusView> {
  const business = await ensureOwnedManufacturingBusiness(client, playerId, input.businessId);
  const recipe = getManufacturingRecipeByKey(input.recipeKey);

  if (!recipe || recipe.businessType !== business.type) {
    throw new Error("Recipe is not valid for this business.");
  }

  const { error } = await client
    .from("manufacturing_jobs")
    .upsert(
      {
        business_id: business.id,
        active_recipe_key: recipe.key,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "business_id" }
    );

  if (error) throw error;
  return getManufacturingStatus(client, playerId, business.id);
}

export async function startManufacturing(
  client: QueryClient,
  playerId: string,
  input: StartManufacturingInput
): Promise<ManufacturingStatusView> {
  const current = await getManufacturingStatus(client, playerId, input.businessId);
  if (!current.job.active_recipe_key) {
    throw new Error("Set an active recipe before starting manufacturing.");
  }

  const { error } = await client
    .from("manufacturing_jobs")
    .update({
      status: "active",
      updated_at: new Date().toISOString(),
    })
    .eq("id", current.job.id);

  if (error) throw error;
  return getManufacturingStatus(client, playerId, input.businessId);
}

export async function stopManufacturing(
  client: QueryClient,
  playerId: string,
  input: StopManufacturingInput
): Promise<ManufacturingStatusView> {
  const current = await getManufacturingStatus(client, playerId, input.businessId);

  const { error } = await client
    .from("manufacturing_jobs")
    .update({
      status: "idle",
      updated_at: new Date().toISOString(),
    })
    .eq("id", current.job.id);

  if (error) throw error;
  return getManufacturingStatus(client, playerId, input.businessId);
}
