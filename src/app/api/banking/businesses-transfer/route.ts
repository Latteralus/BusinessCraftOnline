import {
  transferBetweenOwnBusinesses,
  transferBetweenOwnBusinessesSchema,
} from "@/domains/banking";
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
  const parsed = transferBetweenOwnBusinessesSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid transfer payload." },
      { status: 400 }
    );
  }

  try {
    const result = await transferBetweenOwnBusinesses(supabase, user.id, parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Transfer failed." },
      { status: 400 }
    );
  }
}
