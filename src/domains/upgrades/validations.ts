import { BUSINESS_TYPES, BUSINESS_UPGRADE_KEYS } from "@/config/businesses";
import { z } from "zod";

const businessTypeSchema = z.enum(BUSINESS_TYPES);
const businessUpgradeKeySchema = z.enum(BUSINESS_UPGRADE_KEYS);

export const upgradeDefinitionsFilterSchema = z.object({
  businessType: businessTypeSchema.optional(),
});

export const upgradePreviewRequestSchema = z.object({
  businessId: z.uuid("Business id is invalid."),
  upgradeKey: businessUpgradeKeySchema,
});

export const upgradePreviewInputSchema = z.object({
  upgradeKey: businessUpgradeKeySchema,
  currentLevel: z
    .number({ error: "Current level must be a number." })
    .int("Current level must be an integer.")
    .min(0, "Current level cannot be negative."),
});

export type UpgradeDefinitionsFilterInput = z.infer<typeof upgradeDefinitionsFilterSchema>;
export type UpgradePreviewRequestInput = z.infer<typeof upgradePreviewRequestSchema>;
export type UpgradePreviewInputSchema = z.infer<typeof upgradePreviewInputSchema>;
