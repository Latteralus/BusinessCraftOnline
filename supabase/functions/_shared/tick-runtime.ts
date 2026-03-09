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

function jsonErrorResponse(status: number, error: string): Response {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type TickRequestStartResult =
  | {
      response: Response;
    }
  | {
      supabase: ReturnType<typeof createClient>;
      release: () => Promise<void>;
    };

export async function startTickRequest(
  request: Request,
  tickName: string,
  lockWindowSeconds = 300
): Promise<TickRequestStartResult> {
  if (request.method !== "POST") {
    return { response: jsonErrorResponse(405, "Method not allowed. Use POST.") };
  }

  const expectedSecret = Deno.env.get("TICK_FUNCTION_SECRET") ?? "";
  if (!expectedSecret) {
    return { response: jsonErrorResponse(500, "Missing TICK_FUNCTION_SECRET") };
  }

  const providedSecret = request.headers.get("x-tick-secret") ?? "";
  if (!providedSecret || providedSecret !== expectedSecret) {
    return { response: jsonErrorResponse(401, "Unauthorized") };
  }

  let supabase: ReturnType<typeof createClient>;
  try {
    supabase = createServiceClientFromEnv();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Missing service role configuration";
    return { response: jsonErrorResponse(500, message) };
  }

  const lockSeconds = Math.max(5, Math.floor(lockWindowSeconds));
  const { data: lockTokenRaw, error: lockError } = await supabase.rpc("acquire_tick_lock", {
    p_tick_name: tickName,
    p_lock_seconds: lockSeconds,
  });

  if (lockError) {
    return { response: jsonErrorResponse(500, `Failed to acquire ${tickName} lock`) };
  }

  const lockToken = readString(lockTokenRaw);
  if (!lockToken) {
    return { response: jsonErrorResponse(409, `${tickName} is already running`) };
  }

  let released = false;
  return {
    supabase,
    release: async () => {
      if (released) return;
      released = true;
      try {
        await supabase.rpc("release_tick_lock", {
          p_tick_name: tickName,
          p_lock_token: lockToken,
        });
      } catch {
        // Ignore lock release failures; lock TTL is the fallback.
      }
    },
  };
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function readNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
