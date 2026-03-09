import type { User } from "@supabase/supabase-js";
import type {
  Character,
  CreateCharacterInput,
  OnlinePlayerPreview,
  Player,
  PlayerProfilePreview,
  PublicPlayerBusiness,
} from "./types";

type QueryClient = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

export async function getPlayerCount(
  client: QueryClient
): Promise<number> {
  const { count, error } = await client
    .from("players")
    .select("*", { count: "exact", head: true });

  if (error) throw error;
  return count ?? 0;
}

export async function touchPlayerPresence(
  client: QueryClient,
  playerId: string
): Promise<void> {
  const { error } = await client.rpc("touch_player_presence", {
    p_player_id: playerId,
  });

  if (error) throw error;
}

export async function getOnlinePlayerPreviews(
  client: QueryClient,
  windowSeconds = 300
): Promise<OnlinePlayerPreview[]> {
  const { data, error } = await client.rpc("get_online_player_previews", {
    p_window_seconds: windowSeconds,
  });

  if (error) throw error;

  return ((data as OnlinePlayerPreview[]) ?? []).map((row) => ({
    ...row,
    business_level: Number(row.business_level),
    wealth: Number(row.wealth),
  }));
}

export async function getPlayerProfilePreview(
  client: QueryClient,
  playerId: string
): Promise<PlayerProfilePreview | null> {
  const { data, error } = await client.rpc("get_player_profile_preview", {
    p_player_id: playerId,
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;

  return {
    ...(row as PlayerProfilePreview),
    business_level: Number((row as PlayerProfilePreview).business_level),
    net_worth: Number((row as PlayerProfilePreview).net_worth),
    personal_cash: Number((row as PlayerProfilePreview).personal_cash),
    business_cash: Number((row as PlayerProfilePreview).business_cash),
    business_asset_value: Number((row as PlayerProfilePreview).business_asset_value),
    liabilities: Number((row as PlayerProfilePreview).liabilities),
    total_businesses: Number((row as PlayerProfilePreview).total_businesses),
    is_online: Boolean((row as PlayerProfilePreview).is_online),
  };
}

export async function getPublicPlayerBusinesses(
  client: QueryClient,
  playerId: string
): Promise<PublicPlayerBusiness[]> {
  const { data, error } = await client.rpc("get_player_public_businesses", {
    p_player_id: playerId,
  });

  if (error) throw error;

  return ((data as PublicPlayerBusiness[]) ?? []).map((row) => ({
    ...row,
    value: Number(row.value),
    balance: Number(row.balance),
  }));
}

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
