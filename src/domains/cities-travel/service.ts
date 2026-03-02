import { TRAVEL_TIERS, type CityRegion } from "@/config/cities";
import type {
  City,
  StartTravelInput,
  TravelLog,
  TravelQuote,
  TravelTier,
} from "./types";

type QueryClient = {
  from: (table: string) => any;
};

const ADJACENT_REGIONS: Record<CityRegion, CityRegion[]> = {
  Northeast: ["Midwest", "Southeast"],
  West: ["Southwest", "Mountain"],
  Midwest: ["Northeast", "South", "Mountain"],
  South: ["Midwest", "Southeast", "Southwest"],
  Southwest: ["West", "South", "Mountain"],
  Mountain: ["West", "Midwest", "Southwest"],
  Southeast: ["Northeast", "South"],
};

const FAR_CROSS_COUNTRY_PAIRS = new Set([
  "southeast:mountain",
  "mountain:southeast",
]);

export function calculateTravelQuote(from: City, to: City): TravelQuote {
  if (from.id === to.id) {
    throw new Error("Origin and destination cannot be the same city.");
  }

  let tier: TravelTier = "cross_country";

  if (from.region === to.region) {
    tier = "same_region";
  } else if (
    FAR_CROSS_COUNTRY_PAIRS.has(
      `${from.region.toLowerCase()}:${to.region.toLowerCase()}`
    )
  ) {
    tier = "far_cross_country";
  } else if (ADJACENT_REGIONS[from.region].includes(to.region)) {
    tier = "adjacent_region";
  }

  const details = TRAVEL_TIERS[tier];
  return {
    tier,
    minutes: details.minutes,
    cost: details.cost,
  };
}

export async function getCities(client: QueryClient): Promise<City[]> {
  const { data, error } = await client
    .from("cities")
    .select("*")
    .order("name", { ascending: true });

  if (error) throw error;
  return (data as City[]) ?? [];
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
