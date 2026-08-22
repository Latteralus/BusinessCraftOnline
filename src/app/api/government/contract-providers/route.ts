import { getGovernmentContractProviders, type GovernmentContractProvidersResponse } from "@/domains/government";
import { handleAuthedRequest } from "@/app/api/_shared/route-helpers";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  return handleAuthedRequest(async ({ supabase }) => {
    const cityId = request.nextUrl.searchParams.get("cityId") ?? undefined;
    const providers = await getGovernmentContractProviders(supabase, { cityId });
    const response: GovernmentContractProvidersResponse = { providers };
    return NextResponse.json(response);
  });
}
