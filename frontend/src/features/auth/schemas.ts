import { z } from "zod";

// Mirrors backend validation (apps/accounts/serializers.py + Django password validators).
export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(128, "Use at most 128 characters.")
  .refine((value) => !/^\d+$/.test(value), "Password can't be entirely numeric.");

export const usernameSchema = z
  .string()
  .trim()
  .min(2, "Use at least 2 characters.")
  .max(32, "Use at most 32 characters.")
  .regex(/^[a-zA-Z0-9_.]+$/, "Only letters, numbers, underscores and dots.")
  .transform((value) => value.toLowerCase());

export const emailSchema = z.email("Enter a valid email address.");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
});

export const registerSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  display_name: z.string().trim().max(64, "Use at most 64 characters.").optional(),
  password: passwordSchema,
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((data) => data.password === data.confirm, {
    path: ["confirm"],
    message: "Passwords don't match.",
  });

export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterInput = z.input<typeof registerSchema>;
export type RegisterValues = z.output<typeof registerSchema>;
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
