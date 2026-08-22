import { ensureExtractionSlots, getProductionStatus, productionStatusQuerySchema } from "@/domains/production";
import { badRequest, handleAuthedJsonRequest, handleAuthedRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  return handleAuthedRequest(async ({ supabase, user }) => {
    const url = new URL(request.url);
    const parsed = productionStatusQuerySchema.safeParse({
      businessId: url.searchParams.get("businessId") ?? "",
    });

    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "Invalid production query.");
    }

    const status = await getProductionStatus(supabase, user.id, parsed.data.businessId);
    return NextResponse.json({ status });
  }, { errorMessage: "Failed to load production status." });
}

export async function POST(request: Request) {
  return handleAuthedJsonRequest(
    request,
    productionStatusQuerySchema,
    "Invalid production payload.",
    async ({ supabase, user }, data) => {
      const slots = await ensureExtractionSlots(supabase, user.id, data.businessId);
      return NextResponse.json({ slots });
    },
    { errorMessage: "Failed to initialize extraction slots." }
  );
}
