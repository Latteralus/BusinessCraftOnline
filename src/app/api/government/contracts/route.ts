import {
  getGovernmentContracts,
  governmentContractListFilterSchema,
  type GovernmentContractsResponse,
} from "@/domains/government";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = governmentContractListFilterSchema.safeParse({
    cityId: url.searchParams.get("cityId") ?? undefined,
    providerId: url.searchParams.get("providerId") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    businessId: url.searchParams.get("businessId") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid contracts query." },
      { status: 400 }
    );
  }

  try {
    const contracts = await getGovernmentContracts(supabase, parsed.data);
    const response: GovernmentContractsResponse = { contracts };
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load government contracts." },
      { status: 500 }
    );
  }
}
