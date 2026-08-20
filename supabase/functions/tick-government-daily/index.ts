// CityPlan Phase 2: the one authoritative daily government/world economic
// update. All the real work happens in the idempotent, set-based
// run_government_daily_update() RPC (migration 112) -- this function's job
// is just to invoke it and log the result, matching tick-shipping's
// single-RPC-call shape rather than tick-wages' per-row loop shape, since
// there is no per-row work happening in application code here.
//
// Per Documents/Plans/CityPlan.md ("Government / Economic Update Cadence"),
// this must run at most once per 24-hour economic day regardless of how
// often the cron schedule invokes it -- the RPC itself enforces that via a
// locked economic_day check, so a tighter-than-daily cron cadence (e.g. for
// faster recovery after a missed run) is safe and will simply no-op.

import {
  isRecord,
  readNumber,
  startTickRequest,
  writeTickRunLog,
} from "../_shared/tick-runtime.ts";

type GovernmentDailyResult = {
  skipped: boolean;
  reason: string | null;
  economicDay: number | null;
  citiesProcessed: number;
  eventsStarted: number;
  eventsEnded: number;
};

function parseGovernmentDailyResult(value: unknown): GovernmentDailyResult {
  if (!isRecord(value)) {
    return {
      skipped: false,
      reason: null,
      economicDay: null,
      citiesProcessed: 0,
      eventsStarted: 0,
      eventsEnded: 0,
    };
  }

  return {
    skipped: value.skipped === true,
    reason: typeof value.reason === "string" ? value.reason : null,
    economicDay: readNumber(value.economicDay),
    citiesProcessed: Math.max(0, Math.floor(readNumber(value.citiesProcessed) ?? 0)),
    eventsStarted: Math.max(0, Math.floor(readNumber(value.eventsStarted) ?? 0)),
    eventsEnded: Math.max(0, Math.floor(readNumber(value.eventsEnded) ?? 0)),
  };
}

Deno.serve(async (request) => {
  const requestStart = await startTickRequest(request, "tick-government-daily");
  if ("response" in requestStart) return requestStart.response;

  const { supabase, release } = requestStart;
  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();

  try {
    const { data, error } = await supabase.rpc("run_government_daily_update");

    if (error) throw error;

    const result = parseGovernmentDailyResult(data);

    const finishedAtIso = new Date().toISOString();
    const payload = {
      ok: true,
      function: "tick-government-daily",
      skipped: result.skipped,
      reason: result.reason,
      economicDay: result.economicDay,
      citiesProcessed: result.citiesProcessed,
      eventsStarted: result.eventsStarted,
      eventsEnded: result.eventsEnded,
    };

    await writeTickRunLog(supabase, {
      tickName: "tick-government-daily",
      status: "ok",
      startedAtIso,
      finishedAtIso,
      durationMs: new Date(finishedAtIso).getTime() - startedAt.getTime(),
      processedCount: result.citiesProcessed,
      metrics: payload,
      errorMessage: null,
    });

    return new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const finishedAtIso = new Date().toISOString();
    const message = error instanceof Error ? error.message : "tick-government-daily failed";

    try {
      await writeTickRunLog(supabase, {
        tickName: "tick-government-daily",
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
