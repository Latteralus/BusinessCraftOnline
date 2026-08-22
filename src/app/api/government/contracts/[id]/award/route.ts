import { awardGovernmentContract, awardGovernmentContractSchema } from "@/domains/government";
import { badRequest, handleAuthedRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

type Params = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;

  return handleAuthedRequest(async ({ supabase, user }) => {
    const payload = await request.json().catch(() => null);
    const parsed = awardGovernmentContractSchema.safeParse({ ...payload, contractId: id });
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "Invalid award request.");
    }

    const contract = await awardGovernmentContract(supabase, user.id, parsed.data);
    return NextResponse.json({ contract });
  }, { errorMessage: "Failed to award contract." });
}
