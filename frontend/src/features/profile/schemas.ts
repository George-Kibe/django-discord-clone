import { z } from "zod";

import { usernameSchema } from "@/features/auth/schemas";

export const STATUSES = ["online", "idle", "dnd", "invisible"] as const;

export const profileSchema = z.object({
  display_name: z.string().trim().max(64, "Use at most 64 characters."),
  username: usernameSchema,
  bio: z.string().max(500, "Use at most 500 characters."),
  status: z.enum(STATUSES),
});

export type ProfileInput = z.input<typeof profileSchema>;
export type ProfileValues = z.output<typeof profileSchema>;
