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
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = manufacturingStatusQuerySchema.safeParse({
    businessId: url.searchParams.get("businessId") ?? "",
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid manufacturing query." },
      { status: 400 }
    );
  }

  try {
    const status = await getManufacturingStatus(supabase, user.id, parsed.data.businessId);
    return NextResponse.json({ status });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load manufacturing status." },
      { status: 400 }
    );
  }
}

export async function PATCH(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = setManufacturingRecipeSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid manufacturing recipe payload." },
      { status: 400 }
    );
  }

  try {
    const status = await setManufacturingRecipe(supabase, user.id, parsed.data);
    return NextResponse.json({ status });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to set manufacturing recipe." },
      { status: 400 }
    );
  }
}

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);

  if (payload?.action === "start") {
    const parsed = startManufacturingSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid manufacturing start payload." },
        { status: 400 }
      );
    }

    try {
      const status = await startManufacturing(supabase, user.id, parsed.data);
      return NextResponse.json({ status });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to start manufacturing." },
        { status: 400 }
      );
    }
  }

  if (payload?.action === "stop") {
    const parsed = stopManufacturingSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid manufacturing stop payload." },
        { status: 400 }
      );
    }

    try {
      const status = await stopManufacturing(supabase, user.id, parsed.data);
      return NextResponse.json({ status });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to stop manufacturing." },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
}

