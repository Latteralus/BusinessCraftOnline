import { getContractById } from "@/domains/contracts";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

type Params = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const contract = await getContractById(supabase, user.id, id);

    if (!contract) {
      return NextResponse.json({ error: "Contract not found." }, { status: 404 });
    }

    return NextResponse.json({ contract });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch contract." },
      { status: 500 }
    );
  }
}
