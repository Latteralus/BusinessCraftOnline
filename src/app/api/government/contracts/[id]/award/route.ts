import { awardGovernmentContract, awardGovernmentContractSchema } from "@/domains/government";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

type Params = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = awardGovernmentContractSchema.safeParse({ ...payload, contractId: id });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid award request." },
      { status: 400 }
    );
  }

  try {
    const contract = await awardGovernmentContract(supabase, user.id, parsed.data);
    return NextResponse.json({ contract });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to award contract." },
      { status: 400 }
    );
  }
}
