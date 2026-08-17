import {
  SHIFT_LIMIT_HOURS,
  type EmployeeStatus,
} from "@/config/employees";
import type { BusinessType } from "@/config/businesses";
import {
  EXTRACTION_MISSING_TOOL_OUTPUT_MULTIPLIER_BY_BUSINESS,
  EXTRACTION_REQUIRED_TOOL_BY_BUSINESS,
  isExtractionBusinessType,
  isManufacturingBusinessType,
  type ExtractionBusinessType,
} from "@/config/production";
import { syncManufacturingWorkerAssigned } from "@/domains/_shared/manufacturing-workers";
import { getWorkerEffectiveStatus } from "./worker-state";
import type { QueryClient } from "@/lib/db/query-client";
import { toNumber } from "@/lib/core/number";
import type {
  AssignEmployeeInput,
  Employee,
  EmployeeAssignment,
  EmployeeListFilter,
  EmployeeSkill,
  EmployeeSummary,
  EmployeeWithDetails,
  FireEmployeeInput,
  HireEmployeeInput,
  ReactivateEmployeeInput,
  SettleEmployeeWagesInput,
  UnassignEmployeeInput,
} from "./types";

function normalizeEmployee(row: Employee): Employee {
  return {
    ...row,
    hire_cost: toNumber(row.hire_cost),
    wage_per_hour: toNumber(row.wage_per_hour),
    unpaid_wage_due: toNumber(row.unpaid_wage_due),
  };
}

function normalizeAssignment(row: EmployeeAssignment): EmployeeAssignment {
  return {
    ...row,
    slot_number: row.slot_number === null ? null : Number(row.slot_number),
    wage_per_hour: toNumber(row.wage_per_hour),
  };
}

function normalizeSkill(row: EmployeeSkill): EmployeeSkill {
  return {
    ...row,
    level: Number(row.level),
    xp: Number(row.xp),
  };
}

function addHoursToNow(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

type BusinessTypeRow = {
  id: string;
  type: BusinessType;
};

type OpenExtractionSlotRow = {
  id: string;
  slot_number: number | string;
  tool_item_key: string | null;
  pending_item_key: string | null;
  retool_complete_at: string | null;
};

type OpenManufacturingLineRow = {
  id: string;
  line_number: number | string;
  configured_recipe_key: string | null;
};

function getRestoredExtractionStatus(
  slot: OpenExtractionSlotRow,
  businessType: ExtractionBusinessType
): "active" | "idle" | "retooling" {
  if (slot.retool_complete_at || slot.pending_item_key) return "retooling";

  const requiredTool = EXTRACTION_REQUIRED_TOOL_BY_BUSINESS[businessType] ?? null;
  const supportsMissingToolOutput =
    EXTRACTION_MISSING_TOOL_OUTPUT_MULTIPLIER_BY_BUSINESS[businessType] !== undefined;

  if (!requiredTool || slot.tool_item_key === requiredTool || supportsMissingToolOutput) {
    return "active";
  }

  return "idle";
}

async function restoreSettledEmployeeToOpenSpot(
  client: QueryClient,
  employee: Employee
): Promise<EmployeeAssignment | null> {
  if (!employee.employer_business_id) return null;

  const existingAssignment = await getEmployeeAssignment(client, employee.player_id, employee.id).catch(() => null);
  if (existingAssignment) return existingAssignment;

  const { data: businessRow, error: businessError } = await client
    .from("businesses")
    .select("id, type")
    .eq("id", employee.employer_business_id)
    .eq("player_id", employee.player_id)
    .maybeSingle();

  if (businessError) throw businessError;
  const business = businessRow as BusinessTypeRow | null;
  if (!business) throw new Error("Business not found.");

  const now = new Date().toISOString();

  if (isExtractionBusinessType(business.type)) {
    const businessType = business.type as ExtractionBusinessType;
    const { data: slotRows, error: slotError } = await client
      .from("extraction_slots")
      .select("id, slot_number, tool_item_key, pending_item_key, retool_complete_at")
      .eq("business_id", business.id)
      .is("employee_id", null)
      .neq("status", "retooling")
      .order("slot_number", { ascending: true })
      .limit(1);

    if (slotError) throw slotError;
    const slot = ((slotRows as OpenExtractionSlotRow[] | null) ?? [])[0] ?? null;
    if (!slot) return null;

    const { data: assignmentRow, error: assignmentError } = await client
      .from("employee_assignments")
      .insert({
        employee_id: employee.id,
        business_id: business.id,
        role: "production",
        slot_number: Number(slot.slot_number),
        wage_per_hour: employee.wage_per_hour,
      })
      .select("*")
      .single();

    if (assignmentError) throw assignmentError;

    const { data: updatedSlot, error: slotUpdateError } = await client
      .from("extraction_slots")
      .update({
        employee_id: employee.id,
        status: getRestoredExtractionStatus(slot, businessType),
        updated_at: now,
      })
      .eq("id", slot.id)
      .is("employee_id", null)
      .select("id")
      .maybeSingle();

    if (slotUpdateError) throw slotUpdateError;
    if (!updatedSlot) {
      await client.from("employee_assignments").delete().eq("id", (assignmentRow as EmployeeAssignment).id);
      return null;
    }

    return normalizeAssignment(assignmentRow as EmployeeAssignment);
  }

  if (isManufacturingBusinessType(business.type)) {
    const { data: previousLineRows, error: previousLineError } = await client
      .from("manufacturing_lines")
      .select("id, line_number, configured_recipe_key")
      .eq("business_id", business.id)
      .eq("employee_id", employee.id)
      .neq("status", "retooling")
      .order("line_number", { ascending: true })
      .limit(1);

    if (previousLineError) throw previousLineError;

    const previousLine = ((previousLineRows as OpenManufacturingLineRow[] | null) ?? [])[0] ?? null;
    const { data: lineRows, error: lineError } = previousLine
      ? { data: null, error: null }
      : await client
          .from("manufacturing_lines")
          .select("id, line_number, configured_recipe_key")
          .eq("business_id", business.id)
          .is("employee_id", null)
          .neq("status", "retooling")
          .order("line_number", { ascending: true });

    if (lineError) throw lineError;
    const lines = (lineRows as OpenManufacturingLineRow[] | null) ?? [];
    const line = previousLine ?? lines.find((entry) => entry.configured_recipe_key) ?? lines[0] ?? null;
    if (!line) return null;

    const { data: assignmentRow, error: assignmentError } = await client
      .from("employee_assignments")
      .insert({
        employee_id: employee.id,
        business_id: business.id,
        role: "production",
        slot_number: Number(line.line_number),
        wage_per_hour: employee.wage_per_hour,
      })
      .select("*")
      .single();

    if (assignmentError) throw assignmentError;

    const { data: updatedLine, error: lineUpdateError } = await client
      .from("manufacturing_lines")
      .update({
        employee_id: employee.id,
        worker_assigned: true,
        status: line.configured_recipe_key ? "active" : "idle",
        updated_at: now,
      })
      .eq("id", line.id)
      .or(`employee_id.is.null,employee_id.eq.${employee.id}`)
      .select("id")
      .maybeSingle();

    if (lineUpdateError) throw lineUpdateError;
    if (!updatedLine) {
      await client.from("employee_assignments").delete().eq("id", (assignmentRow as EmployeeAssignment).id);
      return null;
    }

    return normalizeAssignment(assignmentRow as EmployeeAssignment);
  }

  return null;
}

// Bounded default so one player's full employee roster (including every
// fired/historical hire) can't become an unbounded result set. Resolves
// audit finding M1.
const EMPLOYEES_DEFAULT_LIMIT = 500;

export async function getPlayerEmployees(
  client: QueryClient,
  playerId: string,
  filters?: EmployeeListFilter
): Promise<Employee[]> {
  let query = client
    .from("employees")
    .select("*")
    .eq("player_id", playerId)
    .order("created_at", { ascending: false })
    .limit(filters?.limit ?? EMPLOYEES_DEFAULT_LIMIT);

  if (filters?.status) {
    query = query.eq("status", filters.status);
  }

  if (filters?.employeeType) {
    query = query.eq("employee_type", filters.employeeType);
  }

  if (filters?.businessId) {
    query = query.eq("employer_business_id", filters.businessId);
  }

  const { data, error } = await query;
  if (error) throw error;

  return ((data as Employee[]) ?? []).map(normalizeEmployee);
}

export async function getEmployeeById(
  client: QueryClient,
  playerId: string,
  employeeId: string
): Promise<Employee | null> {
  const { data, error } = await client
    .from("employees")
    .select("*")
    .eq("id", employeeId)
    .eq("player_id", playerId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return normalizeEmployee(data as Employee);
}

export async function getEmployeesByIds(
  client: QueryClient,
  playerId: string,
  employeeIds: string[]
): Promise<Employee[]> {
  const uniqueIds = Array.from(new Set(employeeIds));
  if (uniqueIds.length === 0) return [];

  const { data, error } = await client
    .from("employees")
    .select("*")
    .eq("player_id", playerId)
    .in("id", uniqueIds);

  if (error) throw error;
  return ((data as Employee[]) ?? []).map(normalizeEmployee);
}

export async function getEmployeeAssignment(
  client: QueryClient,
  playerId: string,
  employeeId: string
): Promise<EmployeeAssignment | null> {
  const employee = await getEmployeeById(client, playerId, employeeId);
  if (!employee) throw new Error("Employee not found.");

  return getEmployeeAssignmentById(client, employeeId);
}

// Skips the ownership-verifying employees select -- for callers that already
// hold a verified Employee row (e.g. getEmployeeWithDetails below). Resolves
// audit finding L1 (Documents/SBAudit.md).
export async function getEmployeeAssignmentById(
  client: QueryClient,
  employeeId: string
): Promise<EmployeeAssignment | null> {
  const { data, error } = await client
    .from("employee_assignments")
    .select("*")
    .eq("employee_id", employeeId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return normalizeAssignment(data as EmployeeAssignment);
}

export async function getEmployeeSkills(
  client: QueryClient,
  playerId: string,
  employeeId: string
): Promise<EmployeeSkill[]> {
  const employee = await getEmployeeById(client, playerId, employeeId);
  if (!employee) throw new Error("Employee not found.");

  return getEmployeeSkillsById(client, employeeId);
}

// Skips the ownership-verifying employees select -- see getEmployeeAssignmentById.
export async function getEmployeeSkillsById(
  client: QueryClient,
  employeeId: string
): Promise<EmployeeSkill[]> {
  const { data, error } = await client
    .from("employee_skills")
    .select("*")
    .eq("employee_id", employeeId)
    .order("skill_key", { ascending: true });

  if (error) throw error;
  return ((data as EmployeeSkill[]) ?? []).map(normalizeSkill);
}

export async function getEmployeeWithDetails(
  client: QueryClient,
  playerId: string,
  employeeId: string
): Promise<EmployeeWithDetails | null> {
  const employee = await getEmployeeById(client, playerId, employeeId);
  if (!employee) return null;

  const [assignment, skills] = await Promise.all([
    getEmployeeAssignmentById(client, employeeId),
    getEmployeeSkillsById(client, employeeId),
  ]);

  return {
    ...employee,
    assignment,
    skills,
  };
}

export async function hireEmployee(
  client: QueryClient,
  playerId: string,
  input: HireEmployeeInput
): Promise<EmployeeWithDetails> {
  const { data, error } = await client.rpc("hire_employee_atomic", {
    p_player_id: playerId,
    p_business_id: input.businessId,
    p_first_name: input.firstName,
    p_last_name: input.lastName,
    p_employee_type: input.employeeType,
    p_specialty_skill_key: input.specialtySkillKey ?? null,
  });

  if (error) throw error;
  const result = data as { employee?: Employee; skills?: EmployeeSkill[] } | null;
  if (!result?.employee) {
    throw new Error("Employee hire did not return an employee.");
  }

  return {
    ...normalizeEmployee(result.employee),
    assignment: null,
    skills: (result.skills ?? []).map(normalizeSkill),
  };
}

export async function assignEmployee(
  client: QueryClient,
  playerId: string,
  input: AssignEmployeeInput
): Promise<EmployeeWithDetails> {
  const { data, error } = await client.rpc("assign_employee_atomic", {
    p_player_id: playerId,
    p_employee_id: input.employeeId,
    p_business_id: input.businessId,
    p_role: input.role,
    p_slot_number: input.slotNumber ?? null,
    p_wage_variance: input.wageVariance ?? 0,
    p_role_skill_key: input.roleSkillKey ?? "logistics",
  });

  if (error) throw error;
  const result = data as { employee?: Employee; assignment?: EmployeeAssignment } | null;
  if (!result?.employee || !result.assignment) {
    throw new Error("Employee assignment did not return an employee and assignment.");
  }

  await syncManufacturingWorkerAssigned(client, input.businessId);
  const skills = await getEmployeeSkills(client, playerId, input.employeeId);

  return {
    ...normalizeEmployee(result.employee),
    assignment: normalizeAssignment(result.assignment),
    skills,
  };
}

export async function reactivateEmployee(
  client: QueryClient,
  playerId: string,
  input: ReactivateEmployeeInput
): Promise<EmployeeWithDetails> {
  const employee = await getEmployeeById(client, playerId, input.employeeId);
  if (!employee) throw new Error("Employee not found.");
  if (employee.status === "fired") throw new Error("Cannot reactivate a fired employee.");
  if (employee.status === "unpaid") {
    throw new Error("Cannot reactivate an unpaid employee until wages are settled.");
  }

  const assignment = await getEmployeeAssignment(client, playerId, employee.id);
  if (!assignment) throw new Error("Employee must be assigned before re-activation.");

  const shiftHours = SHIFT_LIMIT_HOURS[employee.employee_type];

  const { data, error } = await client
    .from("employees")
    .update({
      status: "assigned",
      shift_ends_at: addHoursToNow(shiftHours),
      updated_at: new Date().toISOString(),
    })
    .eq("id", employee.id)
    .eq("player_id", playerId)
    .select("*")
    .single();

  if (error) throw error;

  await syncManufacturingWorkerAssigned(client, assignment.business_id);

  const skills = await getEmployeeSkills(client, playerId, employee.id);

  return {
    ...normalizeEmployee(data as Employee),
    assignment,
    skills,
  };
}

export async function unassignEmployee(
  client: QueryClient,
  playerId: string,
  input: UnassignEmployeeInput
): Promise<EmployeeWithDetails> {
  const { data, error } = await client.rpc("unassign_employee_atomic", {
    p_player_id: playerId,
    p_employee_id: input.employeeId,
  });

  if (error) throw error;
  const result = data as { employee?: Employee; assigned_business_id?: string | null } | null;
  if (!result?.employee) {
    throw new Error("Employee unassignment did not return an employee.");
  }

  if (result.assigned_business_id) {
    await syncManufacturingWorkerAssigned(client, result.assigned_business_id);
  }

  const skills = await getEmployeeSkills(client, playerId, input.employeeId);

  return {
    ...normalizeEmployee(result.employee),
    assignment: null,
    skills,
  };
}

export async function fireEmployee(
  client: QueryClient,
  playerId: string,
  input: FireEmployeeInput
): Promise<EmployeeWithDetails> {
  const { data, error } = await client.rpc("fire_employee_atomic", {
    p_player_id: playerId,
    p_employee_id: input.employeeId,
  });

  if (error) throw error;
  const result = data as { employee?: Employee; assigned_business_id?: string | null } | null;
  if (!result?.employee) {
    throw new Error("Employee firing did not return an employee.");
  }

  if (result.assigned_business_id) {
    await syncManufacturingWorkerAssigned(client, result.assigned_business_id);
  }

  return {
    ...normalizeEmployee(result.employee),
    status: "fired",
    shift_ends_at: null,
    assignment: null,
    skills: [],
  };
}

export async function settleEmployeeWages(
  client: QueryClient,
  playerId: string,
  input: SettleEmployeeWagesInput
): Promise<EmployeeWithDetails> {
  // The wage debit and the unpaid_wage_due clear now happen atomically in one
  // RPC (see 20260815020000_074_settle_employee_wages_atomic.sql), so a
  // failure in the best-effort restore step below can never leave a debit
  // posted with the debt still marked unpaid (the previous three-call,
  // non-transactional version could double-charge on retry).
  const { data, error } = await client.rpc("settle_employee_wages_atomic", {
    p_player_id: playerId,
    p_employee_id: input.employeeId,
  });

  if (error) throw error;
  const result = data as { employee?: Employee } | null;
  if (!result?.employee) {
    throw new Error("Wage settlement did not return an employee.");
  }

  let employee = normalizeEmployee(result.employee);
  let restoredAssignment: EmployeeAssignment | null = null;

  try {
    restoredAssignment = await restoreSettledEmployeeToOpenSpot(client, employee);
  } catch {
    restoredAssignment = null;
  }

  if (restoredAssignment) {
    const nowIso = new Date().toISOString();
    const { data: updatedRow, error: updateError } = await client
      .from("employees")
      .update({
        status: "assigned",
        shift_ends_at: addHoursToNow(SHIFT_LIMIT_HOURS[employee.employee_type]),
        updated_at: nowIso,
      })
      .eq("id", employee.id)
      .eq("player_id", playerId)
      .select("*")
      .single();

    if (!updateError && updatedRow) {
      employee = normalizeEmployee(updatedRow as Employee);
      await syncManufacturingWorkerAssigned(client, restoredAssignment.business_id);
    }
  }

  const [skills, assignment] = await Promise.all([
    getEmployeeSkills(client, playerId, employee.id),
    restoredAssignment
      ? Promise.resolve(restoredAssignment)
      : getEmployeeAssignment(client, playerId, employee.id).catch(() => null),
  ]);

  return {
    ...employee,
    assignment,
    skills,
  };
}

export function getEmployeeStatusFromShift(
  status: EmployeeStatus,
  shiftEndsAt: string | null
): EmployeeStatus {
  return getWorkerEffectiveStatus(status, shiftEndsAt);
}

export async function getEmployeeSummary(
  client: QueryClient,
  playerId: string
): Promise<EmployeeSummary> {
  const employees = await getPlayerEmployees(client, playerId);

  const byStatus: Record<EmployeeStatus, number> = {
    available: 0,
    assigned: 0,
    resting: 0,
    unpaid: 0,
    fired: 0,
  };

  for (const employee of employees) {
    const effectiveStatus = getEmployeeStatusFromShift(employee.status, employee.shift_ends_at);
    byStatus[effectiveStatus] += 1;
  }

  return {
    totalEmployees: employees.length,
    byStatus,
    assignedCount: byStatus.assigned,
    availableCount: byStatus.available,
    restingCount: byStatus.resting,
    unpaidCount: byStatus.unpaid,
    firedCount: byStatus.fired,
  };
}
