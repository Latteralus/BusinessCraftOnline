import { reactivateEmployee, reactivateEmployeeSchema } from "@/domains/employees";
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
  const parsed = reactivateEmployeeSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid reactivation payload." },
      { status: 400 }
    );
  }

  try {
    const employee = await reactivateEmployee(supabase, user.id, parsed.data);
    return NextResponse.json({ employee });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to reactivate employee." },
      { status: 400 }
    );
  }
}
