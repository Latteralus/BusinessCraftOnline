import {
  EXTRACTION_BASE_OUTPUT_PER_TICK_BY_BUSINESS,
  EXTRACTION_BUSINESS_TYPES,
  EXTRACTION_LINE_LABEL_BY_BUSINESS,
  EXTRACTION_MISSING_TOOL_OUTPUT_MULTIPLIER_BY_BUSINESS,
  EXTRACTION_OUTPUT_ITEM_BY_BUSINESS,
  EXTRACTION_PRODUCT_OPTIONS_BY_BUSINESS,
  EXTRACTION_REQUIRED_TOOL_BY_BUSINESS,
  EXTRACTION_RETOOL_COST_BY_BUSINESS,
  EXTRACTION_SLOT_STATUSES,
  EXTRACTION_TOOL_OUTPUT_BONUS_BY_BUSINESS,
  MANUFACTURING_RETOOL_COST_BY_BUSINESS,
  PRODUCTION_RETOOL_DURATION_MINUTES,
  TOOL_BASE_DURABILITY,
  getExtractionProductOption,
  getManufacturingRecipeByKey,
  getManufacturingRecipesForBusinessType,
  isExtractionBusinessType,
  isManufacturingBusinessType,
  type ExtractionBusinessType,
  type ManufacturingRecipe,
  type ManufacturingBusinessType,
} from "@/config/production";
import { ensureOwnedBusinessType } from "@/domains/_shared/ownership";
import { addBusinessAccountEntry, getBusinessBalance } from "@/domains/businesses/service";
import { getEmployeeById, getEmployeesByIds, getEmployeeStatusFromShift } from "@/domains/employees";
import { getResolvedUpgradeEffects } from "@/domains/upgrades";
import type { QueryClient } from "@/lib/db/query-client";
import { toNumber } from "@/lib/core/number";
import type {
  AssignExtractionSlotInput,
  AssignManufacturingLineInput,
  ExtractionSlot,
  ExtractionSlotWithDetails,
  InstallToolInput,
  ManufacturingLine,
  ManufacturingLineWithDetails,
  ManufacturingStatusView,
  ProductionStatus,
  RetoolExtractionSlotInput,
  RetoolManufacturingLineInput,
  SetExtractionSlotStatusInput,
  SetManufacturingLineStatusInput,
  SetManufacturingRecipeInput,
  StartManufacturingInput,
  StopManufacturingInput,
  ToolDurability,
  UnassignExtractionSlotInput,
  UnassignManufacturingLineInput,
} from "./types";

function plusMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function normalizeSlot(row: ExtractionSlot): ExtractionSlot {
  return {
    ...row,
    slot_number: Number(row.slot_number),
    input_progress: Number(row.input_progress ?? 0),
    output_progress: Number(row.output_progress ?? 0),
    configured_item_key: row.configured_item_key ?? null,
    pending_item_key: row.pending_item_key ?? null,
    retool_started_at: row.retool_started_at ?? null,
    retool_complete_at: row.retool_complete_at ?? null,
  };
}

function normalizeTool(row: ToolDurability): ToolDurability {
  return {
    ...row,
    uses_remaining: Number(row.uses_remaining),
  };
}

function normalizeManufacturingLine(row: ManufacturingLine): ManufacturingLine {
  return {
    ...row,
    line_number: Number(row.line_number),
    worker_assigned: Boolean(row.worker_assigned),
    output_progress: Number(row.output_progress ?? 0),
    configured_recipe_key: row.configured_recipe_key ?? null,
    pending_recipe_key: row.pending_recipe_key ?? null,
    employee_id: row.employee_id ?? null,
    retool_started_at: row.retool_started_at ?? null,
    retool_complete_at: row.retool_complete_at ?? null,
    input_progress:
      row.input_progress && typeof row.input_progress === "object" && !Array.isArray(row.input_progress)
        ? Object.fromEntries(
            Object.entries(row.input_progress).map(([key, value]) => [key, Number(value ?? 0)])
          )
        : {},
  };
}

function resolveReadyManufacturingStatus(
  line: Pick<ManufacturingLine, "employee_id" | "worker_assigned" | "configured_recipe_key" | "status">
): ManufacturingLine["status"] {
  if (line.status === "retooling") return "retooling";
  if (!line.configured_recipe_key) return "idle";
  if (!line.employee_id && !line.worker_assigned) return "idle";
  return "active";
}

function getMaxLines(workerCapacitySlots: number): number {
  return 1 + Math.max(0, Math.trunc(workerCapacitySlots));
}

async function getHydratedManufacturingLine(
  client: QueryClient,
  playerId: string,
  businessId: string,
  lineId: string
): Promise<ManufacturingLineWithDetails> {
  const status = await getManufacturingStatus(client, playerId, businessId);
  const line = status.lines.find((entry) => entry.id === lineId);

  if (!line) {
    throw new Error("Manufacturing line not found after update.");
  }

  return line;
}

async function syncLegacyManufacturingJobForBusiness(
  client: QueryClient,
  businessId: string
): Promise<void> {
  const { data: lineRows, error: lineError } = await client
    .from("manufacturing_lines")
    .select("*")
    .eq("business_id", businessId)
    .order("line_number", { ascending: true });
  if (lineError) throw lineError;

  const lines = ((lineRows as ManufacturingLine[]) ?? []).map(normalizeManufacturingLine);
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
    output_progress: legacySource?.output_progress ?? 0,
    input_progress: legacySource?.input_progress ?? {},
    last_tick_at: legacySource?.last_tick_at ?? null,
    updated_at: new Date().toISOString(),
  };

  const { error: upsertError } = await client
    .from("manufacturing_jobs")
    .upsert(payload, { onConflict: "business_id" });
  if (upsertError) throw upsertError;
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
    (type) => `Business type '${type}' does not support manufacturing lines.`
  );

  return {
    id: business.id,
    player_id: business.player_id,
    city_id: business.city_id,
    type: business.type,
  };
}

function resolveExtractionConfiguredItem(slot: ExtractionSlot, businessType: ExtractionBusinessType) {
  return slot.configured_item_key ?? EXTRACTION_OUTPUT_ITEM_BY_BUSINESS[businessType];
}

function resolveExtractionStatus(
  slot: ExtractionSlot,
  businessType: ExtractionBusinessType
): ExtractionSlot["status"] {
  if (slot.retool_complete_at || slot.pending_item_key) return "retooling";
  if (!slot.employee_id) return "idle";

  const requiredTool = EXTRACTION_REQUIRED_TOOL_BY_BUSINESS[businessType] ?? null;
  const supportsMissingToolOutput =
    EXTRACTION_MISSING_TOOL_OUTPUT_MULTIPLIER_BY_BUSINESS[businessType] !== undefined;

  if (!requiredTool || slot.tool_item_key === requiredTool || supportsMissingToolOutput) {
    return "active";
  }

  return "idle";
}

function resolveDisplayedExtractionStatus(
  slot: ExtractionSlot,
  employeeStatus: ReturnType<typeof getEmployeeStatusFromShift> | null
): ExtractionSlot["status"] {
  if (slot.status === "retooling" || slot.pending_item_key || slot.retool_complete_at) {
    return "retooling";
  }
  if (!slot.employee_id) {
    return "idle";
  }
  if (employeeStatus !== "assigned") {
    return "resting";
  }
  return slot.status;
}

function roundRate(value: number): number {
  return Number(value.toFixed(4));
}

function hasOperationalExtractionTool(
  slot: ExtractionSlot,
  tool: ToolDurability | null,
  businessType: ExtractionBusinessType
): boolean {
  const requiredTool = EXTRACTION_REQUIRED_TOOL_BY_BUSINESS[businessType] ?? null;
  if (!requiredTool) return true;
  return slot.tool_item_key === requiredTool && tool?.item_type === requiredTool && tool.uses_remaining > 0;
}

function getExtractionThroughputPerMinute(
  slot: ExtractionSlot,
  tool: ToolDurability | null,
  businessType: ExtractionBusinessType,
  displayedStatus: ExtractionSlot["status"],
  effects: Awaited<ReturnType<typeof getResolvedUpgradeEffects>>
): number {
  if (displayedStatus !== "active") return 0;

  const requiredTool = EXTRACTION_REQUIRED_TOOL_BY_BUSINESS[businessType] ?? null;
  const baseOutput = EXTRACTION_BASE_OUTPUT_PER_TICK_BY_BUSINESS[businessType] ?? 1;
  const multiplier = effects.extractionOutputMultiplier;
  if (!requiredTool) {
    return roundRate(baseOutput * multiplier);
  }

  if (hasOperationalExtractionTool(slot, tool, businessType)) {
    const toolBonus = EXTRACTION_TOOL_OUTPUT_BONUS_BY_BUSINESS[businessType] ?? 0;
    return roundRate((baseOutput + toolBonus) * multiplier);
  }

  const fallbackOutput = EXTRACTION_MISSING_TOOL_OUTPUT_MULTIPLIER_BY_BUSINESS[businessType] ?? 0;
  return roundRate(fallbackOutput * multiplier);
}

function resolveDisplayedManufacturingStatus(
  line: ManufacturingLine,
  employeeStatus: ReturnType<typeof getEmployeeStatusFromShift> | null
): ManufacturingLine["status"] {
  if (line.status === "retooling" || line.pending_recipe_key || line.retool_complete_at) {
    return "retooling";
  }
  if (!line.employee_id) {
    return "idle";
  }
  if (employeeStatus !== "assigned") {
    return "resting";
  }
  return line.status;
}

function getManufacturingOutputPerMinute(
  lineStatus: ManufacturingLine["status"],
  recipe: ManufacturingRecipe | null,
  effects: Awaited<ReturnType<typeof getResolvedUpgradeEffects>>
): number {
  if (lineStatus !== "active" || !recipe) return 0;
  return roundRate(recipe.baseOutputQuantity * effects.manufacturingOutputMultiplier);
}

function getManufacturingInputRequirementsPerMinute(
  lineStatus: ManufacturingLine["status"],
  recipe: ManufacturingRecipe | null,
  effects: Awaited<ReturnType<typeof getResolvedUpgradeEffects>>
): Array<{ itemKey: string; quantity: number }> {
  if (lineStatus !== "active" || !recipe) return [];
  return recipe.inputs.map((input) => ({
    itemKey: input.itemKey,
    quantity: roundRate(input.quantity * effects.manufacturingInputUseMultiplier),
  }));
}

async function finalizeExtractionRetools(client: QueryClient, businessId: string): Promise<void> {
  const nowIso = new Date().toISOString();
  const { data, error } = await client
    .from("extraction_slots")
    .select("*")
    .eq("business_id", businessId)
    .not("pending_item_key", "is", null)
    .not("retool_complete_at", "is", null)
    .lte("retool_complete_at", nowIso);
  if (error) throw error;

  const rows = ((data as ExtractionSlot[]) ?? []).map(normalizeSlot);
  if (rows.length === 0) return;

  const { data: businessRow, error: businessError } = await client
    .from("businesses")
    .select("type")
    .eq("id", businessId)
    .single();
  if (businessError) throw businessError;
  const businessTypeValue = String((businessRow as { type: string }).type);
  if (!(EXTRACTION_BUSINESS_TYPES as readonly string[]).includes(businessTypeValue)) return;
  const businessType = businessTypeValue as ExtractionBusinessType;

  for (const slot of rows) {
    const nextConfigured = slot.pending_item_key;
    const nextStatus = resolveExtractionStatus(
      {
        ...slot,
        configured_item_key: nextConfigured,
        pending_item_key: null,
        retool_complete_at: null,
        retool_started_at: null,
      },
      businessType
    );

    const { error: updateError } = await client
      .from("extraction_slots")
      .update({
        configured_item_key: nextConfigured,
        pending_item_key: null,
        retool_started_at: null,
        retool_complete_at: null,
        input_progress: 0,
        output_progress: 0,
        status: slot.employee_id ? nextStatus : "idle",
        updated_at: nowIso,
      })
      .eq("id", slot.id);
    if (updateError) throw updateError;
  }
}

async function reactivateFallbackExtractionSlots(
  client: QueryClient,
  businessId: string,
  businessType: ExtractionBusinessType
): Promise<void> {
  const supportsMissingToolOutput =
    EXTRACTION_MISSING_TOOL_OUTPUT_MULTIPLIER_BY_BUSINESS[businessType] !== undefined;
  if (!supportsMissingToolOutput) return;

  const nowIso = new Date().toISOString();
  const { data, error } = await client
    .from("extraction_slots")
    .select("*")
    .eq("business_id", businessId)
    .eq("status", "tool_broken")
    .not("employee_id", "is", null);
  if (error) throw error;

  const rows = ((data as ExtractionSlot[]) ?? []).map(normalizeSlot);
  for (const slot of rows) {
    const nextStatus = resolveExtractionStatus(slot, businessType);
    if (nextStatus === slot.status) continue;

    const { error: updateError } = await client
      .from("extraction_slots")
      .update({
        status: nextStatus,
        updated_at: nowIso,
      })
      .eq("id", slot.id);
    if (updateError) throw updateError;
  }
}

async function finalizeManufacturingRetools(client: QueryClient, businessId: string): Promise<void> {
  const nowIso = new Date().toISOString();
  const { data, error } = await client
    .from("manufacturing_lines")
    .select("*")
    .eq("business_id", businessId)
    .not("pending_recipe_key", "is", null)
    .not("retool_complete_at", "is", null)
    .lte("retool_complete_at", nowIso);
  if (error) throw error;

  const lines = ((data as ManufacturingLine[]) ?? []).map(normalizeManufacturingLine);
  for (const line of lines) {
    const { error: updateError } = await client
      .from("manufacturing_lines")
      .update({
        configured_recipe_key: line.pending_recipe_key,
        pending_recipe_key: null,
        retool_started_at: null,
        retool_complete_at: null,
        status: resolveReadyManufacturingStatus({
          ...line,
          configured_recipe_key: line.pending_recipe_key,
          status: line.status,
        }),
        output_progress: 0,
        input_progress: {},
        updated_at: nowIso,
      })
      .eq("id", line.id);
    if (updateError) throw updateError;
  }

  if (lines.length > 0) {
    await syncLegacyManufacturingJobForBusiness(client, businessId);
  }
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
  return { ...slot, business_type: business.type };
}

async function getManufacturingLineByIdForPlayer(
  client: QueryClient,
  playerId: string,
  lineId: string
): Promise<ManufacturingLine & { business_type: ManufacturingBusinessType }> {
  const { data: lineRow, error: lineError } = await client
    .from("manufacturing_lines")
    .select("*")
    .eq("id", lineId)
    .maybeSingle();
  if (lineError) throw lineError;
  if (!lineRow) throw new Error("Manufacturing line not found.");

  const line = normalizeManufacturingLine(lineRow as ManufacturingLine);
  const business = await ensureOwnedManufacturingBusiness(client, playerId, line.business_id);
  return { ...line, business_type: business.type };
}

export async function ensureExtractionSlots(
  client: QueryClient,
  playerId: string,
  businessId: string
): Promise<ExtractionSlot[]> {
  const business = await ensureOwnedExtractionBusiness(client, playerId, businessId);
  const effects = await getResolvedUpgradeEffects(client, business.id, business.type);
  const targetSlots = getMaxLines(effects.workerCapacitySlots);

  const { data: existingRows, error: existingError } = await client
    .from("extraction_slots")
    .select("*")
    .eq("business_id", business.id)
    .order("slot_number", { ascending: true });
  if (existingError) throw existingError;

  const existing = ((existingRows as ExtractionSlot[]) ?? []).map(normalizeSlot);
  const existingNumbers = new Set(existing.map((row) => row.slot_number));
  const defaultItemKey = EXTRACTION_OUTPUT_ITEM_BY_BUSINESS[business.type];

  const inserts: Array<{ business_id: string; slot_number: number; status: "idle"; configured_item_key: string }> = [];
  for (let slotNumber = 1; slotNumber <= targetSlots; slotNumber += 1) {
    if (!existingNumbers.has(slotNumber)) {
      inserts.push({
        business_id: business.id,
        slot_number: slotNumber,
        status: "idle",
        configured_item_key: defaultItemKey,
      });
    }
  }

  if (inserts.length > 0) {
    const { error: insertError } = await client.from("extraction_slots").insert(inserts);
    if (insertError) throw insertError;
  }

  await finalizeExtractionRetools(client, business.id);
  await reactivateFallbackExtractionSlots(client, business.id, business.type);

  const { data: finalRows, error: finalError } = await client
    .from("extraction_slots")
    .select("*")
    .eq("business_id", business.id)
    .order("slot_number", { ascending: true });
  if (finalError) throw finalError;

  return ((finalRows as ExtractionSlot[]) ?? []).map(normalizeSlot);
}

async function ensureManufacturingLines(
  client: QueryClient,
  playerId: string,
  businessId: string
): Promise<ManufacturingLine[]> {
  const business = await ensureOwnedManufacturingBusiness(client, playerId, businessId);
  const effects = await getResolvedUpgradeEffects(client, business.id, business.type);
  const targetLines = getMaxLines(effects.workerCapacitySlots);

  const { data: existingRows, error: existingError } = await client
    .from("manufacturing_lines")
    .select("*")
    .eq("business_id", business.id)
    .order("line_number", { ascending: true });
  if (existingError) throw existingError;

  const existing = ((existingRows as ManufacturingLine[]) ?? []).map(normalizeManufacturingLine);
  const existingNumbers = new Set(existing.map((row) => row.line_number));

  let legacySeed: Partial<ManufacturingLine> | null = null;
  if (existing.length === 0) {
    const { data: legacyRow, error: legacyError } = await client
      .from("manufacturing_jobs")
      .select("*")
      .eq("business_id", business.id)
      .maybeSingle();
    if (legacyError) throw legacyError;
    if (legacyRow) {
      legacySeed = {
        configured_recipe_key: (legacyRow as { active_recipe_key?: string | null }).active_recipe_key ?? null,
        status: ((legacyRow as { status?: string }).status as ManufacturingLine["status"]) ?? "idle",
        worker_assigned: Boolean((legacyRow as { worker_assigned?: boolean }).worker_assigned),
        output_progress: toNumber((legacyRow as { output_progress?: number | string }).output_progress),
        input_progress: ((legacyRow as { input_progress?: Record<string, number> }).input_progress) ?? {},
        last_tick_at: (legacyRow as { last_tick_at?: string | null }).last_tick_at ?? null,
      };
    }
  }

  const inserts: Array<Record<string, unknown>> = [];
  for (let lineNumber = 1; lineNumber <= targetLines; lineNumber += 1) {
    if (existingNumbers.has(lineNumber)) continue;
    const seed = lineNumber === 1 ? legacySeed : null;
    inserts.push({
      business_id: business.id,
      line_number: lineNumber,
      employee_id: null,
      configured_recipe_key: seed?.configured_recipe_key ?? null,
      pending_recipe_key: null,
      status: seed?.status ?? "idle",
      worker_assigned: seed?.worker_assigned ?? false,
      output_progress: seed?.output_progress ?? 0,
      input_progress: seed?.input_progress ?? {},
      last_tick_at: seed?.last_tick_at ?? null,
      retool_started_at: null,
      retool_complete_at: null,
    });
  }

  if (inserts.length > 0) {
    const { error: insertError } = await client.from("manufacturing_lines").insert(inserts);
    if (insertError) throw insertError;
  }

  await finalizeManufacturingRetools(client, business.id);

  const { data: finalRows, error: finalError } = await client
    .from("manufacturing_lines")
    .select("*")
    .eq("business_id", business.id)
    .order("line_number", { ascending: true });
  if (finalError) throw finalError;

  await syncLegacyManufacturingJobForBusiness(client, business.id);

  return ((finalRows as ManufacturingLine[]) ?? []).map(normalizeManufacturingLine);
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
    .in("extraction_slot_id", slots.map((slot) => slot.id));
  if (toolError) throw toolError;

  const tools = ((toolRows as ToolDurability[]) ?? []).map(normalizeTool);
  const toolBySlot = new Map(tools.map((tool) => [tool.extraction_slot_id, tool]));

  const effects = await getResolvedUpgradeEffects(client, business.id, business.type);
  const maxSlots = getMaxLines(effects.workerCapacitySlots);

  const employees = await getEmployeesByIds(
    client,
    playerId,
    slots.flatMap((slot) => (slot.employee_id ? [slot.employee_id] : []))
  );
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));

  const detailed: ExtractionSlotWithDetails[] = [];
  for (const slot of slots) {
    const employee = slot.employee_id ? employeeById.get(slot.employee_id) ?? null : null;
    const employeeStatus = employee ? getEmployeeStatusFromShift(employee.status, employee.shift_ends_at) : null;
    const configuredItemKey = resolveExtractionConfiguredItem(slot, business.type);
    const tool = toolBySlot.get(slot.id) ?? null;
    const status = resolveDisplayedExtractionStatus(slot, employeeStatus);
    const throughputPerMinute = getExtractionThroughputPerMinute(slot, tool, business.type, status, effects);
    detailed.push({
      ...slot,
      status,
      business_type: business.type,
      employee_status: employeeStatus,
      tool,
      configured_output: getExtractionProductOption(business.type, configuredItemKey),
      pending_output: slot.pending_item_key ? getExtractionProductOption(business.type, slot.pending_item_key) : null,
      line_label: EXTRACTION_LINE_LABEL_BY_BUSINESS[business.type],
      throughput_per_minute: throughputPerMinute,
      is_degraded: status === "active" && throughputPerMinute > 0 && !hasOperationalExtractionTool(slot, tool, business.type),
    });
  }

  return {
    businessId: business.id,
    businessType: business.type,
    maxSlots,
    slots: detailed,
    summary: {
      total: detailed.length,
      active: detailed.filter((slot) => slot.status === "active").length,
      idle: detailed.filter((slot) => slot.status === "idle").length,
      resting: detailed.filter((slot) => slot.status === "resting").length,
      toolBroken: detailed.filter((slot) => slot.status === "tool_broken").length,
      retooling: detailed.filter((slot) => slot.status === "retooling").length,
      occupied: detailed.filter((slot) => Boolean(slot.employee_id)).length,
    },
  };
}

export async function assignExtractionSlot(
  client: QueryClient,
  playerId: string,
  input: AssignExtractionSlotInput
): Promise<ExtractionSlot> {
  const { data, error } = await client
    .rpc("assign_extraction_slot_worker_atomic", {
      p_player_id: playerId,
      p_slot_id: input.slotId,
      p_employee_id: input.employeeId,
    });

  if (error) throw error;
  if (!data) throw new Error("Extraction slot assignment did not return a slot.");
  return normalizeSlot(data as ExtractionSlot);
}

export async function unassignExtractionSlot(
  client: QueryClient,
  playerId: string,
  input: UnassignExtractionSlotInput
): Promise<ExtractionSlot> {
  const { data, error } = await client
    .rpc("unassign_extraction_slot_worker_atomic", {
      p_player_id: playerId,
      p_slot_id: input.slotId,
    });

  if (error) throw error;
  if (!data) throw new Error("Extraction slot unassignment did not return a slot.");
  return normalizeSlot(data as ExtractionSlot);
}

export async function installToolForSlot(
  client: QueryClient,
  playerId: string,
  input: InstallToolInput
): Promise<{ slot: ExtractionSlot; tool: ToolDurability }> {
  const slot = await getSlotByIdForPlayer(client, playerId, input.slotId);
  const business = await ensureOwnedExtractionBusiness(client, playerId, slot.business_id);

  const requiredTool = EXTRACTION_REQUIRED_TOOL_BY_BUSINESS[business.type] ?? null;
  if (requiredTool && requiredTool !== input.itemType) {
    throw new Error(`Business type '${business.type}' requires tool '${requiredTool}'.`);
  }

  const effects = await getResolvedUpgradeEffects(client, business.id, business.type);
  const uses = Math.max(1, Math.round(TOOL_BASE_DURABILITY[input.itemType] * effects.toolDurabilityMultiplier));

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
      status:
        slot.status === "retooling"
          ? "retooling"
          : slot.employee_id
            ? resolveExtractionStatus({ ...slot, tool_item_key: input.itemType }, business.type)
            : "idle",
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
  if (slot.status === "retooling" || input.status === "retooling") {
    throw new Error("Retooling status is managed automatically.");
  }
  if (input.status === "active" && !slot.employee_id) {
    throw new Error("Cannot activate a slot without an assigned employee.");
  }
  if (input.status === "active" && slot.employee_id) {
    const employee = await getEmployeeById(client, playerId, slot.employee_id);
    if (!employee || getEmployeeStatusFromShift(employee.status, employee.shift_ends_at) !== "assigned") {
      throw new Error("Assigned worker is not currently operational.");
    }

    const { data: toolRow, error: toolError } = await client
      .from("tool_durability")
      .select("*")
      .eq("extraction_slot_id", slot.id)
      .maybeSingle();
    if (toolError) throw toolError;

    const tool = toolRow ? normalizeTool(toolRow as ToolDurability) : null;
    const effects = await getResolvedUpgradeEffects(client, slot.business_id, slot.business_type);
    const throughput = getExtractionThroughputPerMinute(slot, tool, slot.business_type, "active", effects);
    if (throughput <= 0) {
      throw new Error("Install a working required tool before activating this slot.");
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

export async function retoolExtractionSlot(
  client: QueryClient,
  playerId: string,
  input: RetoolExtractionSlotInput
): Promise<ExtractionSlot> {
  const slot = await getSlotByIdForPlayer(client, playerId, input.slotId);
  const business = await ensureOwnedExtractionBusiness(client, playerId, slot.business_id);
  const option = getExtractionProductOption(business.type, input.itemKey);
  if (!option) {
    throw new Error("This business cannot be retooled for that output.");
  }

  const currentItemKey = resolveExtractionConfiguredItem(slot, business.type);
  if (currentItemKey === input.itemKey) {
    throw new Error("This line is already tooled for that output.");
  }
  if (slot.pending_item_key === input.itemKey) {
    throw new Error("This line is already being retooled for that output.");
  }

  const retoolCost = EXTRACTION_PRODUCT_OPTIONS_BY_BUSINESS[business.type].length > 1
    ? EXTRACTION_RETOOL_COST_BY_BUSINESS[business.type]
    : 0;

  if (retoolCost > 0) {
    const balance = await getBusinessBalance(client, playerId, business.id);
    if (balance < retoolCost) {
      throw new Error(`Insufficient business funds. Retooling costs $${retoolCost.toFixed(2)}.`);
    }
    await addBusinessAccountEntry(client, playerId, business.id, {
      amount: retoolCost,
      entryType: "debit",
      category: "upgrade_purchase",
      description: `Line retool funded: ${option.displayName}`,
      referenceId: slot.id,
    });
  }

  const { data, error } = await client
    .from("extraction_slots")
    .update({
      pending_item_key: input.itemKey,
      retool_started_at: new Date().toISOString(),
      retool_complete_at: plusMinutes(PRODUCTION_RETOOL_DURATION_MINUTES),
      status: "retooling",
      input_progress: 0,
      output_progress: 0,
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
  const lines = await ensureManufacturingLines(client, playerId, business.id);
  const effects = await getResolvedUpgradeEffects(client, business.id, business.type);
  const maxLines = getMaxLines(effects.workerCapacitySlots);
  const recipes = getManufacturingRecipesForBusinessType(business.type);

  const employees = await getEmployeesByIds(
    client,
    playerId,
    lines.flatMap((line) => (line.employee_id ? [line.employee_id] : []))
  );
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));

  const detailed: ManufacturingLineWithDetails[] = lines.map((line) => {
    const employee = line.employee_id ? employeeById.get(line.employee_id) ?? null : null;
    const employeeStatus = employee ? getEmployeeStatusFromShift(employee.status, employee.shift_ends_at) : null;
    const status = resolveDisplayedManufacturingStatus(line, employeeStatus);
    const configuredRecipe = line.configured_recipe_key ? getManufacturingRecipeByKey(line.configured_recipe_key) : null;

    return {
      ...line,
      status,
      worker_assigned: employeeStatus === "assigned",
      business_type: business.type,
      employee_status: employeeStatus,
      available_recipes: recipes,
      configured_recipe: configuredRecipe,
      pending_recipe: line.pending_recipe_key ? getManufacturingRecipeByKey(line.pending_recipe_key) : null,
      output_per_minute: getManufacturingOutputPerMinute(status, configuredRecipe, effects),
      input_requirements_per_minute: getManufacturingInputRequirementsPerMinute(status, configuredRecipe, effects),
    };
  });

  return {
    businessId: business.id,
    businessType: business.type,
    maxLines,
    lines: detailed,
    summary: {
      total: detailed.length,
      active: detailed.filter((line) => line.status === "active").length,
      idle: detailed.filter((line) => line.status === "idle").length,
      resting: detailed.filter((line) => line.status === "resting").length,
      retooling: detailed.filter((line) => line.status === "retooling").length,
      occupied: detailed.filter((line) => Boolean(line.employee_id)).length,
    },
  };
}

export async function assignManufacturingLine(
  client: QueryClient,
  playerId: string,
  input: AssignManufacturingLineInput
): Promise<ManufacturingLineWithDetails> {
  const { data, error } = await client
    .rpc("assign_manufacturing_line_worker_atomic", {
      p_player_id: playerId,
      p_line_id: input.lineId,
      p_employee_id: input.employeeId,
    });

  if (error) throw error;
  if (!data) throw new Error("Manufacturing line assignment did not return a line.");
  const normalized = normalizeManufacturingLine(data as ManufacturingLine);
  await syncLegacyManufacturingJobForBusiness(client, normalized.business_id);
  return getHydratedManufacturingLine(client, playerId, normalized.business_id, normalized.id);
}

export async function unassignManufacturingLine(
  client: QueryClient,
  playerId: string,
  input: UnassignManufacturingLineInput
): Promise<ManufacturingLineWithDetails> {
  const { data, error } = await client
    .rpc("unassign_manufacturing_line_worker_atomic", {
      p_player_id: playerId,
      p_line_id: input.lineId,
    });

  if (error) throw error;
  if (!data) throw new Error("Manufacturing line unassignment did not return a line.");
  const normalized = normalizeManufacturingLine(data as ManufacturingLine);
  await syncLegacyManufacturingJobForBusiness(client, normalized.business_id);
  return getHydratedManufacturingLine(client, playerId, normalized.business_id, normalized.id);
}

export async function setManufacturingRecipe(
  client: QueryClient,
  playerId: string,
  input: SetManufacturingRecipeInput
): Promise<ManufacturingStatusView> {
  const line = await getManufacturingLineByIdForPlayer(client, playerId, input.lineId);
  await retoolManufacturingLine(client, playerId, { lineId: line.id, recipeKey: input.recipeKey });
  return getManufacturingStatus(client, playerId, line.business_id);
}

export async function retoolManufacturingLine(
  client: QueryClient,
  playerId: string,
  input: RetoolManufacturingLineInput
): Promise<ManufacturingLineWithDetails> {
  const line = await getManufacturingLineByIdForPlayer(client, playerId, input.lineId);
  const recipe = getManufacturingRecipeByKey(input.recipeKey);
  if (!recipe || recipe.businessType !== line.business_type) {
    throw new Error("Recipe is not valid for this business.");
  }
  if (line.configured_recipe_key === recipe.key) {
    throw new Error("This line is already tooled for that recipe.");
  }
  if (line.pending_recipe_key === recipe.key) {
    throw new Error("This line is already retooling for that recipe.");
  }

  const retoolCost = MANUFACTURING_RETOOL_COST_BY_BUSINESS[line.business_type];
  const balance = await getBusinessBalance(client, playerId, line.business_id);
  if (balance < retoolCost) {
    throw new Error(`Insufficient business funds. Retooling costs $${retoolCost.toFixed(2)}.`);
  }

  await addBusinessAccountEntry(client, playerId, line.business_id, {
    amount: retoolCost,
    entryType: "debit",
    category: "upgrade_purchase",
    description: `Line retool funded: ${recipe.displayName}`,
    referenceId: line.id,
  });

  const { data, error } = await client
    .from("manufacturing_lines")
    .update({
      pending_recipe_key: recipe.key,
      retool_started_at: new Date().toISOString(),
      retool_complete_at: plusMinutes(PRODUCTION_RETOOL_DURATION_MINUTES),
      status: "retooling",
      output_progress: 0,
      input_progress: {},
      updated_at: new Date().toISOString(),
    })
    .eq("id", line.id)
    .select("*")
    .single();
  if (error) throw error;
  await syncLegacyManufacturingJobForBusiness(client, line.business_id);
  const normalized = normalizeManufacturingLine(data as ManufacturingLine);
  return getHydratedManufacturingLine(client, playerId, line.business_id, normalized.id);
}

export async function startManufacturing(
  client: QueryClient,
  playerId: string,
  input: StartManufacturingInput
): Promise<ManufacturingStatusView> {
  const line = await getManufacturingLineByIdForPlayer(client, playerId, input.lineId);
  if (line.status === "retooling") {
    throw new Error("This line is still retooling.");
  }
  if (!line.configured_recipe_key) {
    throw new Error("Retool this line before starting production.");
  }
  if (!line.employee_id) {
    throw new Error("Assign a production worker to this line before starting.");
  }

  const employee = await getEmployeeById(client, playerId, line.employee_id);
  if (!employee || getEmployeeStatusFromShift(employee.status, employee.shift_ends_at) !== "assigned") {
    throw new Error("Assigned worker is not currently operational.");
  }

  const { error } = await client
    .from("manufacturing_lines")
    .update({
      status: "active",
      worker_assigned: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", line.id);
  if (error) throw error;
  await syncLegacyManufacturingJobForBusiness(client, line.business_id);
  return getManufacturingStatus(client, playerId, line.business_id);
}

export async function stopManufacturing(
  client: QueryClient,
  playerId: string,
  input: StopManufacturingInput
): Promise<ManufacturingStatusView> {
  const line = await getManufacturingLineByIdForPlayer(client, playerId, input.lineId);
  const { error } = await client
    .from("manufacturing_lines")
    .update({
      status: line.status === "retooling" ? "retooling" : "idle",
      worker_assigned: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", line.id);
  if (error) throw error;
  await syncLegacyManufacturingJobForBusiness(client, line.business_id);
  return getManufacturingStatus(client, playerId, line.business_id);
}

export async function setManufacturingLineStatus(
  client: QueryClient,
  playerId: string,
  input: SetManufacturingLineStatusInput
): Promise<ManufacturingLineWithDetails> {
  const line = await getManufacturingLineByIdForPlayer(client, playerId, input.lineId);
  if (line.status === "retooling") {
    throw new Error("This line is still retooling.");
  }
  if (input.status === "active") {
    if (!line.employee_id) throw new Error("Assign a worker before starting this line.");
    if (!line.configured_recipe_key) throw new Error("Retool this line before starting production.");
    const employee = await getEmployeeById(client, playerId, line.employee_id);
    if (!employee || getEmployeeStatusFromShift(employee.status, employee.shift_ends_at) !== "assigned") {
      throw new Error("Assigned worker is not currently operational.");
    }
  }

  const { data, error } = await client
    .from("manufacturing_lines")
    .update({
      status: input.status,
      worker_assigned: input.status === "active" ? true : Boolean(line.employee_id),
      updated_at: new Date().toISOString(),
    })
    .eq("id", line.id)
    .select("*")
    .single();
  if (error) throw error;
  await syncLegacyManufacturingJobForBusiness(client, line.business_id);
  const normalized = normalizeManufacturingLine(data as ManufacturingLine);
  return getHydratedManufacturingLine(client, playerId, line.business_id, normalized.id);
}
