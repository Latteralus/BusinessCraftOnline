// @ts-nocheck
import { createServiceClientFromEnv, writeTickRunLog } from "../_shared/tick-runtime.ts";

Deno.serve(async () => {
  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();

  try {
    const supabase = createServiceClientFromEnv();
    const { data, error } = await supabase.rpc("execute_due_shipping_deliveries", { p_limit: 500 });

    if (error) throw error;

    const stats = (data ?? {}) as {
      processed?: number;
      deliveredPersonal?: number;
      deliveredBusiness?: number;
    };

    const finishedAtIso = new Date().toISOString();
    const payload = {
      ok: true,
      function: "tick-shipping",
      processed: Number(stats.processed ?? 0),
      deliveredPersonal: Number(stats.deliveredPersonal ?? 0),
      deliveredBusiness: Number(stats.deliveredBusiness ?? 0),
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
      const supabase = createServiceClientFromEnv();
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
  }
});