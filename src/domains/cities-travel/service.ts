import type { QueryClient } from "@/lib/db/query-client";
import type {
  City,
  CityEconomicState,
  CityEvent,
  CityResourceModifier,
  CityRoute,
  ShippingQuote,
  StartTravelInput,
  TravelLog,
  TravelQuote,
  WorldEconomicState,
  WorldEvent,
} from "./types";
import { calculateRouteShippingQuote, calculateRouteTravelQuote } from "./topology";

// cities has no RLS (see supabase/migrations/003_cities.sql) and its 10 rows
// change only via a migration -- the same result is correct for every user,
// so it's safe to cache across requests/users within a warm server
// instance, not just within one request's React cache(). Resolves audit
// finding M5 and architectural recommendation #7 (Documents/SBAudit.md).
const CITIES_CACHE_TTL_MS = 5 * 60 * 1000;
let citiesCache: { expiresAt: number; cities: City[] } | null = null;

export async function getCities(client: QueryClient): Promise<City[]> {
  if (citiesCache && citiesCache.expiresAt > Date.now()) {
    return citiesCache.cities;
  }

  const { data, error } = await client
    .from("cities")
    .select("*")
    .order("name", { ascending: true });

  if (error) throw error;
  const cities = (data as City[]) ?? [];
  citiesCache = { expiresAt: Date.now() + CITIES_CACHE_TTL_MS, cities };
  return cities;
}

export async function getCityById(
  client: QueryClient,
  cityId: string
): Promise<City | null> {
  const { data, error } = await client
    .from("cities")
    .select("*")
    .eq("id", cityId)
    .maybeSingle();

  if (error) throw error;
  return (data as City | null) ?? null;
}

// Same caching rationale as getCities above: city_resource_modifiers and
// city_routes are static reference data (change only via migration), so a
// warm-instance cache is safe across requests/users, not just one request.
let resourceModifiersCache: { expiresAt: number; rows: CityResourceModifier[] } | null = null;
let routesCache: { expiresAt: number; rows: CityRoute[] } | null = null;

export async function getCityResourceModifiers(
  client: QueryClient,
  cityId?: string
): Promise<CityResourceModifier[]> {
  if (!resourceModifiersCache || resourceModifiersCache.expiresAt <= Date.now()) {
    const { data, error } = await client
      .from("city_resource_modifiers")
      .select("*")
      .order("resource_key", { ascending: true });

    if (error) throw error;
    resourceModifiersCache = {
      expiresAt: Date.now() + CITIES_CACHE_TTL_MS,
      rows: (data as CityResourceModifier[]) ?? [],
    };
  }

  const rows = resourceModifiersCache.rows;
  return cityId ? rows.filter((row) => row.city_id === cityId) : rows;
}

export async function getCityRoutes(
  client: QueryClient,
  fromCityId?: string
): Promise<CityRoute[]> {
  if (!routesCache || routesCache.expiresAt <= Date.now()) {
    const { data, error } = await client
      .from("city_routes")
      .select("*")
      .eq("is_active", true);

    if (error) throw error;
    routesCache = {
      expiresAt: Date.now() + CITIES_CACHE_TTL_MS,
      rows: (data as CityRoute[]) ?? [],
    };
  }

  const rows = routesCache.rows;
  return fromCityId ? rows.filter((row) => row.from_city_id === fromCityId) : rows;
}

export async function getRouteBetweenCities(
  client: QueryClient,
  fromCityId: string,
  toCityId: string
): Promise<CityRoute | null> {
  const routes = await getCityRoutes(client, fromCityId);
  return routes.find((route) => route.to_city_id === toCityId) ?? null;
}

// CityPlan Phase 5: player travel and abstract shipping both read timing and
// cost off the same city_routes row instead of the old region-tier system,
// so they (and later trucking) stay consistent with each other.
async function resolveRouteAndWorldState(client: QueryClient, from: City, to: City) {
  if (from.id === to.id) {
    throw new Error("Origin and destination cannot be the same city.");
  }

  const [route, world] = await Promise.all([
    getRouteBetweenCities(client, from.id, to.id),
    getWorldEconomicState(client),
  ]);

  if (!route) {
    throw new Error("No route exists between these cities.");
  }

  return { route, world };
}

export async function calculateTravelQuote(
  client: QueryClient,
  from: City,
  to: City
): Promise<TravelQuote> {
  const { route, world } = await resolveRouteAndWorldState(client, from, to);
  return calculateRouteTravelQuote(route, world.transport_cost_index);
}

export async function calculateShippingQuote(
  client: QueryClient,
  from: City,
  to: City,
  quantity: number
): Promise<ShippingQuote> {
  const { route, world } = await resolveRouteAndWorldState(client, from, to);
  return calculateRouteShippingQuote(route, quantity, world.transport_cost_index);
}

// Dynamic economic state (CityPlan Phase 2) changes at most once per 24h,
// via run_government_daily_update -- a short warm-instance cache trades a
// small worst-case staleness window (well under the daily update cadence)
// for avoiding a DB round trip on every read, same rationale as the static
// reference-data caches above.
const ECONOMIC_STATE_CACHE_TTL_MS = 60 * 1000;
let worldEconomicStateCache: { expiresAt: number; state: WorldEconomicState } | null = null;
let cityEconomicStateCache: { expiresAt: number; rows: CityEconomicState[] } | null = null;

export async function getWorldEconomicState(
  client: QueryClient
): Promise<WorldEconomicState> {
  if (worldEconomicStateCache && worldEconomicStateCache.expiresAt > Date.now()) {
    return worldEconomicStateCache.state;
  }

  const { data, error } = await client
    .from("world_economic_state")
    .select("*")
    .eq("id", 1)
    .single();

  if (error) throw error;
  const state = data as WorldEconomicState;
  worldEconomicStateCache = { expiresAt: Date.now() + ECONOMIC_STATE_CACHE_TTL_MS, state };
  return state;
}

export async function getCityEconomicState(
  client: QueryClient,
  cityId?: string
): Promise<CityEconomicState[]> {
  if (!cityEconomicStateCache || cityEconomicStateCache.expiresAt <= Date.now()) {
    const { data, error } = await client.from("city_economic_state").select("*");

    if (error) throw error;
    cityEconomicStateCache = {
      expiresAt: Date.now() + ECONOMIC_STATE_CACHE_TTL_MS,
      rows: (data as CityEconomicState[]) ?? [],
    };
  }

  const rows = cityEconomicStateCache.rows;
  return cityId ? rows.filter((row) => row.city_id === cityId) : rows;
}

// Active events are not cached: they change exactly when the daily job (or,
// in principle, a future admin path) flips is_active, and there's no
// higher-frequency write path to protect against yet -- the state tables
// above are cached because they're read far more often relative to how
// rarely they change, which doesn't apply here until this has real callers.
export async function getActiveWorldEvents(client: QueryClient): Promise<WorldEvent[]> {
  const { data, error } = await client
    .from("world_events")
    .select("*")
    .eq("is_active", true)
    .order("starts_at", { ascending: true });

  if (error) throw error;
  return (data as WorldEvent[]) ?? [];
}

export async function getActiveCityEvents(
  client: QueryClient,
  cityId?: string
): Promise<CityEvent[]> {
  let query = client.from("city_events").select("*").eq("is_active", true);
  if (cityId) query = query.eq("city_id", cityId);

  const { data, error } = await query.order("starts_at", { ascending: true });

  if (error) throw error;
  return (data as CityEvent[]) ?? [];
}

export async function getActiveTravel(
  client: QueryClient,
  playerId: string
): Promise<TravelLog | null> {
  const { data, error } = await client
    .from("travel_log")
    .select("*")
    .eq("player_id", playerId)
    .eq("status", "traveling")
    .maybeSingle();

  if (error) throw error;
  return (data as TravelLog | null) ?? null;
}

export async function startTravel(
  client: QueryClient,
  input: StartTravelInput
): Promise<TravelLog> {
  const { data, error } = await client
    .from("travel_log")
    .insert({
      player_id: input.playerId,
      from_city_id: input.fromCityId,
      to_city_id: input.toCityId,
      departs_at: new Date().toISOString(),
      arrives_at: input.arrivesAt,
      cost: input.cost,
      status: "traveling",
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as TravelLog;
}

export async function cancelTravel(
  client: QueryClient,
  playerId: string,
  travelId: string
): Promise<TravelLog> {
  const { data, error } = await client
    .from("travel_log")
    .update({ status: "cancelled" })
    .eq("id", travelId)
    .eq("player_id", playerId)
    .eq("status", "traveling")
    .select("*")
    .single();

  if (error) throw error;
  return data as TravelLog;
}

export async function completeTravel(
  client: QueryClient,
  playerId: string,
  travelId: string
): Promise<TravelLog> {
  const { data, error } = await client
    .from("travel_log")
    .update({ status: "arrived" })
    .eq("id", travelId)
    .eq("player_id", playerId)
    .eq("status", "traveling")
    .select("*")
    .single();

  if (error) throw error;
  return data as TravelLog;
}

export async function canPurchaseBusiness(
  client: QueryClient,
  playerId: string
): Promise<boolean> {
  const activeTravel = await getActiveTravel(client, playerId);
  return !activeTravel;
}
