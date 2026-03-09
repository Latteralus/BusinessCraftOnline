import {
  transferBetweenOwnBusinesses,
  transferBetweenOwnBusinessesSchema,
} from "@/domains/banking";
import { handleAuthedJsonRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  return handleAuthedJsonRequest(
    request,
    transferBetweenOwnBusinessesSchema,
    "Invalid transfer payload.",
    async ({ supabase, user }, data) => {
      const result = await transferBetweenOwnBusinesses(supabase, user.id, data);
      return NextResponse.json(result, { status: 201 });
    },
    { errorMessage: "Transfer failed." }
  );
}
