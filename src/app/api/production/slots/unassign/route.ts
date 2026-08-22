import { unassignExtractionSlot, unassignExtractionSlotSchema } from "@/domains/production";
import { handleAuthedJsonRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  return handleAuthedJsonRequest(
    request,
    unassignExtractionSlotSchema,
    "Invalid slot unassign payload.",
    async ({ supabase, user }, data) => {
      const slot = await unassignExtractionSlot(supabase, user.id, data);
      return NextResponse.json({ slot });
    },
    { errorMessage: "Failed to unassign extraction slot." }
  );
}
