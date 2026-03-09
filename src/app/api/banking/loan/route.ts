import {
  type BankingLoanState,
  applyForLoan,
  applyForLoanSchema,
  calculateMaxLoanForBusinessLevel,
  getLoanSummary,
} from "@/domains/banking";
import { getCharacter } from "@/domains/auth-character";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const character = await getCharacter(supabase, user.id);
  if (!character) {
    return NextResponse.json({ error: "Character not found." }, { status: 404 });
  }

  try {
    const summary = await getLoanSummary(supabase, user.id, character.business_level);
    const response: BankingLoanState = {
      summary,
      maxLoanAvailable: calculateMaxLoanForBusinessLevel(character.business_level),
    };
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch loan state." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const character = await getCharacter(supabase, user.id);
  if (!character) {
    return NextResponse.json({ error: "Character not found." }, { status: 404 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = applyForLoanSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid loan request." },
      { status: 400 }
    );
  }

  try {
    const loan = await applyForLoan(supabase, user.id, parsed.data, {
      businessLevel: character.business_level,
    });
    return NextResponse.json({ loan }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to apply for loan." },
      { status: 400 }
    );
  }
}
