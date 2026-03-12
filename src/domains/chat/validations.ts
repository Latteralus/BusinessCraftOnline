import { z } from "zod";

export const sendChatMessageSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, "Message must contain at least 1 character.")
    .max(280, "Message must be 280 characters or less."),
});

export const markChatReadSchema = z.object({
  viewedAt: z.string().datetime({ offset: true, message: "A valid viewed timestamp is required." }),
});

export type MarkChatReadInput = z.infer<typeof markChatReadSchema>;
export type SendChatMessageInput = z.infer<typeof sendChatMessageSchema>;
