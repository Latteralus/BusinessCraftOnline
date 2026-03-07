import { getCharacter, getPlayerCount } from "@/domains/auth-character";
import { getMarketStorefrontSettings } from "@/domains/market";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { Topbar } from "@/components/layout/Topbar";

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const character = await getCharacter(supabase, user.id).catch(() => null);

  if (!character) {
    redirect("/character-setup");
  }

  const [storefrontSettings, playerCount] = await Promise.all([
    getMarketStorefrontSettings(supabase, user.id).catch(() => []),
    getPlayerCount(supabase).catch(() => 0),
  ]);

  const adEnabledCount = storefrontSettings?.filter((row) => row.is_ad_enabled)?.length ?? 0;

  const initials = character.first_name[0] + character.last_name[0];

  return (
    <>
      <Topbar
        initials={initials}
        firstName={character.first_name}
        lastName={character.last_name}
        businessLevel={character.business_level}
        notificationsCount={adEnabledCount}
        playerCount={playerCount}
      />
      <div className="main-container">
        {children}
      </div>
    </>
  );
}
