import type {
  City,
  StartTravelInput,
  TravelLog,
} from "./types";
import { calculateTravelQuote } from "./topology";

type QueryClient = {
  from: (table: string) => any;
};

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
