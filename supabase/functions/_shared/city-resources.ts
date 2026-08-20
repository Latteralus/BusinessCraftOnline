import type { EdgeSupabaseClient } from "./tick-runtime.ts";
export {
  applyCityResourceAbundance,
  CITY_RESOURCE_ABUNDANCE_NEUTRAL,
} from "../../../shared/cities/resources.ts";
import { CITY_RESOURCE_ABUNDANCE_NEUTRAL } from "../../../shared/cities/resources.ts";

type CityResourceModifierRow = {
  city_id: string;
  resource_key: string;
  abundance_multiplier: number;
};

// One batched select per tick invocation (mirrors getResolvedBusinessUpgradeEffectsForBusinesses's
// batching in business-upgrades.ts) instead of a per-slot lookup.
export async function getCityResourceAbundanceMap(
  supabase: EdgeSupabaseClient,
  cityIds: string[]
): Promise<Map<string, Map<string, number>>> {
  const map = new Map<string, Map<string, number>>();
  const uniqueCityIds = [...new Set(cityIds)];
  if (uniqueCityIds.length === 0) return map;

  const { data, error } = await supabase
    .from("city_resource_modifiers")
    .select("city_id, resource_key, abundance_multiplier")
    .in("city_id", uniqueCityIds);
  if (error) throw error;

  for (const row of (data ?? []) as CityResourceModifierRow[]) {
    const byResource = map.get(row.city_id) ?? new Map<string, number>();
    byResource.set(row.resource_key, row.abundance_multiplier);
    map.set(row.city_id, byResource);
  }

  return map;
}

export function resolveCityResourceAbundance(
  map: Map<string, Map<string, number>>,
  cityId: string,
  resourceKey: string
): number {
  return map.get(cityId)?.get(resourceKey) ?? CITY_RESOURCE_ABUNDANCE_NEUTRAL;
}
