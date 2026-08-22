import { deliverGovernmentContract, deliverGovernmentContractSchema } from "@/domains/government";
import { badRequest, handleAuthedRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

type Params = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;

  return handleAuthedRequest(async ({ supabase, user }) => {
    const payload = await request.json().catch(() => null);
    const parsed = deliverGovernmentContractSchema.safeParse({ ...payload, contractId: id });
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "Invalid delivery request.");
    }

    const result = await deliverGovernmentContract(supabase, user.id, parsed.data);
    return NextResponse.json(result);
  }, { errorMessage: "Failed to deliver against contract." });
}
