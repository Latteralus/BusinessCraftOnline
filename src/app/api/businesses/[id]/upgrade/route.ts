import { purchaseUpgrade, purchaseUpgradeSchema } from "@/domains/businesses";
import { badRequest, handleAuthedRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

type Params = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;

  return handleAuthedRequest(async ({ supabase, user }) => {
    const payload = await request.json().catch(() => null);
    const parsed = purchaseUpgradeSchema.safeParse({
      businessId: id,
      upgradeKey: payload?.upgradeKey,
    });

    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "Invalid upgrade payload.");
    }

    const result = await purchaseUpgrade(
      supabase,
      user.id,
      parsed.data.businessId,
      parsed.data.upgradeKey
    );

    return NextResponse.json(result, { status: 201 });
  }, { errorMessage: "Failed to purchase upgrade." });
}
