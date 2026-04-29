export const EMPLOYEE_TYPES = [
  "temp",
  "part_time",
  "full_time",
  "specialist",
] as const;

export type SharedEmployeeType = (typeof EMPLOYEE_TYPES)[number];

export const BASE_WAGE_PER_HOUR: Record<SharedEmployeeType, number> = {
  temp: 40,
  part_time: 28,
  full_time: 25,
  specialist: 55,
};

export const WAGE_TICK_MINUTES = 15;
export const WAGE_TICK_HOURS = WAGE_TICK_MINUTES / 60;

export const STARTING_SKILL_LEVEL_BY_TYPE: Record<SharedEmployeeType, number> = {
  temp: 1,
  part_time: 6,
  full_time: 10,
  specialist: 20,
};

export const SKILL_WAGE_MODIFIER_STANDARD = 0.5;
export const SKILL_WAGE_MODIFIER_SPECIALIST = 0.75;
export const WAGE_VARIANCE_MAX = 2;

export function calculateHourlyWage(
  employeeType: SharedEmployeeType,
  skillLevel: number,
  variance = 0
): number {
  const clampedSkill = Math.max(1, Math.min(100, Math.floor(skillLevel)));
  const clampedVariance = Math.max(-WAGE_VARIANCE_MAX, Math.min(WAGE_VARIANCE_MAX, variance));

  const modifier =
    employeeType === "specialist" ? SKILL_WAGE_MODIFIER_SPECIALIST : SKILL_WAGE_MODIFIER_STANDARD;

  return Number((BASE_WAGE_PER_HOUR[employeeType] + clampedSkill * modifier + clampedVariance).toFixed(2));
}

export function calculatePayrollCharge(hourlyWage: number, tickCount = 1): number {
  return Number((hourlyWage * tickCount * WAGE_TICK_HOURS).toFixed(2));
}
