import { getPlayer } from "@/domains/auth-character";
import {
  getAdminEconomySummary,
  getStorefrontPerformanceSummary,
  getTickHealthSummary,
} from "@/domains/market";
import { handleAuthedRequest, notFound } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

function parseWindowHours(value: string | null): number {
  const parsed = Number(value ?? "24");
  if (!Number.isFinite(parsed)) return 24;
  return Math.max(1, Math.min(168, Math.floor(parsed)));
}

export async function GET(request: Request) {
  return handleAuthedRequest(async ({ supabase, user }) => {
    const player = await getPlayer(supabase, user.id);
    if (!player) {
      return notFound("Player not found.");
    }

    const url = new URL(request.url);
    const windowHours = parseWindowHours(url.searchParams.get("windowHours"));

    const [tickHealth, storefrontPerformance, adminSummary] = await Promise.all([
      getTickHealthSummary(supabase, windowHours),
      getStorefrontPerformanceSummary(supabase, user.id, windowHours),
      player.role === "admin" ? getAdminEconomySummary(supabase, windowHours) : Promise.resolve(null),
    ]);

    return NextResponse.json({
      windowHours,
      playerRole: player.role,
      tickHealth,
      storefrontPerformance,
      adminSummary,
    });
  }, { errorMessage: "Failed to load analytics.", errorStatus: 500 });
}
