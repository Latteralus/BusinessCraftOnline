import { setExtractionSlotStatus, setExtractionSlotStatusSchema } from "@/domains/production";
import { handleAuthedJsonRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  return handleAuthedJsonRequest(
    request,
    setExtractionSlotStatusSchema,
    "Invalid slot status payload.",
    async ({ supabase, user }, data) => {
      const slot = await setExtractionSlotStatus(supabase, user.id, data);
      return NextResponse.json({ slot });
    },
    { errorMessage: "Failed to update slot status." }
  );
}
