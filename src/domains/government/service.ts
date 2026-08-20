import type { QueryClient } from "@/lib/db/query-client";
import {
  getActiveCityEvents,
  getCities,
  getCityEconomicState,
  getWorldEconomicState,
  type CityEvent,
} from "@/domains/cities-travel";
import { getStockpileStatus, projectCurrentStock } from "../../../shared/cities/stockpiles";
import type { CityStockpile, ProjectedCityStockpile } from "./types";

// Raw rows change at most every 5 minutes (tick-city-stockpiles' due sweep)
// or once/day (the government daily pass) -- a short warm-instance cache
// trades a small worst-case staleness window for avoiding a DB round trip on
// every read, same rationale as cities-travel's economic-state cache.
const STOCKPILES_CACHE_TTL_MS = 60 * 1000;
let stockpilesCache: { expiresAt: number; rows: CityStockpile[] } | null = null;

export async function getCityStockpiles(
  client: QueryClient,
  cityId?: string
): Promise<CityStockpile[]> {
  if (!stockpilesCache || stockpilesCache.expiresAt <= Date.now()) {
    const { data, error } = await client
      .from("city_stockpiles")
      .select("*")
      .eq("is_active", true);

    if (error) throw error;
    stockpilesCache = {
      expiresAt: Date.now() + STOCKPILES_CACHE_TTL_MS,
      rows: (data as CityStockpile[]) ?? [],
    };
  }

  const rows = stockpilesCache.rows;
  return cityId ? rows.filter((row) => row.city_id === cityId) : rows;
}

function getActiveItemEventMultiplier(events: CityEvent[], itemKey: string): number {
  const modifierKey = `stockpile_${itemKey}`;
  return events.reduce((product, event) => {
    const value = event.modifiers[modifierKey];
    return typeof value === "number" ? product * value : product;
  }, 1);
}

// Composes cities-travel's public API (cities, city/world economic state,
// active city events) with the raw stockpile rows to project each
// stockpile's *current* effective stock at read time, without writing --
// mirrors materialize_city_stockpile_ids' SQL formula (migration 114) and
// shared/cities/stockpiles.ts's pure-TS version of the same math.
export async function getProjectedCityStockpiles(
  client: QueryClient,
  cityId?: string
): Promise<ProjectedCityStockpile[]> {
  const [stockpiles, cities, cityStates, worldState, cityEvents] = await Promise.all([
    getCityStockpiles(client, cityId),
    getCities(client),
    getCityEconomicState(client, cityId),
    getWorldEconomicState(client),
    getActiveCityEvents(client, cityId),
  ]);

  const cityById = new Map(cities.map((c) => [c.id, c]));
  const cityStateById = new Map(cityStates.map((s) => [s.city_id, s]));
  const eventsByCity = new Map<string, CityEvent[]>();
  for (const event of cityEvents) {
    const list = eventsByCity.get(event.city_id) ?? [];
    list.push(event);
    eventsByCity.set(event.city_id, list);
  }

  const nowIso = new Date().toISOString();

  return stockpiles.map((stockpile) => {
    const city = cityById.get(stockpile.city_id);
    const cityState = cityStateById.get(stockpile.city_id);
    const populationBaseline = city?.population_baseline ?? 0;
    const population = cityState?.population ?? populationBaseline;
    const populationScale = populationBaseline > 0 ? population / populationBaseline : 1;
    const activeItemEventMultiplier = getActiveItemEventMultiplier(
      eventsByCity.get(stockpile.city_id) ?? [],
      stockpile.item_key
    );

    const { currentStock } = projectCurrentStock({
      storedQuantity: stockpile.stored_quantity,
      lastMaterializedAtIso: stockpile.last_materialized_at,
      baseConsumptionPerHour: stockpile.base_consumption_per_hour,
      populationScale,
      cityMunicipalConsumptionIndex: cityState?.municipal_consumption_index ?? 1,
      worldMunicipalConsumptionIndex: worldState.municipal_consumption_index,
      activeItemEventMultiplier,
      nowIso,
    });

    return {
      ...stockpile,
      current_quantity: currentStock,
      status: getStockpileStatus(currentStock, stockpile.reorder_point, stockpile.critical_point),
    };
  });
}
