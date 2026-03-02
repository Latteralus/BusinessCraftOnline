// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const nowIso = new Date().toISOString();

  const { data: dueTravelRows, error: travelError } = await supabase
    .from("travel_log")
    .select("id, player_id, to_city_id")
    .eq("status", "traveling")
    .lte("arrives_at", nowIso)
    .order("arrives_at", { ascending: true })
    .limit(500);

  if (travelError) {
    return new Response(JSON.stringify({ ok: false, error: travelError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let processed = 0;

  for (const travel of dueTravelRows ?? []) {
    await supabase
      .from("travel_log")
      .update({ status: "arrived" })
      .eq("id", travel.id)
      .eq("status", "traveling");

    await supabase
      .from("characters")
      .update({ current_city_id: travel.to_city_id })
      .eq("player_id", travel.player_id);

    processed += 1;
  }

  return new Response(
    JSON.stringify({
      ok: true,
      function: "tick-travel",
      processed,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
});

