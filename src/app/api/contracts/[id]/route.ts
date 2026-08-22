import { getContractById } from "@/domains/contracts";
import { handleAuthedRequest, notFound } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

type Params = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;

  return handleAuthedRequest(async ({ supabase, user }) => {
    const contract = await getContractById(supabase, user.id, id);

    if (!contract) {
      return notFound("Contract not found.");
    }

    return NextResponse.json({ contract });
  }, { errorMessage: "Failed to fetch contract.", errorStatus: 500 });
}
