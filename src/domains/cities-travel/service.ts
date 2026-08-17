import type { QueryClient } from "@/lib/db/query-client";
import type {
  City,
  StartTravelInput,
  TravelLog,
} from "./types";
import { calculateTravelQuote } from "./topology";

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
