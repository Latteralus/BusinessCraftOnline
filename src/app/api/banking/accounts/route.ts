import { getBankingSnapshot, type BankingAccountsPayload } from "@/domains/banking";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { withTiming } from "@/lib/server-timing";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    return await withTiming("api-route", "/api/banking/accounts GET", async (timing) => {
      const snapshot = await timing.measure("banking-snapshot", () => getBankingSnapshot(supabase, user.id));
      const response: BankingAccountsPayload = snapshot;
      return NextResponse.json(response);
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch accounts." },
      { status: 500 }
    );
  }
}
