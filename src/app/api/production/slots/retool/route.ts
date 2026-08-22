import { retoolExtractionSlot, retoolExtractionSlotSchema } from "@/domains/production";
import { handleAuthedJsonRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  return handleAuthedJsonRequest(
    request,
    retoolExtractionSlotSchema,
    "Invalid slot retool payload.",
    async ({ supabase, user }, data) => {
      const slot = await retoolExtractionSlot(supabase, user.id, data);
      return NextResponse.json({ slot });
    },
    { errorMessage: "Failed to retool slot." }
  );
}
