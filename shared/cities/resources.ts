// City resource abundance -- CityPlan Phase 1. Abundance affects extraction
// *quantity* only, never quality (see Documents/Plans/CityPlan.md, "Design
// Principles"). 0 = no local supply of that resource (forces trade), 1 =
// neutral/baseline output, 2 = double base output.

export const CITY_RESOURCE_ABUNDANCE_MIN = 0;
export const CITY_RESOURCE_ABUNDANCE_MAX = 2;
export const CITY_RESOURCE_ABUNDANCE_NEUTRAL = 1;

export function clampCityResourceAbundance(value: number): number {
  return Math.min(
    CITY_RESOURCE_ABUNDANCE_MAX,
    Math.max(CITY_RESOURCE_ABUNDANCE_MIN, value)
  );
}

export function applyCityResourceAbundance(
  baseOutput: number,
  abundanceMultiplier: number
): number {
  return baseOutput * clampCityResourceAbundance(abundanceMultiplier);
}
