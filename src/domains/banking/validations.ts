import {
  BANK_ACCOUNT_TYPES,
  TRANSACTION_DIRECTIONS,
  TRANSACTION_HISTORY_DEFAULT_LIMIT,
  TRANSACTION_HISTORY_MAX_LIMIT,
  TRANSACTION_TYPES,
} from "@/config/banking";
import { z } from "zod";

const bankAccountTypeSchema = z.enum(BANK_ACCOUNT_TYPES);
const transactionDirectionSchema = z.enum(TRANSACTION_DIRECTIONS);
const transactionTypeSchema = z.enum(TRANSACTION_TYPES);

export const transferBetweenOwnAccountsSchema = z
  .object({
    fromAccountId: z.uuid("Origin account id is invalid."),
    toAccountId: z.uuid("Destination account id is invalid."),
    amount: z
      .number({ error: "Transfer amount must be a number." })
      .positive("Transfer amount must be greater than zero."),
    description: z.string().trim().max(160).optional(),
  })
  .refine((value) => value.fromAccountId !== value.toAccountId, {
    message: "Origin and destination accounts must be different.",
    path: ["toAccountId"],
  });

export const transactionHistoryFilterSchema = z.object({
  accountId: z.uuid("Account id is invalid.").optional(),
  direction: transactionDirectionSchema.optional(),
  transactionType: transactionTypeSchema.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(TRANSACTION_HISTORY_MAX_LIMIT)
    .default(TRANSACTION_HISTORY_DEFAULT_LIMIT),
});

export const applyForLoanSchema = z.object({
  principal: z
    .number({ error: "Loan principal must be a number." })
    .positive("Loan principal must be greater than zero."),
  description: z.string().trim().max(160).optional(),
});

export const payLoanSchema = z.object({
  loanId: z.uuid("Loan id is invalid."),
  amount: z
    .number({ error: "Payment amount must be a number." })
    .positive("Payment amount must be greater than zero."),
  description: z.string().trim().max(160).optional(),
});

export const bankAccountTypeFilterSchema = z.object({
  accountType: bankAccountTypeSchema.optional(),
});

export type TransferBetweenOwnAccountsInput = z.infer<
  typeof transferBetweenOwnAccountsSchema
>;
export type TransactionHistoryFilterInput = z.infer<
  typeof transactionHistoryFilterSchema
>;
export type ApplyForLoanInput = z.infer<typeof applyForLoanSchema>;
export type PayLoanInput = z.infer<typeof payLoanSchema>;
