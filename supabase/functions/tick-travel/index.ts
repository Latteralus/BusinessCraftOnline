import {
  isRecord,
  readNumber,
  startTickRequest,
  writeTickRunLog,
} from "../_shared/tick-runtime.ts";

function parseTravelTickProcessed(value: unknown): number {
  if (!isRecord(value)) return 0;
  return Math.max(0, Math.floor(readNumber(value.processed) ?? 0));
}

Deno.serve(async (request) => {
  const requestStart = await startTickRequest(request, "tick-travel");
  if ("response" in requestStart) return requestStart.response;

  const { supabase, release } = requestStart;
  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();

  try {
    const { data, error } = await supabase.rpc("execute_due_travel_arrivals", { p_limit: 500 });

    if (error) throw error;

    const processed = parseTravelTickProcessed(data);

    const finishedAtIso = new Date().toISOString();
    const payload = {
      ok: true,
      function: "tick-travel",
      processed,
    };

    await writeTickRunLog(supabase, {
      tickName: "tick-travel",
      status: "ok",
      startedAtIso,
      finishedAtIso,
      durationMs: new Date(finishedAtIso).getTime() - startedAt.getTime(),
      processedCount: payload.processed,
      metrics: payload,
      errorMessage: null,
    });

    return new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const finishedAtIso = new Date().toISOString();
    const message = error instanceof Error ? error.message : "tick-travel failed";

    try {
      await writeTickRunLog(supabase, {
        tickName: "tick-travel",
        status: "error",
        startedAtIso,
        finishedAtIso,
        durationMs: new Date(finishedAtIso).getTime() - startedAt.getTime(),
        processedCount: 0,
        metrics: {},
        errorMessage: message,
      });
    } catch {
      // Ignore secondary log failures in error path.
    }

    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  } finally {
    await release();
  }
});
