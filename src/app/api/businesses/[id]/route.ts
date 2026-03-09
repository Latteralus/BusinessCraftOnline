import { getBusinessDetail } from "@/domains/businesses";
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
    const business = await getBusinessDetail(supabase, user.id, id);

    if (!business) {
      return NextResponse.json({ error: "Business not found." }, { status: 404 });
    }

    return NextResponse.json({ business });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch business." },
      { status: 500 }
    );
  }
}
