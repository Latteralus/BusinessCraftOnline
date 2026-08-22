import {
  contractListFilterSchema,
  createContract,
  createContractSchema,
  getContracts,
} from "@/domains/contracts";
import { badRequest, handleAuthedJsonRequest, handleAuthedRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  return handleAuthedRequest(async ({ supabase, user }) => {
    const url = new URL(request.url);
    const parsed = contractListFilterSchema.safeParse({
      businessId: url.searchParams.get("businessId") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
    });

    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "Invalid contracts query.");
    }

    const contracts = await getContracts(supabase, user.id, parsed.data);
    return NextResponse.json({ contracts });
  }, { errorMessage: "Failed to load contracts.", errorStatus: 500 });
}

export async function POST(request: Request) {
  return handleAuthedJsonRequest(
    request,
    createContractSchema,
    "Invalid contract payload.",
    async ({ supabase, user }, data) => {
      const contract = await createContract(supabase, user.id, data);
      return NextResponse.json({ contract }, { status: 201 });
    },
    { errorMessage: "Failed to create contract." }
  );
}
