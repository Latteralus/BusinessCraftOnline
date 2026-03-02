import {
  BUSINESS_ENTITY_TYPES,
  BUSINESS_TYPES,
  BUSINESS_UPGRADE_KEYS,
} from "@/config/businesses";
import { z } from "zod";

const businessTypeSchema = z.enum(BUSINESS_TYPES);
const businessEntityTypeSchema = z.enum(BUSINESS_ENTITY_TYPES);
const businessUpgradeKeySchema = z.enum(BUSINESS_UPGRADE_KEYS);

export const createBusinessSchema = z.object({
  name: z
    .string({ error: "Business name is required." })
    .trim()
    .min(3, "Business name must be at least 3 characters.")
    .max(80, "Business name must be 80 characters or less."),
  type: businessTypeSchema,
  cityId: z.uuid("City id is invalid."),
  entityType: businessEntityTypeSchema.optional(),
});

export const purchaseUpgradeSchema = z.object({
  businessId: z.uuid("Business id is invalid."),
  upgradeKey: businessUpgradeKeySchema,
});

export const businessListFilterSchema = z.object({
  type: businessTypeSchema.optional(),
  cityId: z.uuid("City id is invalid.").optional(),
});

export type CreateBusinessInput = z.infer<typeof createBusinessSchema>;
export type PurchaseUpgradeInput = z.infer<typeof purchaseUpgradeSchema>;
