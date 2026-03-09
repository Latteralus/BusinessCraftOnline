import { assignManufacturingLine, assignManufacturingLineSchema } from "@/domains/production";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = assignManufacturingLineSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid line assignment payload." },
      { status: 400 }
    );
  }

  try {
    const line = await assignManufacturingLine(supabase, user.id, parsed.data);
    return NextResponse.json({ line });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to assign manufacturing line." },
      { status: 400 }
    );
  }
}
