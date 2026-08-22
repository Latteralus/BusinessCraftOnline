import { retoolManufacturingLine, retoolManufacturingLineSchema } from "@/domains/production";
import { handleAuthedJsonRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  return handleAuthedJsonRequest(
    request,
    retoolManufacturingLineSchema,
    "Invalid line retool payload.",
    async ({ supabase, user }, data) => {
      const line = await retoolManufacturingLine(supabase, user.id, data);
      return NextResponse.json({ line });
    },
    { errorMessage: "Failed to retool manufacturing line." }
  );
}
