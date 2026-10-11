"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { clearSessionHint, hasSessionHint } from "@/lib/cookies";
import type { components } from "@/types/api";

export type Me = components["schemas"]["Me"];

export const meQueryKey = ["me"] as const;

export async function fetchMe(): Promise<Me> {
  const { data } = await api.GET("/api/v1/users/me");
  if (!data) throw new Error("Empty response for the current user.");
  return data;
}

/** The signed-in user. A 401 that survives the silent refresh means the session is gone. */
export function useMe() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: fetchMe,
    enabled: typeof window !== "undefined" && hasSessionHint(),
    retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 2,
    staleTime: 60_000,
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: async () => {
      await api.POST("/api/v1/auth/logout").catch(() => undefined);
    },
    onSettled: () => {
      clearSessionHint();
      queryClient.clear();
      router.replace("/login");
      router.refresh();
    },
  });
}

export function safeNextPath(next: string | null | undefined): string {
  // Only allow same-site relative paths (no protocol-relative "//evil.com").
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/channels/me";
}
