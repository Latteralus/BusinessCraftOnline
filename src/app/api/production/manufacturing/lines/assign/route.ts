import { assignManufacturingLine, assignManufacturingLineSchema } from "@/domains/production";
import { handleAuthedJsonRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  return handleAuthedJsonRequest(
    request,
    assignManufacturingLineSchema,
    "Invalid line assignment payload.",
    async ({ supabase, user }, data) => {
      const line = await assignManufacturingLine(supabase, user.id, data);
      return NextResponse.json({ line });
    },
    { errorMessage: "Failed to assign manufacturing line." }
  );
}
