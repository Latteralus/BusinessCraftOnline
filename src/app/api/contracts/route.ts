import {
  contractListFilterSchema,
  createContract,
  createContractSchema,
  getContracts,
} from "@/domains/contracts";
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
  const parsed = contractListFilterSchema.safeParse({
    businessId: url.searchParams.get("businessId") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid contracts query." },
      { status: 400 }
    );
  }

  try {
    const contracts = await getContracts(supabase, user.id, parsed.data);
    return NextResponse.json({ contracts });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load contracts." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = createContractSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid contract payload." },
      { status: 400 }
    );
  }

  try {
    const contract = await createContract(supabase, user.id, parsed.data);
    return NextResponse.json({ contract }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create contract." },
      { status: 400 }
    );
  }
}
