import {
  getTransactionHistory,
  transactionHistoryFilterSchema,
  type BankingTransactionsPayload,
} from "@/domains/banking";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const parsed = transactionHistoryFilterSchema.safeParse({
    accountId: searchParams.get("accountId") ?? undefined,
    direction: searchParams.get("direction") ?? undefined,
    transactionType: searchParams.get("transactionType") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid history filters." },
      { status: 400 }
    );
  }

  try {
    const entries = await getTransactionHistory(supabase, user.id, parsed.data);
    const response: BankingTransactionsPayload = { entries };
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load transaction history.",
      },
      { status: 400 }
    );
  }
}
