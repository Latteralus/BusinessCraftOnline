import {
  getManufacturingStatus,
  manufacturingStatusQuerySchema,
  setManufacturingRecipe,
  setManufacturingRecipeSchema,
  startManufacturing,
  startManufacturingSchema,
  stopManufacturing,
  stopManufacturingSchema,
} from "@/domains/production";
import {
  badRequest,
  fail,
  handleAuthedJsonRequest,
  handleAuthedRequest,
} from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  return handleAuthedRequest(async ({ supabase, user }) => {
    const url = new URL(request.url);
    const parsed = manufacturingStatusQuerySchema.safeParse({
      businessId: url.searchParams.get("businessId") ?? "",
    });

    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "Invalid manufacturing query.");
    }

    const status = await getManufacturingStatus(supabase, user.id, parsed.data.businessId);
    return NextResponse.json({ status });
  }, { errorMessage: "Failed to load manufacturing status." });
}

export async function PATCH(request: Request) {
  return handleAuthedJsonRequest(
    request,
    setManufacturingRecipeSchema,
    "Invalid manufacturing recipe payload.",
    async ({ supabase, user }, data) => {
      const status = await setManufacturingRecipe(supabase, user.id, data);
      return NextResponse.json({ status });
    },
    { errorMessage: "Failed to set manufacturing recipe." }
  );
}

export async function POST(request: Request) {
  return handleAuthedRequest(async ({ supabase, user }) => {
    const payload = await request.json().catch(() => null);

    if (payload?.action === "start") {
      const parsed = startManufacturingSchema.safeParse(payload);
      if (!parsed.success) {
        return badRequest(parsed.error.issues[0]?.message ?? "Invalid manufacturing start payload.");
      }

      try {
        const status = await startManufacturing(supabase, user.id, parsed.data);
        return NextResponse.json({ status });
      } catch (error) {
        return fail(error, "Failed to start manufacturing.");
      }
    }

    if (payload?.action === "stop") {
      const parsed = stopManufacturingSchema.safeParse(payload);
      if (!parsed.success) {
        return badRequest(parsed.error.issues[0]?.message ?? "Invalid manufacturing stop payload.");
      }

      try {
        const status = await stopManufacturing(supabase, user.id, parsed.data);
        return NextResponse.json({ status });
      } catch (error) {
        return fail(error, "Failed to stop manufacturing.");
      }
    }

    return badRequest("Unsupported action.");
  });
}
