import { z } from "zod";

export const sendChatMessageSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, "Message must contain at least 1 character.")
    .max(280, "Message must be 280 characters or less."),
});

export type SendChatMessageInput = z.infer<typeof sendChatMessageSchema>;
