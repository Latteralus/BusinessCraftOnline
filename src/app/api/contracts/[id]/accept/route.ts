import { acceptContract, acceptContractSchema } from "@/domains/contracts";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

type Params = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const parsed = acceptContractSchema.safeParse({ contractId: id });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid contract id." },
      { status: 400 }
    );
  }

  try {
    const contract = await acceptContract(supabase, user.id, parsed.data);
    return NextResponse.json({ contract });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to accept contract." },
      { status: 400 }
    );
  }
}
