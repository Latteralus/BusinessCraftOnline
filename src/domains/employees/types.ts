import type {
  EmployeeRole,
  EmployeeSkillKey,
  EmployeeStatus,
  EmployeeType,
} from "@/config/employees";

export type Employee = {
  id: string;
  player_id: string;
  employer_business_id: string | null;
  first_name: string;
  last_name: string;
  employee_type: EmployeeType;
  status: EmployeeStatus;
  specialty_skill_key: EmployeeSkillKey | null;
  hire_cost: number;
  wage_per_hour: number;
  last_wage_charged_at: string | null;
  shift_ends_at: string | null;
  created_at: string;
  updated_at: string;
};

export type EmployeeAssignment = {
  id: string;
  employee_id: string;
  business_id: string;
  role: EmployeeRole;
  slot_number: number | null;
  wage_per_hour: number;
  assigned_at: string;
  updated_at: string;
};

export type EmployeeSkill = {
  id: string;
  employee_id: string;
  skill_key: EmployeeSkillKey;
  level: number;
  xp: number;
  created_at: string;
  updated_at: string;
};

export type EmployeeWithDetails = Employee & {
  assignment: EmployeeAssignment | null;
  skills: EmployeeSkill[];
};

export type EmployeeSummary = {
  totalEmployees: number;
  byStatus: Record<EmployeeStatus, number>;
  assignedCount: number;
  availableCount: number;
  restingCount: number;
  unpaidCount: number;
  firedCount: number;
};

export type HireEmployeeInput = {
  businessId: string;
  firstName: string;
  lastName: string;
  employeeType: EmployeeType;
  specialtySkillKey?: EmployeeSkillKey;
};

export type AssignEmployeeInput = {
  employeeId: string;
  businessId: string;
  role: EmployeeRole;
  slotNumber?: number;
  wageVariance?: number;
  roleSkillKey?: EmployeeSkillKey;
};

export type ReactivateEmployeeInput = {
  employeeId: string;
};

export type UnassignEmployeeInput = {
  employeeId: string;
};

export type FireEmployeeInput = {
  employeeId: string;
};

export type EmployeeListFilter = {
  status?: EmployeeStatus;
  employeeType?: EmployeeType;
  businessId?: string;
};

export type { EmployeeRole, EmployeeSkillKey, EmployeeStatus, EmployeeType };
