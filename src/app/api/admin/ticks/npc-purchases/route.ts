import { handleAdminRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function POST() {
  return handleAdminRequest(async () => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const tickSecret = process.env.TICK_FUNCTION_SECRET ?? "";

    if (!supabaseUrl || !tickSecret) {
      return NextResponse.json(
        { error: "Missing NEXT_PUBLIC_SUPABASE_URL or TICK_FUNCTION_SECRET." },
        { status: 500 }
      );
    }

    const response = await fetch(`${supabaseUrl}/functions/v1/tick-npc-purchases`, {
      method: "POST",
      headers: {
        "x-tick-secret": tickSecret,
      },
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) {
      return NextResponse.json(
        {
          error:
            typeof payload?.error === "string"
              ? payload.error
              : "Failed to trigger tick-npc-purchases.",
          payload,
        },
        { status: response.status }
      );
    }

    return NextResponse.json({
      ok: true,
      payload,
      triggeredAt: new Date().toISOString(),
    });
  }, {
    errorMessage: "Failed to trigger tick-npc-purchases.",
    errorStatus: 500,
  });
}
