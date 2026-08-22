import { setManufacturingLineStatus, setManufacturingLineStatusSchema } from "@/domains/production";
import { handleAuthedJsonRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  return handleAuthedJsonRequest(
    request,
    setManufacturingLineStatusSchema,
    "Invalid line status payload.",
    async ({ supabase, user }, data) => {
      const line = await setManufacturingLineStatus(supabase, user.id, data);
      return NextResponse.json({ line });
    },
    { errorMessage: "Failed to update manufacturing line status." }
  );
}
