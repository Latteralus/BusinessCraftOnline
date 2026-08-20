import { z } from "zod";
import { GOVERNMENT_CONTRACT_STATUSES } from "./types";

const governmentContractStatusSchema = z.enum(GOVERNMENT_CONTRACT_STATUSES);

export const governmentContractListFilterSchema = z.object({
  cityId: z.uuid("City id is invalid.").optional(),
  providerId: z.uuid("Provider id is invalid.").optional(),
  status: governmentContractStatusSchema.optional(),
  businessId: z.uuid("Business id is invalid.").optional(),
});

export const governmentContractIdSchema = z.object({
  contractId: z.uuid("Contract id is invalid."),
});

export const awardGovernmentContractSchema = z.object({
  contractId: z.uuid("Contract id is invalid."),
  businessId: z.uuid("Business id is invalid."),
});

export const deliverGovernmentContractSchema = z.object({
  contractId: z.uuid("Contract id is invalid."),
  quantity: z
    .number({ error: "Quantity must be a number." })
    .positive("Quantity must be greater than 0."),
});

export type GovernmentContractListFilterInput = z.infer<typeof governmentContractListFilterSchema>;
export type AwardGovernmentContractInput = z.infer<typeof awardGovernmentContractSchema>;
export type DeliverGovernmentContractInput = z.infer<typeof deliverGovernmentContractSchema>;
