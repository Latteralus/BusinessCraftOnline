import { z } from "zod";

export const storeShelfItemFilterSchema = z.object({
  businessId: z.uuid("Business id is invalid.").optional(),
});

export const upsertStoreShelfItemSchema = z.object({
  businessId: z.uuid("Business id is invalid."),
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
});

export const removeStoreShelfItemSchema = z.object({
  shelfItemId: z.uuid("Shelf item id is invalid."),
});
