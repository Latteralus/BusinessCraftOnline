import { z } from "zod";
import { MARKET_LISTING_STATUSES } from "./types";

const marketListingStatusSchema = z.enum(MARKET_LISTING_STATUSES);

export const marketListingFilterSchema = z.object({
  cityId: z.uuid("City id is invalid.").optional(),
  itemKey: z
    .string()
    .trim()
    .min(1, "Item key is required.")
    .max(64, "Item key must be 64 characters or less.")
    .optional(),
  status: marketListingStatusSchema.optional(),
  ownOnly: z.boolean().optional(),
});

export const createMarketListingSchema = z.object({
  sourceBusinessId: z.uuid("Business id is invalid."),
  itemKey: z
    .string({ error: "Item key is required." })
    .trim()
    .min(1, "Item key is required.")
    .max(64, "Item key must be 64 characters or less."),
  quality: z
    .number({ error: "Quality must be a number." })
    .int("Quality must be an integer.")
    .min(1, "Quality must be at least 1.")
    .max(100, "Quality must be at most 100."),
  quantity: z
    .number({ error: "Quantity must be a number." })
    .int("Quantity must be an integer.")
    .min(1, "Quantity must be at least 1."),
  unitPrice: z
    .number({ error: "Unit price must be a number." })
    .positive("Unit price must be greater than 0."),
  expiresAt: z.iso.datetime().optional(),
});

export const marketListingIdSchema = z.object({
  listingId: z.uuid("Listing id is invalid."),
});

export const cancelMarketListingSchema = marketListingIdSchema;

export const buyMarketListingSchema = z.object({
  listingId: z.uuid("Listing id is invalid."),
  quantity: z
    .number({ error: "Quantity must be a number." })
    .int("Quantity must be an integer.")
    .min(1, "Quantity must be at least 1."),
  buyerBusinessId: z.uuid("Buyer business id is invalid."),
});

export const marketStorefrontFilterSchema = z.object({
  businessId: z.uuid("Business id is invalid.").optional(),
});

export const updateMarketStorefrontSettingsSchema = z.object({
  businessId: z.uuid("Business id is invalid."),
  adBudgetPerTick: z
    .number({ error: "Ad budget per tick must be a number." })
    .min(0, "Ad budget per tick cannot be negative."),
  trafficMultiplier: z
    .number({ error: "Traffic multiplier must be a number." })
    .min(0.5, "Traffic multiplier must be at least 0.5.")
    .max(3, "Traffic multiplier must be at most 3."),
  isAdEnabled: z.boolean({ error: "Ad enabled flag must be true or false." }),
});

export type MarketListingFilterInput = z.infer<typeof marketListingFilterSchema>;
export type CreateMarketListingInput = z.infer<typeof createMarketListingSchema>;
export type CancelMarketListingInput = z.infer<typeof cancelMarketListingSchema>;
export type BuyMarketListingInput = z.infer<typeof buyMarketListingSchema>;
export type MarketStorefrontFilterInput = z.infer<typeof marketStorefrontFilterSchema>;
export type UpdateMarketStorefrontSettingsInput = z.infer<typeof updateMarketStorefrontSettingsSchema>;
