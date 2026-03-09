import { settleEmployeeWages } from "@/domains/employees";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";
import { z } from "zod";

const settleEmployeeWagesSchema = z.object({
  employeeId: z.uuid("Employee id is invalid."),
});

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = settleEmployeeWagesSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid settlement payload." },
      { status: 400 }
    );
  }

  try {
    const employee = await settleEmployeeWages(supabase, user.id, parsed.data);
    return NextResponse.json({ employee });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to settle employee wages." },
      { status: 400 }
    );
  }
}
