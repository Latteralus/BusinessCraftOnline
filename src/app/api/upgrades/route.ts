import {
  getUpgradeDefinitions,
  getUpgradeDefinitionsForBusinessType,
  upgradeDefinitionsFilterSchema,
} from "@/domains/upgrades";
import { badRequest, handleAuthedRequest } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  return handleAuthedRequest(async ({ supabase }) => {
    const url = new URL(request.url);
    const parsed = upgradeDefinitionsFilterSchema.safeParse({
      businessType: url.searchParams.get("businessType") ?? undefined,
    });

    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "Invalid upgrade definition filters.");
    }

    const definitions = parsed.data.businessType
      ? await getUpgradeDefinitionsForBusinessType(supabase, parsed.data.businessType)
      : await getUpgradeDefinitions(supabase);

    return NextResponse.json({ definitions });
  }, { errorMessage: "Failed to fetch upgrade definitions.", errorStatus: 500 });
}
