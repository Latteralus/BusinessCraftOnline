import { getBusinessById } from "@/domains/businesses";
import type { BusinessType } from "@/config/businesses";
import type { QueryClient } from "@/lib/db/query-client";

export async function ensureOwnedBusiness(
  client: QueryClient,
  playerId: string,
  businessId: string
) {
  const business = await getBusinessById(client, playerId, businessId);
  if (!business) throw new Error("Business not found.");
  return business;
}

export async function ensureOwnedBusinessType<TBusinessType extends BusinessType>(
  client: QueryClient,
  playerId: string,
  businessId: string,
  isAllowedType: (type: BusinessType) => type is TBusinessType,
  onInvalidTypeMessage: (actualType: BusinessType) => string
) {
  const business = await ensureOwnedBusiness(client, playerId, businessId);
  if (!isAllowedType(business.type)) {
    throw new Error(onInvalidTypeMessage(business.type));
  }
  return business as typeof business & { type: TBusinessType };
}

