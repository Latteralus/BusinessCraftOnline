import { getAccountsWithBalances } from "@/domains/banking";
import { getCharacter } from "@/domains/auth-character";
import { getBusinessInventory, transferItems, transferItemsSchema } from "@/domains/inventory";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = transferItemsSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid transfer payload." },
      { status: 400 }
    );
  }

  const input = { ...parsed.data };

  if (input.sourceType === "business" && !input.sourceBusinessId) {
    return NextResponse.json(
      { error: "sourceBusinessId is required when sourceType is business." },
      { status: 400 }
    );
  }

  if (input.destinationType === "business" && !input.destinationBusinessId) {
    return NextResponse.json(
      { error: "destinationBusinessId is required when destinationType is business." },
      { status: 400 }
    );
  }

  try {
    const character = await getCharacter(supabase, user.id);
    const currentCityId = character?.current_city_id ?? undefined;

    if (input.sourceType === "personal") {
      input.sourceCityId = currentCityId;
    }

    if (input.destinationType === "personal") {
      input.destinationCityId = currentCityId;
    }

    if (input.sourceType === "business" && input.sourceBusinessId) {
      const sourceRows = await getBusinessInventory(supabase, user.id, input.sourceBusinessId);
      const sourceCityId = sourceRows[0]?.city_id;
      if (!sourceCityId) {
        return NextResponse.json(
          { error: "Unable to resolve source business city for transfer." },
          { status: 400 }
        );
      }
      input.sourceCityId = sourceCityId;
    }

    if (input.destinationType === "business" && !input.destinationCityId) {
      return NextResponse.json(
        { error: "destinationCityId is required for business destinations." },
        { status: 400 }
      );
    }

    if (
      input.sourceCityId &&
      input.destinationCityId &&
      input.sourceCityId !== input.destinationCityId
    ) {
      if (!input.fundingAccountId) {
        return NextResponse.json(
          { error: "fundingAccountId is required for cross-city shipping." },
          { status: 400 }
        );
      }

      const accounts = await getAccountsWithBalances(supabase, user.id);
      const fundingAccount = accounts.find((account) => account.id === input.fundingAccountId);

      if (!fundingAccount) {
        return NextResponse.json({ error: "Funding account not found." }, { status: 400 });
      }
    }

    const result = await transferItems(supabase, user.id, input);

    if (result.shippingCost > 0 && input.fundingAccountId) {
      const accounts = await getAccountsWithBalances(supabase, user.id);
      const fundingAccount = accounts.find((account) => account.id === input.fundingAccountId);

      if (!fundingAccount) {
        return NextResponse.json({ error: "Funding account not found." }, { status: 400 });
      }

      if (fundingAccount.balance < result.shippingCost) {
        return NextResponse.json(
          { error: "Insufficient funds in selected funding account for shipping cost." },
          { status: 400 }
        );
      }
    }

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Transfer failed." },
      { status: 400 }
    );
  }
}

