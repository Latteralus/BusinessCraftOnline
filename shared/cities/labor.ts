// City/world labor pressure and wage-expectation formulas -- CityPlan Phase
// 2 ("Labor formula"). Population changes labor supply and demand; population
// never directly sets wages (see Documents/Plans/CityPlan.md, "Phase 2 -
// World and City Economic State"). This module is the single deterministic
// source for these formulas so app-side hiring/wage code and any future
// edge-function consumer stay in sync -- do not reimplement this math inline.

export const LABOR_PRESSURE_MIN = 0.7;
export const LABOR_PRESSURE_MAX = 1.5;

export function clampLaborPressure(value: number): number {
  return Math.min(LABOR_PRESSURE_MAX, Math.max(LABOR_PRESSURE_MIN, value));
}

// cityLaborPressure = clamp(laborDemandIndex / max(laborSupplyIndex, 0.25), 0.70, 1.50)
export function getCityLaborPressure(
  laborDemandIndex: number,
  laborSupplyIndex: number
): number {
  return clampLaborPressure(laborDemandIndex / Math.max(laborSupplyIndex, 0.25));
}

// effectiveCityLaborIndex = city.baseLaborIndex * cityLaborPressure * world.laborIndex
export function getEffectiveCityLaborIndex(
  baseLaborIndex: number,
  laborDemandIndex: number,
  laborSupplyIndex: number,
  worldLaborIndex: number
): number {
  return (
    baseLaborIndex *
    getCityLaborPressure(laborDemandIndex, laborSupplyIndex) *
    worldLaborIndex
  );
}

// expectedWage = skillBasedWage * effectiveCityLaborIndex * employeeExpectationFactor
export function getExpectedWage(
  skillBasedWage: number,
  effectiveCityLaborIndex: number,
  employeeExpectationFactor = 1
): number {
  return skillBasedWage * effectiveCityLaborIndex * employeeExpectationFactor;
}
