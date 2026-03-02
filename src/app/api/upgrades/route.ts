import {
  getUpgradeDefinitions,
  getUpgradeDefinitionsForBusinessType,
  upgradeDefinitionsFilterSchema,
} from "@/domains/upgrades";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = upgradeDefinitionsFilterSchema.safeParse({
    businessType: url.searchParams.get("businessType") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid upgrade definition filters." },
      { status: 400 }
    );
  }

  try {
    const definitions = parsed.data.businessType
      ? await getUpgradeDefinitionsForBusinessType(supabase, parsed.data.businessType)
      : await getUpgradeDefinitions(supabase);

    return NextResponse.json({ definitions });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch upgrade definitions." },
      { status: 500 }
    );
  }
}

