import { getPlayerCount } from "@/domains/auth-character";
import { getMarketStorefrontSettings } from "@/domains/market";
import { requireAuthedUser } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function GET() {
  const auth = await requireAuthedUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  try {
    const [playerCount, storefrontSettings] = await Promise.all([
      getPlayerCount(supabase).catch(() => 0),
      getMarketStorefrontSettings(supabase, user.id).catch(() => []),
    ]);

    return NextResponse.json({
      playerCount,
      notificationsCount: storefrontSettings.filter((row) => row.is_ad_enabled).length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load app shell." },
      { status: 500 }
    );
  }
}
