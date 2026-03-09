import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

type PublicSimulationStats = {
  player_count: number | null;
  business_count: number | null;
  online_player_count: number | null;
};

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("get_public_simulation_stats");

    if (error) {
      throw error;
    }

    const stats = (Array.isArray(data) ? data[0] : data) as PublicSimulationStats | null;

    return NextResponse.json({
      playerCount: Number(stats?.player_count ?? 0),
      businessCount: Number(stats?.business_count ?? 0),
      onlinePlayerCount: Number(stats?.online_player_count ?? 0),
    });
  } catch {
    return NextResponse.json(
      {
        playerCount: 0,
        businessCount: 0,
        onlinePlayerCount: 0,
      },
      { status: 200 }
    );
  }
}
