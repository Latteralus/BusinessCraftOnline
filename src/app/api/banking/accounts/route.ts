import { getBankingSnapshot, type BankingAccountsPayload } from "@/domains/banking";
import { handleAuthedRequest } from "@/app/api/_shared/route-helpers";
import { withTiming } from "@/lib/server-timing";
import { NextResponse } from "next/server";

export async function GET() {
  return handleAuthedRequest(async ({ supabase, user }) => {
    return withTiming("api-route", "/api/banking/accounts GET", async (timing) => {
      const snapshot = await timing.measure("banking-snapshot", () => getBankingSnapshot(supabase, user.id));
      const response: BankingAccountsPayload = snapshot;
      return NextResponse.json(response);
    });
  }, { errorMessage: "Failed to fetch accounts.", errorStatus: 500 });
}
