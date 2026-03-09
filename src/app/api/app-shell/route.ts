import { getOnlinePlayerPreviews, touchPlayerPresence } from "@/domains/auth-character";
import { getMarketStorefrontSettings } from "@/domains/market";
import { requireAuthedUser } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function GET() {
  const auth = await requireAuthedUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  try {
    await touchPlayerPresence(supabase, user.id).catch(() => null);

    const [onlinePlayers, storefrontSettings] = await Promise.all([
      getOnlinePlayerPreviews(supabase, 300).catch(() => []),
      getMarketStorefrontSettings(supabase, user.id).catch(() => []),
    ]);

    return NextResponse.json({
      playerCount: onlinePlayers.length,
      onlinePlayers,
      notificationsCount: storefrontSettings.filter((row) => row.is_ad_enabled).length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load app shell." },
      { status: 500 }
    );
  }
}

export async function POST() {
  const auth = await requireAuthedUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  try {
    await touchPlayerPresence(supabase, user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update player presence." },
      { status: 500 }
    );
  }
}
