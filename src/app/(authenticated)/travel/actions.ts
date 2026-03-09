"use server";

import { getCharacter, updateCharacterCity } from "@/domains/auth-character";
import {
  calculateTravelQuote,
  cancelTravel,
  completeTravel,
  getActiveTravel,
  getCityById,
  startTravel,
  startTravelSchema,
  type TravelQuote,
} from "@/domains/cities-travel";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";

type ActionResult<T = undefined> = {
  ok: boolean;
  data?: T;
  error?: string;
};

function hasArrived(isoDate: string) {
  return new Date(isoDate).getTime() <= Date.now();
}

async function ensureUserAndCharacter() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { supabase, user: null, character: null };
  }

  const character = await getCharacter(supabase, user.id).catch(() => null);
  return { supabase, user, character };
}

export async function getTravelQuoteAction(toCityId: string): Promise<ActionResult<TravelQuote>> {
  const parsed = startTravelSchema.safeParse({ toCityId });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid destination city." };
  }

  const { supabase, user, character } = await ensureUserAndCharacter();
  if (!user) return { ok: false, error: "Unauthorized." };
  if (!character?.current_city_id) return { ok: false, error: "Character does not currently have a city." };

  const [fromCity, toCity] = await Promise.all([
    getCityById(supabase, character.current_city_id).catch(() => null),
    getCityById(supabase, parsed.data.toCityId).catch(() => null),
  ]);

  if (!fromCity || !toCity) {
    return { ok: false, error: "Origin or destination city not found." };
  }

  try {
    const quote = calculateTravelQuote(fromCity, toCity);
    return { ok: true, data: quote };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid travel route." };
  }
}

export async function startTravelAction(toCityId: string): Promise<ActionResult> {
  const parsed = startTravelSchema.safeParse({ toCityId });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid destination city." };
  }

  const { supabase, user, character } = await ensureUserAndCharacter();
  if (!user) return { ok: false, error: "Unauthorized." };
  if (!character?.current_city_id) return { ok: false, error: "Character does not currently have a city." };

  let activeTravel = await getActiveTravel(supabase, user.id).catch(() => null);
  if (activeTravel && hasArrived(activeTravel.arrives_at)) {
    activeTravel = await completeTravel(supabase, user.id, activeTravel.id).catch(() => null);
    if (activeTravel) {
      await updateCharacterCity(supabase, user.id, activeTravel.to_city_id).catch(() => null);
    }
    activeTravel = null;
  }

  if (activeTravel) {
    return { ok: false, error: "You are already traveling." };
  }

  const [fromCity, toCity] = await Promise.all([
    getCityById(supabase, character.current_city_id).catch(() => null),
    getCityById(supabase, parsed.data.toCityId).catch(() => null),
  ]);

  if (!fromCity || !toCity) {
    return { ok: false, error: "Origin or destination city not found." };
  }

  let quote;
  try {
    quote = calculateTravelQuote(fromCity, toCity);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid travel route." };
  }

  const arrivesAt = new Date(Date.now() + quote.minutes * 60_000).toISOString();
  try {
    await startTravel(supabase, {
      playerId: user.id,
      fromCityId: fromCity.id,
      toCityId: toCity.id,
      cost: quote.cost,
      arrivesAt,
    });
  } catch {
    return { ok: false, error: "Travel request failed." };
  }

  revalidatePath("/travel");
  revalidatePath("/dashboard");
  revalidatePath("/businesses");
  return { ok: true };
}

export async function cancelTravelAction(): Promise<ActionResult> {
  const { supabase, user } = await ensureUserAndCharacter();
  if (!user) return { ok: false, error: "Unauthorized." };

  const activeTravel = await getActiveTravel(supabase, user.id).catch(() => null);
  if (!activeTravel) {
    return { ok: false, error: "No active travel found." };
  }

  try {
    await cancelTravel(supabase, user.id, activeTravel.id);
  } catch {
    return { ok: false, error: "Could not cancel travel." };
  }
  revalidatePath("/travel");
  revalidatePath("/dashboard");
  revalidatePath("/businesses");
  return { ok: true };
}
