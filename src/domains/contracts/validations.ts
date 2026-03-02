import { z } from "zod";
import { CONTRACT_STATUSES } from "./types";

const contractStatusSchema = z.enum(CONTRACT_STATUSES);

export const contractListFilterSchema = z.object({
  businessId: z.uuid("Business id is invalid.").optional(),
  status: contractStatusSchema.optional(),
});

export const createContractSchema = z.object({
  businessId: z.uuid("Business id is invalid."),
  title: z
    .string({ error: "Title is required." })
    .trim()
    .min(3, "Title must be at least 3 characters.")
    .max(120, "Title must be 120 characters or less."),
  itemKey: z
    .string({ error: "Item key is required." })
    .trim()
    .min(1, "Item key is required.")
    .max(64, "Item key must be 64 characters or less."),
  requiredQuantity: z
    .number({ error: "Required quantity must be a number." })
    .int("Required quantity must be an integer.")
    .min(1, "Required quantity must be at least 1."),
  unitPrice: z
    .number({ error: "Unit price must be a number." })
    .positive("Unit price must be greater than 0."),
  notes: z.string().trim().max(280, "Notes must be 280 characters or less.").optional(),
  expiresAt: z.iso.datetime().optional(),
});

export const contractIdSchema = z.object({
  contractId: z.uuid("Contract id is invalid."),
});

export const acceptContractSchema = contractIdSchema;
export const cancelContractSchema = contractIdSchema;
export const fulfillContractSchema = contractIdSchema;

export type ContractListFilterInput = z.infer<typeof contractListFilterSchema>;
export type CreateContractInput = z.infer<typeof createContractSchema>;
export type AcceptContractInput = z.infer<typeof acceptContractSchema>;
export type CancelContractInput = z.infer<typeof cancelContractSchema>;
export type FulfillContractInput = z.infer<typeof fulfillContractSchema>;
