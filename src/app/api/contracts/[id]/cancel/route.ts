import { cancelContract, cancelContractSchema } from "@/domains/contracts";
import { badRequest, handleAuthedRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

type Params = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;

  return handleAuthedRequest(async ({ supabase, user }) => {
    const parsed = cancelContractSchema.safeParse({ contractId: id });
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "Invalid contract id.");
    }

    const contract = await cancelContract(supabase, user.id, parsed.data);
    return NextResponse.json({ contract });
  }, { errorMessage: "Failed to cancel contract." });
}
