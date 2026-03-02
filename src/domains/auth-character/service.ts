import type { User } from "@supabase/supabase-js";
import type { Character, CreateCharacterInput, Player } from "./types";

type QueryClient = {
  from: (table: string) => any;
};

export async function getPlayer(
  client: QueryClient,
  playerId: string
): Promise<Player | null> {
  const { data, error } = await client
    .from("players")
    .select("*")
    .eq("id", playerId)
    .maybeSingle();

  if (error) throw error;
  return (data as Player | null) ?? null;
}

export async function getCharacter(
  client: QueryClient,
  playerId: string
): Promise<Character | null> {
  const { data, error } = await client
    .from("characters")
    .select("*")
    .eq("player_id", playerId)
    .maybeSingle();

  if (error) throw error;
  return (data as Character | null) ?? null;
}

export async function upsertPlayerFromAuthUser(
  client: QueryClient,
  user: User,
  usernameOverride?: string
): Promise<Player> {
  const fallbackUsername = user.email?.split("@")[0] ?? `player_${user.id.slice(0, 8)}`;
  const username = usernameOverride ?? fallbackUsername;

  const { data, error } = await client
    .from("players")
    .upsert(
      {
        id: user.id,
        email: user.email || null,
        username,
      },
      { onConflict: "id" }
    )
    .select("*")
    .single();

  if (error) throw error;
  return data as Player;
}

export async function createCharacter(
  client: QueryClient,
  playerId: string,
  input: CreateCharacterInput
): Promise<Character> {
  const { data, error } = await client
    .from("characters")
    .insert({
      player_id: playerId,
      first_name: input.firstName,
      last_name: input.lastName,
      gender: input.gender,
      current_city_id: input.currentCityId ?? null,
      business_level: 1,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as Character;
}

export async function updateCharacterCity(
  client: QueryClient,
  playerId: string,
  cityId: string | null
): Promise<Character> {
  const { data, error } = await client
    .from("characters")
    .update({ current_city_id: cityId })
    .eq("player_id", playerId)
    .select("*")
    .single();

  if (error) throw error;
  return data as Character;
}
