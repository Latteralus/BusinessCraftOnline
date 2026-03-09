export const EMPLOYEE_TYPES = [
  "temp",
  "part_time",
  "full_time",
  "specialist",
] as const;

export type EmployeeType = (typeof EMPLOYEE_TYPES)[number];

import { EMPLOYEE_STATUSES } from "../../shared/employees/status";

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
  specialist: 12,
};

export const HIRE_COSTS: Record<EmployeeType, number> = {
  temp: 0,
  part_time: 200,
  full_time: 500,
  specialist: 1000,
};

export const BASE_WAGE_PER_HOUR: Record<EmployeeType, number> = {
  temp: 15,
  part_time: 10,
  full_time: 9,
  specialist: 14,
};

export const STARTING_SKILL_LEVEL_BY_TYPE: Record<EmployeeType, number> = {
  temp: 1,
  part_time: 6,
  full_time: 10,
  specialist: 20,
};

export const SKILL_WAGE_MODIFIER_STANDARD = 0.5;
export const SKILL_WAGE_MODIFIER_SPECIALIST = 0.75;
export const WAGE_VARIANCE_MAX = 2;

export function calculateHourlyWage(
  employeeType: EmployeeType,
  skillLevel: number,
  variance = 0
): number {
  const clampedSkill = Math.max(1, Math.min(100, Math.floor(skillLevel)));
  const clampedVariance = Math.max(-WAGE_VARIANCE_MAX, Math.min(WAGE_VARIANCE_MAX, variance));

  const modifier =
    employeeType === "specialist" ? SKILL_WAGE_MODIFIER_SPECIALIST : SKILL_WAGE_MODIFIER_STANDARD;

  return Number((BASE_WAGE_PER_HOUR[employeeType] + clampedSkill * modifier + clampedVariance).toFixed(2));
}
