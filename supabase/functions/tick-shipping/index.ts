import {
  isRecord,
  readNumber,
  startTickRequest,
  writeTickRunLog,
} from "../_shared/tick-runtime.ts";

type ShippingTickStats = {
  processed: number;
  deliveredPersonal: number;
  deliveredBusiness: number;
};

function parseShippingTickStats(value: unknown): ShippingTickStats {
  if (!isRecord(value)) {
    return {
      processed: 0,
      deliveredPersonal: 0,
      deliveredBusiness: 0,
    };
  }

  return {
    processed: Math.max(0, Math.floor(readNumber(value.processed) ?? 0)),
    deliveredPersonal: Math.max(0, Math.floor(readNumber(value.deliveredPersonal) ?? 0)),
    deliveredBusiness: Math.max(0, Math.floor(readNumber(value.deliveredBusiness) ?? 0)),
  };
}

Deno.serve(async (request) => {
  const requestStart = await startTickRequest(request, "tick-shipping");
  if ("response" in requestStart) return requestStart.response;

  const { supabase, release } = requestStart;
  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();

  try {
    const { data, error } = await supabase.rpc("execute_due_shipping_deliveries", { p_limit: 500 });

    if (error) throw error;

    const stats = parseShippingTickStats(data);

    const finishedAtIso = new Date().toISOString();
    const payload = {
      ok: true,
      function: "tick-shipping",
      processed: stats.processed,
      deliveredPersonal: stats.deliveredPersonal,
      deliveredBusiness: stats.deliveredBusiness,
    };

    await writeTickRunLog(supabase, {
      tickName: "tick-shipping",
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
    const message = error instanceof Error ? error.message : "tick-shipping failed";

    try {
      await writeTickRunLog(supabase, {
        tickName: "tick-shipping",
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
