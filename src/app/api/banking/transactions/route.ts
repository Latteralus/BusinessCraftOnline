import {
  getTransactionHistory,
  transactionHistoryFilterSchema,
  type BankingTransactionsPayload,
} from "@/domains/banking";
import { badRequest, handleAuthedRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  return handleAuthedRequest(async ({ supabase, user }) => {
    const { searchParams } = new URL(request.url);
    const parsed = transactionHistoryFilterSchema.safeParse({
      accountId: searchParams.get("accountId") ?? undefined,
      direction: searchParams.get("direction") ?? undefined,
      transactionType: searchParams.get("transactionType") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
    });

    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "Invalid history filters.");
    }

    const entries = await getTransactionHistory(supabase, user.id, parsed.data);
    const response: BankingTransactionsPayload = { entries };
    return NextResponse.json(response);
  }, { errorMessage: "Failed to load transaction history." });
}
