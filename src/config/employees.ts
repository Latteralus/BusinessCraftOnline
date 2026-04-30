import { EMPLOYEE_STATUSES } from "../../shared/employees/status";
import {
  BASE_WAGE_PER_HOUR,
  EMPLOYEE_TYPES,
  SKILL_WAGE_MODIFIER_SPECIALIST,
  SKILL_WAGE_MODIFIER_STANDARD,
  STARTING_SKILL_LEVEL_BY_TYPE,
  WAGE_TICK_HOURS,
  WAGE_TICK_MINUTES,
  WAGE_VARIANCE_MAX,
  calculateHourlyWage,
  calculatePayrollCharge,
  type SharedEmployeeType,
} from "../../shared/employees/payroll";

export {
  BASE_WAGE_PER_HOUR,
  EMPLOYEE_TYPES,
  SKILL_WAGE_MODIFIER_SPECIALIST,
  SKILL_WAGE_MODIFIER_STANDARD,
  STARTING_SKILL_LEVEL_BY_TYPE,
  WAGE_TICK_HOURS,
  WAGE_TICK_MINUTES,
  WAGE_VARIANCE_MAX,
  calculateHourlyWage,
  calculatePayrollCharge,
};

export type EmployeeType = SharedEmployeeType;

export { EMPLOYEE_STATUSES };

export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const EMPLOYEE_ROLES = ["production", "supply"] as const;

export type EmployeeRole = (typeof EMPLOYEE_ROLES)[number];

export const EMPLOYEE_SKILL_KEYS = [
  "mining",
  "farming",
  "logging",
  "metalworking",
  "carpentry",
  "brewing",
  "food_production",
  "logistics",
  "retail",
] as const;

export type EmployeeSkillKey = (typeof EMPLOYEE_SKILL_KEYS)[number];

export const SHIFT_LIMIT_HOURS: Record<EmployeeType, number> = {
  temp: 4,
  part_time: 8,
  full_time: 12,
  specialist: 24,
};

export const HIRE_COSTS: Record<EmployeeType, number> = {
  temp: 0,
  part_time: 200,
  full_time: 500,
  specialist: 1000,
};
