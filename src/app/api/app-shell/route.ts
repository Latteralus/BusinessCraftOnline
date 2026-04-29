import { getCharacter, getOnlinePlayerPreviews, touchPlayerPresence } from "@/domains/auth-character";
import type { OnlinePlayerPreview } from "@/domains/auth-character";
import { getMarketStorefrontSettings } from "@/domains/market";
import { requireAuthedUser } from "@/app/api/_shared/route-helpers";
import { getUnreadChatCount } from "@/domains/chat";
import { getUnreadMailCount } from "@/domains/mail";
import type { QueryClient } from "@/lib/db/query-client";
import { withTiming } from "@/lib/server-timing";
import { NextResponse } from "next/server";

function ensureCurrentPlayerOnline(
  onlinePlayers: OnlinePlayerPreview[],
  currentPlayer: OnlinePlayerPreview | null
) {
  if (!currentPlayer || onlinePlayers.some((player) => player.player_id === currentPlayer.player_id)) {
    return onlinePlayers;
  }

  return [currentPlayer, ...onlinePlayers];
}

async function loadAppShellData(supabase: QueryClient, userId: string, options: { touchPresence?: boolean } = {}) {
  if (options.touchPresence) {
    await touchPlayerPresence(supabase, userId);
  }

  const [onlinePlayersRaw, character, storefrontSettings, unreadChatCount, unreadMailCount] = await Promise.all([
    getOnlinePlayerPreviews(supabase, 300).catch(() => []),
    getCharacter(supabase, userId).catch(() => null),
    getMarketStorefrontSettings(supabase, userId).catch(() => []),
    getUnreadChatCount(supabase, userId).catch(() => 0),
    getUnreadMailCount(supabase, userId).catch(() => 0),
  ]);
  const currentPlayer = character
    ? {
        player_id: userId,
        character_name: `${character.first_name} ${character.last_name}`.trim(),
        business_level: Number(character.business_level),
        wealth: 0,
        last_seen_at: new Date().toISOString(),
      }
    : null;
  const onlinePlayers = ensureCurrentPlayerOnline(onlinePlayersRaw, currentPlayer);

  return {
    playerCount: onlinePlayers.length,
    onlinePlayers,
    notificationsCount: storefrontSettings.filter((row) => row.is_ad_enabled).length,
    unreadChatCount,
    unreadMailCount,
  };
}

export async function GET() {
  const auth = await requireAuthedUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  try {
    return await withTiming("api-route", "/api/app-shell GET", async (timing) => {
      const shell = await timing.measure("app-shell-data", () => loadAppShellData(supabase, user.id));
      return NextResponse.json(shell);
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
    return await withTiming("api-route", "/api/app-shell POST", async (timing) => {
      const shell = await timing.measure("app-shell-data-with-presence", () =>
        loadAppShellData(supabase, user.id, { touchPresence: true })
      );
      return NextResponse.json({
        ok: true,
        ...shell,
      });
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update player presence." },
      { status: 500 }
    );
  }
}
