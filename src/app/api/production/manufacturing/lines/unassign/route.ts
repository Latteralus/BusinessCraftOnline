import { unassignManufacturingLine, unassignManufacturingLineSchema } from "@/domains/production";
import { handleAuthedJsonRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  return handleAuthedJsonRequest(
    request,
    unassignManufacturingLineSchema,
    "Invalid line unassign payload.",
    async ({ supabase, user }, data) => {
      const line = await unassignManufacturingLine(supabase, user.id, data);
      return NextResponse.json({ line });
    },
    { errorMessage: "Failed to unassign manufacturing line." }
  );
}
