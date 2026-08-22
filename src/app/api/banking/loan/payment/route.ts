import { payLoan, payLoanSchema } from "@/domains/banking";
import { handleAuthedJsonRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  return handleAuthedJsonRequest(
    request,
    payLoanSchema,
    "Invalid payment payload.",
    async ({ supabase, user }, data) => {
      const result = await payLoan(supabase, user.id, data);
      return NextResponse.json(result, { status: 201 });
    },
    { errorMessage: "Loan payment failed." }
  );
}
