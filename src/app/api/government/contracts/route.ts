import {
  getGovernmentContracts,
  governmentContractListFilterSchema,
  type GovernmentContractsResponse,
} from "@/domains/government";
import { badRequest, handleAuthedRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  return handleAuthedRequest(async ({ supabase }) => {
    const url = new URL(request.url);
    const parsed = governmentContractListFilterSchema.safeParse({
      cityId: url.searchParams.get("cityId") ?? undefined,
      providerId: url.searchParams.get("providerId") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      businessId: url.searchParams.get("businessId") ?? undefined,
    });

    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "Invalid contracts query.");
    }

    const contracts = await getGovernmentContracts(supabase, parsed.data);
    const response: GovernmentContractsResponse = { contracts };
    return NextResponse.json(response);
  }, { errorMessage: "Failed to load government contracts.", errorStatus: 500 });
}
