import { ensureExtractionSlots, getProductionStatus, productionStatusQuerySchema } from "@/domains/production";
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
  const parsed = productionStatusQuerySchema.safeParse({
    businessId: url.searchParams.get("businessId") ?? "",
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid production query." },
      { status: 400 }
    );
  }

  try {
    const status = await getProductionStatus(supabase, user.id, parsed.data.businessId);
    return NextResponse.json({ status });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load production status." },
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
  const parsed = productionStatusQuerySchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid production payload." },
      { status: 400 }
    );
  }

  try {
    const slots = await ensureExtractionSlots(supabase, user.id, parsed.data.businessId);
    return NextResponse.json({ slots });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to initialize extraction slots." },
      { status: 400 }
    );
  }
}

