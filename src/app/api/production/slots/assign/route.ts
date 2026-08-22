import { assignExtractionSlot, assignExtractionSlotSchema } from "@/domains/production";
import { handleAuthedJsonRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  return handleAuthedJsonRequest(
    request,
    assignExtractionSlotSchema,
    "Invalid slot assignment payload.",
    async ({ supabase, user }, data) => {
      const slot = await assignExtractionSlot(supabase, user.id, data);
      return NextResponse.json({ slot });
    },
    { errorMessage: "Failed to assign extraction slot." }
  );
}
