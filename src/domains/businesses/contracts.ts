import type { Business, BusinessSummary, BusinessWithBalance } from "./types";

export type BusinessesPayload = {
  businesses: BusinessWithBalance[];
  summary: BusinessSummary;
};

export type BusinessesResponse = BusinessesPayload & {
  error?: string;
};

export type CreateBusinessResponse = {
  business: Business;
  error?: string;
};
