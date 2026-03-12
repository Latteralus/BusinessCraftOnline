import { z } from "zod";

export const sendMailSchema = z.object({
  recipientPlayerId: z.string().uuid("A valid recipient is required."),
  subject: z
    .string()
    .trim()
    .min(1, "Subject must contain at least 1 character.")
    .max(120, "Subject must be 120 characters or less."),
  body: z
    .string()
    .trim()
    .min(1, "Message must contain at least 1 character.")
    .max(4000, "Message must be 4000 characters or less."),
});

export const replyMailSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Reply must contain at least 1 character.")
    .max(4000, "Reply must be 4000 characters or less."),
});

export const markMailThreadReadSchema = z.object({
  viewedAt: z.string().datetime({ offset: true, message: "A valid viewed timestamp is required." }).optional(),
});

export const mailboxQuerySchema = z.object({
  threadId: z.string().uuid("Invalid thread id.").optional(),
});

export const mailRecipientSearchSchema = z.object({
  q: z
    .string()
    .trim()
    .min(1, "Search text is required.")
    .max(64, "Search text must be 64 characters or less."),
});

export type SendMailInput = z.infer<typeof sendMailSchema>;
export type ReplyMailInput = z.infer<typeof replyMailSchema>;
export type MarkMailThreadReadInput = z.infer<typeof markMailThreadReadSchema>;
export type MailboxQueryInput = z.infer<typeof mailboxQuerySchema>;
export type MailRecipientSearchInput = z.infer<typeof mailRecipientSearchSchema>;
