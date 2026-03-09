import { getCharacter, updateCharacterCity } from "@/domains/auth-character";
import { completeTravel, getActiveTravel, getCities, getCityById } from "@/domains/cities-travel";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import TravelClient from "./TravelClient";

function hasArrived(isoDate: string) {
  return new Date(isoDate).getTime() <= Date.now();
}

export default async function TravelPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const character = await getCharacter(supabase, user.id).catch(() => null);
  if (!character?.current_city_id) {
    redirect("/character-setup");
  }

  const cities = await getCities(supabase).catch(() => []);
  let activeTravel = await getActiveTravel(supabase, user.id).catch(() => null);

  if (activeTravel && hasArrived(activeTravel.arrives_at)) {
    activeTravel = await completeTravel(supabase, user.id, activeTravel.id).catch(() => null);
    if (activeTravel) {
      await updateCharacterCity(supabase, user.id, activeTravel.to_city_id).catch(() => null);
    }
    activeTravel = null;
  }

  const freshCharacter = await getCharacter(supabase, user.id).catch(() => character);
  const currentCity = freshCharacter?.current_city_id
    ? await getCityById(supabase, freshCharacter.current_city_id).catch(() => null)
    : null;

  return (
    <TravelClient
      cities={cities}
      travelState={{
        currentCity,
        activeTravel,
        canPurchaseBusiness: !activeTravel,
      }}
    />
  );
}
