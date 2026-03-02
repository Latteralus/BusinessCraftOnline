import { getPlayer } from "@/domains/auth-character";
import {
  getAdminEconomySummary,
  getStorefrontPerformanceSummary,
  getTickHealthSummary,
} from "@/domains/market";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

function parseWindowHours(value: string | null): number {
  const parsed = Number(value ?? "24");
  if (!Number.isFinite(parsed)) return 24;
  return Math.max(1, Math.min(168, Math.floor(parsed)));
}

export async function GET(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const player = await getPlayer(supabase, user.id);
  if (!player) {
    return NextResponse.json({ error: "Player not found." }, { status: 404 });
  }

  const url = new URL(request.url);
  const windowHours = parseWindowHours(url.searchParams.get("windowHours"));

  try {
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
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load analytics." },
      { status: 500 }
    );
  }
}

