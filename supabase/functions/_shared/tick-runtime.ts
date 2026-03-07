import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type TickLogInput = {
  tickName: string;
  status: "ok" | "error";
  startedAtIso: string;
  finishedAtIso: string;
  durationMs: number;
  processedCount: number;
  metrics?: Record<string, unknown>;
  errorMessage?: string | null;
};

export function createServiceClientFromEnv() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

export async function writeTickRunLog(
  supabase: ReturnType<typeof createClient>,
  input: TickLogInput
) {
  await supabase.from("tick_run_logs").insert({
    tick_name: input.tickName,
    status: input.status,
    started_at: input.startedAtIso,
    finished_at: input.finishedAtIso,
    duration_ms: Math.max(0, Math.floor(input.durationMs)),
    processed_count: Math.max(0, Math.floor(input.processedCount)),
    metrics: input.metrics ?? {},
    error_message: input.errorMessage ?? null,
  });
}

export function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

