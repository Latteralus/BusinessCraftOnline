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
  parseJsonBody,
  requireAuthedUser,
} from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const auth = await requireAuthedUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const url = new URL(request.url);
  const parsed = manufacturingStatusQuerySchema.safeParse({
    businessId: url.searchParams.get("businessId") ?? "",
  });

  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Invalid manufacturing query.");
  }

  try {
    const status = await getManufacturingStatus(supabase, user.id, parsed.data.businessId);
    return NextResponse.json({ status });
  } catch (error) {
    return fail(error, "Failed to load manufacturing status.");
  }
}

export async function PATCH(request: Request) {
  const auth = await requireAuthedUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const parsed = await parseJsonBody(
    request,
    setManufacturingRecipeSchema,
    "Invalid manufacturing recipe payload."
  );
  if (!parsed.ok) return parsed.response;

  try {
    const status = await setManufacturingRecipe(supabase, user.id, parsed.data);
    return NextResponse.json({ status });
  } catch (error) {
    return fail(error, "Failed to set manufacturing recipe.");
  }
}

export async function POST(request: Request) {
  const auth = await requireAuthedUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

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
}
