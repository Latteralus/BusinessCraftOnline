// CityPlan Phase 3/4: due-reorder materialization sweep for municipal
// stockpiles, plus (Phase 4) automatic replenishment contract creation for
// whatever is still due after materializing. All the math lives in
// materialize_and_replenish_city_stockpiles_due() (migration 118), which
// itself composes materialize_city_stockpiles_due() (migration 114) and
// create_replenishment_contracts_for_due_stockpiles() (migration 118) -- this
// function's job is just to invoke it and log the result, same one-RPC-call
// shape as tick-shipping/tick-government-daily.

import {
  isRecord,
  readNumber,
  startTickRequest,
  writeTickRunLog,
} from "../_shared/tick-runtime.ts";

type StockpileSweepResult = {
  processed: number;
  contractsCreated: number;
};

function parseSweepResult(value: unknown): StockpileSweepResult {
  if (!isRecord(value)) return { processed: 0, contractsCreated: 0 };
  return {
    processed: Math.max(0, Math.floor(readNumber(value.processed) ?? 0)),
    contractsCreated: Math.max(0, Math.floor(readNumber(value.contractsCreated) ?? 0)),
  };
}

Deno.serve(async (request) => {
  const requestStart = await startTickRequest(request, "tick-city-stockpiles");
  if ("response" in requestStart) return requestStart.response;

  const { supabase, release } = requestStart;
  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();

  try {
    const { data, error } = await supabase.rpc("materialize_and_replenish_city_stockpiles_due", { p_limit: 500 });

    if (error) throw error;

    const { processed, contractsCreated } = parseSweepResult(data);

    const finishedAtIso = new Date().toISOString();
    const payload = {
      ok: true,
      function: "tick-city-stockpiles",
      processed,
      contractsCreated,
    };

    await writeTickRunLog(supabase, {
      tickName: "tick-city-stockpiles",
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
    const message = error instanceof Error ? error.message : "tick-city-stockpiles failed";

    try {
      await writeTickRunLog(supabase, {
        tickName: "tick-city-stockpiles",
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
