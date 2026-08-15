import {
  transferBetweenPersonalAndBusiness,
  transferBetweenPersonalAndBusinessSchema,
} from "@/domains/banking";
import { handleAuthedJsonRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  return handleAuthedJsonRequest(
    request,
    transferBetweenPersonalAndBusinessSchema,
    "Invalid transfer payload.",
    async ({ supabase, user }, data) => {
      const result = await transferBetweenPersonalAndBusiness(supabase, user.id, data);
      return NextResponse.json(result, { status: 201 });
    },
    { errorMessage: "Transfer failed." }
  );
}
