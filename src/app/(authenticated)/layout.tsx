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

  const [character, storefrontSettings, playerCount] = await Promise.all([
    getCharacter(supabase, user.id).catch(() => null),
    getMarketStorefrontSettings(supabase, user.id).catch(() => []),
    getPlayerCount(supabase).catch(() => 0),
  ]);

  if (!character) {
    redirect("/character-setup");
  }

  const adEnabledCount = storefrontSettings?.filter((row) => row.is_ad_enabled)?.length ?? 0;

  const initials = character.first_name[0] + character.last_name[0];

  async function handleLogout() {
    "use server";
    const supabase = createSupabaseServerClient();
    await supabase.auth.signOut();
    redirect("/login");
  }

  return (
    <>
      <Topbar
        initials={initials}
        firstName={character.first_name}
        lastName={character.last_name}
        businessLevel={character.business_level}
        adEnabledCount={adEnabledCount}
        playerCount={playerCount}
        onLogout={handleLogout}
      />
      <div className="main-container">
        {children}
      </div>
    </>
  );
}
