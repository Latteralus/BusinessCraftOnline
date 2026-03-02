// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function writeTickRunLog(
  supabase: ReturnType<typeof createClient>,
  input: {
    status: "ok" | "error";
    startedAtIso: string;
    finishedAtIso: string;
    durationMs: number;
    processedCount: number;
    metrics?: Record<string, unknown>;
    errorMessage?: string | null;
  }
) {
  await supabase.from("tick_run_logs").insert({
    tick_name: "tick-travel",
    status: input.status,
    started_at: input.startedAtIso,
    finished_at: input.finishedAtIso,
    duration_ms: Math.max(0, Math.floor(input.durationMs)),
    processed_count: Math.max(0, Math.floor(input.processedCount)),
    metrics: input.metrics ?? {},
    error_message: input.errorMessage ?? null,
  });
}

Deno.serve(async () => {
  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  try {
    const nowIso = new Date().toISOString();

    const { data: dueTravelRows, error: travelError } = await supabase
      .from("travel_log")
      .select("id, player_id, to_city_id")
      .eq("status", "traveling")
      .lte("arrives_at", nowIso)
      .order("arrives_at", { ascending: true })
      .limit(500);

    if (travelError) {
      throw travelError;
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

    const finishedAtIso = new Date().toISOString();
    const payload = {
      ok: true,
      function: "tick-travel",
      processed,
    };

    await writeTickRunLog(supabase, {
      status: "ok",
      startedAtIso,
      finishedAtIso,
      durationMs: new Date(finishedAtIso).getTime() - startedAt.getTime(),
      processedCount: processed,
      metrics: payload,
      errorMessage: null,
    });

    return new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const finishedAtIso = new Date().toISOString();
    const message = error instanceof Error ? error.message : "tick-travel failed";

    await writeTickRunLog(supabase, {
      status: "error",
      startedAtIso,
      finishedAtIso,
      durationMs: new Date(finishedAtIso).getTime() - startedAt.getTime(),
      processedCount: 0,
      metrics: {},
      errorMessage: message,
    });

    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
