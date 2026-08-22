import {
  type BankingLoanState,
  applyForLoan,
  applyForLoanSchema,
  calculateMaxLoanForBusinessLevel,
  getLoanSummary,
} from "@/domains/banking";
import { getCharacter } from "@/domains/auth-character";
import { handleAuthedRequest, notFound, parseJsonBody } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function GET() {
  return handleAuthedRequest(async ({ supabase, user }) => {
    const character = await getCharacter(supabase, user.id);
    if (!character) {
      return notFound("Character not found.");
    }

    const summary = await getLoanSummary(supabase, user.id, character.business_level);
    const response: BankingLoanState = {
      summary,
      maxLoanAvailable: calculateMaxLoanForBusinessLevel(character.business_level),
    };
    return NextResponse.json(response);
  }, { errorMessage: "Failed to fetch loan state.", errorStatus: 500 });
}

export async function POST(request: Request) {
  return handleAuthedRequest(async ({ supabase, user }) => {
    const character = await getCharacter(supabase, user.id);
    if (!character) {
      return notFound("Character not found.");
    }

    const parsed = await parseJsonBody(request, applyForLoanSchema, "Invalid loan request.");
    if (!parsed.ok) {
      return parsed.response;
    }

    const loan = await applyForLoan(supabase, user.id, parsed.data, {
      businessLevel: character.business_level,
    });
    return NextResponse.json({ loan }, { status: 201 });
  }, { errorMessage: "Failed to apply for loan." });
}
