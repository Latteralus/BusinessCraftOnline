import { installToolForSlot, installToolSchema } from "@/domains/production";
import { handleAuthedJsonRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  return handleAuthedJsonRequest(
    request,
    installToolSchema,
    "Invalid install tool payload.",
    async ({ supabase, user }, data) => {
      const result = await installToolForSlot(supabase, user.id, data);
      return NextResponse.json(result);
    },
    { errorMessage: "Failed to install tool." }
  );
}
