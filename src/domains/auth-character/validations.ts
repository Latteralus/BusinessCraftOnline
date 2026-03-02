import { z } from "zod";

const usernamePattern = /^[a-zA-Z0-9_]+$/;

export const registerSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
  username: z
    .string()
    .min(3, "Username must be at least 3 characters.")
    .max(24, "Username must be 24 characters or less.")
    .regex(
      usernamePattern,
      "Username can only contain letters, numbers, and underscore."
    ),
});

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});

export const createCharacterSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, "First name is required.")
    .max(32, "First name must be 32 characters or less."),
  lastName: z
    .string()
    .trim()
    .min(1, "Last name is required.")
    .max(32, "Last name must be 32 characters or less."),
  gender: z.enum(["male", "female", "other"]),
  currentCityId: z.uuid().nullable().optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateCharacterInput = z.infer<typeof createCharacterSchema>;
