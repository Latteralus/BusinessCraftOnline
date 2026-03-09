import {
  BASE_WAGE_PER_HOUR,
  calculateHourlyWage,
  HIRE_COSTS,
  EMPLOYEE_SKILL_KEYS,
  SHIFT_LIMIT_HOURS,
  STARTING_SKILL_LEVEL_BY_TYPE,
  type EmployeeSkillKey,
  type EmployeeStatus,
  type EmployeeType,
} from "@/config/employees";
import { addBusinessAccountEntry, getBusinessBalance } from "@/domains/businesses";
import { syncManufacturingWorkerAssigned } from "@/domains/_shared/manufacturing-workers";
import { ensureOwnedBusiness } from "@/domains/_shared/ownership";
import { getWorkerEffectiveStatus } from "./worker-state";
import type { QueryClient } from "@/lib/db/query-client";
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

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

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

async function ensureBusinessBelongsToPlayer(
  client: QueryClient,
  playerId: string,
  businessId: string
): Promise<void> {
  await ensureOwnedBusiness(client, playerId, businessId);
}

async function clearEmployeeExtractionSlots(client: QueryClient, employeeId: string): Promise<void> {
  const { error } = await client
    .from("extraction_slots")
    .update({
      employee_id: null,
      status: "idle",
      updated_at: new Date().toISOString(),
    })
    .eq("employee_id", employeeId);

  if (error) throw error;

  const { error: manufacturingError } = await client
    .from("manufacturing_lines")
    .update({
      employee_id: null,
      worker_assigned: false,
      status: "idle",
      updated_at: new Date().toISOString(),
    })
    .eq("employee_id", employeeId);

  if (manufacturingError) throw manufacturingError;
}

export async function getPlayerEmployees(
  client: QueryClient,
  playerId: string,
  filters?: EmployeeListFilter
): Promise<Employee[]> {
  let query = client
    .from("employees")
    .select("*")
    .eq("player_id", playerId)
    .order("created_at", { ascending: false });

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

export async function getEmployeeAssignment(
  client: QueryClient,
  playerId: string,
  employeeId: string
): Promise<EmployeeAssignment | null> {
  const employee = await getEmployeeById(client, playerId, employeeId);
  if (!employee) throw new Error("Employee not found.");

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
    getEmployeeAssignment(client, playerId, employeeId),
    getEmployeeSkills(client, playerId, employeeId),
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
  const employeeType: EmployeeType = input.employeeType;
  const hireCost = HIRE_COSTS[employeeType];

  const { data, error } = await client
    .from("employees")
    .insert({
      player_id: playerId,
      employer_business_id: input.businessId,
      first_name: input.firstName,
      last_name: input.lastName,
      employee_type: employeeType,
      status: "available",
      specialty_skill_key: input.specialtySkillKey ?? null,
      hire_cost: hireCost,
      wage_per_hour: BASE_WAGE_PER_HOUR[employeeType],
      last_wage_charged_at: null,
      shift_ends_at: null,
    })
    .select("*")
    .single();

  if (error) throw error;
  const employee = normalizeEmployee(data as Employee);

  const baseLevel = STARTING_SKILL_LEVEL_BY_TYPE[employeeType];
  const specialistSkill = input.specialtySkillKey ?? "logistics";

  const skillRows = EMPLOYEE_SKILL_KEYS.map((skillKey) => ({
    employee_id: employee.id,
    skill_key: skillKey,
    level: skillKey === specialistSkill ? baseLevel : Math.max(1, baseLevel - 4),
    xp: 0,
  }));

  const { data: insertedSkills, error: skillsError } = await client
    .from("employee_skills")
    .insert(skillRows)
    .select("*");

  if (skillsError) throw skillsError;

  return {
    ...employee,
    assignment: null,
    skills: ((insertedSkills as EmployeeSkill[]) ?? []).map(normalizeSkill),
  };
}

export async function assignEmployee(
  client: QueryClient,
  playerId: string,
  input: AssignEmployeeInput
): Promise<EmployeeWithDetails> {
  const employee = await getEmployeeById(client, playerId, input.employeeId);
  if (!employee) throw new Error("Employee not found.");
  if (employee.status === "fired") throw new Error("Cannot assign a fired employee.");
  if (employee.status === "unpaid") {
    throw new Error("Cannot assign an unpaid employee until wages are settled.");
  }
  if (employee.employer_business_id && employee.employer_business_id !== input.businessId) {
    throw new Error("Employee belongs to a different business and cannot be reassigned.");
  }

  await ensureBusinessBelongsToPlayer(client, playerId, input.businessId);

  const existingAssignment = await getEmployeeAssignment(client, playerId, employee.id);
  if (existingAssignment) {
    throw new Error("Employee is already assigned.");
  }

  const skills = await getEmployeeSkills(client, playerId, employee.id);
  const relevantSkillKey: EmployeeSkillKey = input.roleSkillKey ?? "logistics";
  const roleSkillLevel = skills.find((skill) => skill.skill_key === relevantSkillKey)?.level ?? 1;

  const wagePerHour = calculateHourlyWage(
    employee.employee_type,
    roleSkillLevel,
    input.wageVariance ?? 0
  );

  const { data: assignmentRow, error: assignmentError } = await client
    .from("employee_assignments")
    .insert({
      employee_id: employee.id,
      business_id: input.businessId,
      role: input.role,
      slot_number: input.slotNumber ?? null,
      wage_per_hour: wagePerHour,
    })
    .select("*")
    .single();

  if (assignmentError) throw assignmentError;

  const shiftHours = SHIFT_LIMIT_HOURS[employee.employee_type];
  const nextShiftEndsAt = addHoursToNow(shiftHours);

  const { data: updatedEmployeeRow, error: updateEmployeeError } = await client
    .from("employees")
    .update({
      employer_business_id: input.businessId,
      wage_per_hour: wagePerHour,
      status: "assigned",
      shift_ends_at: nextShiftEndsAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", employee.id)
    .eq("player_id", playerId)
    .select("*")
    .single();

  if (updateEmployeeError) throw updateEmployeeError;

  await syncManufacturingWorkerAssigned(client, input.businessId);

  return {
    ...normalizeEmployee(updatedEmployeeRow as Employee),
    assignment: normalizeAssignment(assignmentRow as EmployeeAssignment),
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
  const employee = await getEmployeeById(client, playerId, input.employeeId);
  if (!employee) throw new Error("Employee not found.");

  const assignment = await getEmployeeAssignment(client, playerId, employee.id);
  if (!assignment) throw new Error("Employee is not assigned.");
  const assignedBusinessId = assignment.business_id;

  const { error: deleteAssignmentError } = await client
    .from("employee_assignments")
    .delete()
    .eq("id", assignment.id)
    .eq("employee_id", employee.id);

  if (deleteAssignmentError) throw deleteAssignmentError;
  await clearEmployeeExtractionSlots(client, employee.id);

  const { data: updatedEmployeeRow, error: updateEmployeeError } = await client
    .from("employees")
    .update({
      status: "available",
      shift_ends_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", employee.id)
    .eq("player_id", playerId)
    .select("*")
    .single();

  if (updateEmployeeError) throw updateEmployeeError;

  await syncManufacturingWorkerAssigned(client, assignedBusinessId);

  const skills = await getEmployeeSkills(client, playerId, employee.id);

  return {
    ...normalizeEmployee(updatedEmployeeRow as Employee),
    assignment: null,
    skills,
  };
}

export async function fireEmployee(
  client: QueryClient,
  playerId: string,
  input: FireEmployeeInput
): Promise<EmployeeWithDetails> {
  const employee = await getEmployeeById(client, playerId, input.employeeId);
  if (!employee) throw new Error("Employee not found.");

  const assignment = await getEmployeeAssignment(client, playerId, employee.id);
  const assignedBusinessId = assignment?.business_id ?? null;
  if (assignment) {
    const { error: deleteAssignmentError } = await client
      .from("employee_assignments")
      .delete()
      .eq("id", assignment.id)
      .eq("employee_id", employee.id);

    if (deleteAssignmentError) throw deleteAssignmentError;
  }

  await clearEmployeeExtractionSlots(client, employee.id);

  const { error: deleteSkillsError } = await client
    .from("employee_skills")
    .delete()
    .eq("employee_id", employee.id);

  if (deleteSkillsError) throw deleteSkillsError;

  const { error: deleteEmployeeError } = await client
    .from("employees")
    .delete()
    .eq("id", employee.id)
    .eq("player_id", playerId);

  if (deleteEmployeeError) throw deleteEmployeeError;

  if (assignedBusinessId) {
    await syncManufacturingWorkerAssigned(client, assignedBusinessId);
  }

  return {
    ...employee,
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
  const employee = await getEmployeeById(client, playerId, input.employeeId);
  if (!employee) throw new Error("Employee not found.");
  if (employee.status !== "unpaid") throw new Error("Employee does not have unpaid wages.");
  if (!employee.employer_business_id) throw new Error("Employee is not tied to a business.");

  const { data: debtRow, error: debtError } = await client
    .from("employees")
    .select("unpaid_wage_due")
    .eq("id", employee.id)
    .eq("player_id", playerId)
    .maybeSingle();

  if (debtError) throw debtError;

  const unpaidWageDue = toNumber((debtRow as { unpaid_wage_due?: number | string | null } | null)?.unpaid_wage_due);
  if (unpaidWageDue > 0) {
    const balance = await getBusinessBalance(client, playerId, employee.employer_business_id);
    if (balance < unpaidWageDue) {
      throw new Error(
        `Insufficient business funds. Wage settlement is $${unpaidWageDue.toFixed(2)} and balance is $${balance.toFixed(2)}.`
      );
    }

    await addBusinessAccountEntry(client, playerId, employee.employer_business_id, {
      amount: unpaidWageDue,
      entryType: "debit",
      category: "employee_wage_settlement",
      description: `Wage settlement: ${employee.first_name} ${employee.last_name}`,
      referenceId: employee.id,
    });
  }

  const nowIso = new Date().toISOString();
  const { data: updatedEmployeeRow, error: updateError } = await client
    .from("employees")
    .update({
      status: "available",
      unpaid_wage_due: 0,
      unpaid_since: null,
      last_unassigned_for_unpaid_at: null,
      shift_ends_at: null,
      last_wage_charged_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", employee.id)
    .eq("player_id", playerId)
    .select("*")
    .single();

  if (updateError) throw updateError;

  const skills = await getEmployeeSkills(client, playerId, employee.id);

  return {
    ...normalizeEmployee(updatedEmployeeRow as Employee),
    assignment: null,
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
