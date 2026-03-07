import { getAccountsWithBalances } from "@/domains/banking";
import { getCharacter } from "@/domains/auth-character";
import { getBusinessInventory, transferItems, transferItemsSchema } from "@/domains/inventory";
import { badRequest, fail, parseJsonBody, requireAuthedUser } from "@/app/api/_shared/route-helpers";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const auth = await requireAuthedUser();
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const parsed = await parseJsonBody(request, transferItemsSchema, "Invalid transfer payload.");
  if (!parsed.ok) return parsed.response;

  const input = { ...parsed.data };

  if (input.sourceType === "business" && !input.sourceBusinessId) {
    return badRequest("sourceBusinessId is required when sourceType is business.");
  }

  if (input.destinationType === "business" && !input.destinationBusinessId) {
    return badRequest("destinationBusinessId is required when destinationType is business.");
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
        return badRequest("Unable to resolve source business city for transfer.");
      }
      input.sourceCityId = sourceCityId;
    }

    if (input.destinationType === "business" && !input.destinationCityId) {
      return badRequest("destinationCityId is required for business destinations.");
    }

    if (
      input.sourceCityId &&
      input.destinationCityId &&
      input.sourceCityId !== input.destinationCityId
    ) {
      if (!input.fundingAccountId) {
        return badRequest("fundingAccountId is required for cross-city shipping.");
      }

      const accounts = await getAccountsWithBalances(supabase, user.id);
      const fundingAccount = accounts.find((account) => account.id === input.fundingAccountId);

      if (!fundingAccount) {
        return badRequest("Funding account not found.");
      }
    }

    const result = await transferItems(supabase, user.id, input);

    if (result.shippingCost > 0 && input.fundingAccountId) {
      const accounts = await getAccountsWithBalances(supabase, user.id);
      const fundingAccount = accounts.find((account) => account.id === input.fundingAccountId);

      if (!fundingAccount) {
        return badRequest("Funding account not found.");
      }

      if (fundingAccount.balance < result.shippingCost) {
        return badRequest("Insufficient funds in selected funding account for shipping cost.");
      }
    }

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return fail(error, "Transfer failed.");
  }
}
