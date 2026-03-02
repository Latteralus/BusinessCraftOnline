import { setExtractionSlotStatus, setExtractionSlotStatusSchema } from "@/domains/production";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = setExtractionSlotStatusSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid slot status payload." },
      { status: 400 }
    );
  }

  try {
    const slot = await setExtractionSlotStatus(supabase, user.id, parsed.data);
    return NextResponse.json({ slot });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update slot status." },
      { status: 400 }
    );
  }
}

