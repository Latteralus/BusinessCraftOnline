import { z } from "zod";
import { getStorefrontTrafficMultiplierBounds } from "@/config/market";
import { MARKET_BUY_ORDER_STATUSES, MARKET_LISTING_STATUSES } from "./types";

const marketListingStatusSchema = z.enum(MARKET_LISTING_STATUSES);
const marketListingSourceTypeSchema = z.enum(["business", "personal"]);
const marketBuyOrderStatusSchema = z.enum(MARKET_BUY_ORDER_STATUSES);
const marketBuyOrderPurchaserTypeSchema = z.enum(["business", "personal"]);
const storefrontTrafficBounds = getStorefrontTrafficMultiplierBounds();

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
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});

export const createMarketListingSchema = z
  .object({
    sourceType: marketListingSourceTypeSchema,
    sourceBusinessId: z.uuid("Business id is invalid.").optional(),
    itemKey: z
      .string({ error: "Item key is required." })
      .trim()
      .min(1, "Item key is required.")
      .max(64, "Item key must be 64 characters or less."),
    quality: z
      .number({ error: "Quality must be a number." })
      .int("Quality must be an integer.")
      .min(0, "Quality must be at least 0.")
      .max(100, "Quality must be at most 100."),
    quantity: z
      .number({ error: "Quantity must be a number." })
      .int("Quantity must be an integer.")
      .min(1, "Quantity must be at least 1."),
    unitPrice: z
      .number({ error: "Unit price must be a number." })
      .positive("Unit price must be greater than 0."),
    expiresAt: z.iso.datetime().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.sourceType === "business" && !value.sourceBusinessId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceBusinessId"],
        message: "Business id is required when listing from a business.",
      });
    }
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

export const marketBuyOrderFilterSchema = z.object({
  cityId: z.uuid("City id is invalid.").optional(),
  itemKey: z
    .string()
    .trim()
    .min(1, "Item key is required.")
    .max(64, "Item key must be 64 characters or less.")
    .optional(),
  status: marketBuyOrderStatusSchema.optional(),
  ownOnly: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});

export const createMarketBuyOrderSchema = z
  .object({
    purchaserType: marketBuyOrderPurchaserTypeSchema,
    purchaserBusinessId: z.uuid("Business id is invalid.").optional(),
    itemKey: z
      .string({ error: "Item key is required." })
      .trim()
      .min(1, "Item key is required.")
      .max(64, "Item key must be 64 characters or less."),
    qualityMin: z
      .number({ error: "Minimum quality must be a number." })
      .int("Minimum quality must be an integer.")
      .min(1, "Minimum quality must be at least 1.")
      .max(100, "Minimum quality must be at most 100."),
    qualityMax: z
      .number({ error: "Maximum quality must be a number." })
      .int("Maximum quality must be an integer.")
      .min(1, "Maximum quality must be at least 1.")
      .max(100, "Maximum quality must be at most 100."),
    quantity: z
      .number({ error: "Quantity must be a number." })
      .int("Quantity must be an integer.")
      .min(1, "Quantity must be at least 1."),
    maxUnitPrice: z
      .number({ error: "Max unit price must be a number." })
      .positive("Max unit price must be greater than 0."),
    expiresAt: z.iso.datetime().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.purchaserType === "business" && !value.purchaserBusinessId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["purchaserBusinessId"],
        message: "Business id is required when purchasing through a business.",
      });
    }
    if (value.qualityMax < value.qualityMin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["qualityMax"],
        message: "Maximum quality must be greater than or equal to minimum quality.",
      });
    }
  });

export const marketBuyOrderIdSchema = z.object({
  buyOrderId: z.uuid("Buy order id is invalid."),
});

export const cancelMarketBuyOrderSchema = marketBuyOrderIdSchema;

export const fulfillMarketBuyOrderSchema = z
  .object({
    buyOrderId: z.uuid("Buy order id is invalid."),
    quantity: z
      .number({ error: "Quantity must be a number." })
      .int("Quantity must be an integer.")
      .min(1, "Quantity must be at least 1."),
    sourceType: marketBuyOrderPurchaserTypeSchema,
    sourceBusinessId: z.uuid("Business id is invalid.").optional(),
    sourceBusinessInventoryId: z.uuid("Source inventory id is invalid.").optional(),
    sourcePersonalInventoryId: z.uuid("Source inventory id is invalid.").optional(),
  })
  .superRefine((value, ctx) => {
    if (value.sourceType === "business" && (!value.sourceBusinessId || !value.sourceBusinessInventoryId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceBusinessInventoryId"],
        message: "Business id and source inventory id are required when fulfilling from a business.",
      });
    }
    if (value.sourceType === "personal" && !value.sourcePersonalInventoryId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourcePersonalInventoryId"],
        message: "Source inventory id is required when fulfilling from personal inventory.",
      });
    }
  });

export const marketStorefrontFilterSchema = z.object({
  businessId: z.uuid("Business id is invalid.").optional(),
});

export const updateMarketStorefrontSettingsSchema = z.object({
  businessId: z.uuid("Business id is invalid."),
  adBudgetPerTick: z
    .number({ error: "Ad budget per minute must be a number." })
    .min(0, "Ad budget per minute cannot be negative."),
  trafficMultiplier: z
    .number({ error: "Traffic multiplier must be a number." })
    .min(
      storefrontTrafficBounds.min,
      `Traffic multiplier must be at least ${storefrontTrafficBounds.min}.`
    )
    .max(
      storefrontTrafficBounds.max,
      `Traffic multiplier must be at most ${storefrontTrafficBounds.max}.`
    ),
  isAdEnabled: z.boolean({ error: "Ad enabled flag must be true or false." }),
});

export type MarketListingFilterInput = z.infer<typeof marketListingFilterSchema>;
export type CreateMarketListingInput = z.infer<typeof createMarketListingSchema>;
export type CancelMarketListingInput = z.infer<typeof cancelMarketListingSchema>;
export type BuyMarketListingInput = z.infer<typeof buyMarketListingSchema>;
export type MarketBuyOrderFilterInput = z.infer<typeof marketBuyOrderFilterSchema>;
export type CreateMarketBuyOrderInput = z.infer<typeof createMarketBuyOrderSchema>;
export type CancelMarketBuyOrderInput = z.infer<typeof cancelMarketBuyOrderSchema>;
export type FulfillMarketBuyOrderInput = z.infer<typeof fulfillMarketBuyOrderSchema>;
export type MarketStorefrontFilterInput = z.infer<typeof marketStorefrontFilterSchema>;
export type UpdateMarketStorefrontSettingsInput = z.infer<typeof updateMarketStorefrontSettingsSchema>;
