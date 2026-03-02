import { purchaseUpgrade, purchaseUpgradeSchema } from "@/domains/businesses";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

type Params = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;

  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = purchaseUpgradeSchema.safeParse({
    businessId: id,
    upgradeKey: payload?.upgradeKey,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid upgrade payload." },
      { status: 400 }
    );
  }

  try {
    const result = await purchaseUpgrade(
      supabase,
      user.id,
      parsed.data.businessId,
      parsed.data.upgradeKey
    );

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to purchase upgrade." },
      { status: 400 }
    );
  }
}
