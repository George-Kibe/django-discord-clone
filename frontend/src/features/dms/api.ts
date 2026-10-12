"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import type { components } from "@/types/api";

export type DMConversation = components["schemas"]["DMConversation"];
export type DMRecipient = components["schemas"]["DMRecipient"];
export type UserSummary = components["schemas"]["UserSummary"];

export const dmKeys = {
  list: ["dms"] as const,
  detail: (id: string) => ["dms", id] as const,
  contacts: (q: string) => ["contacts", q] as const,
  blocks: ["blocks"] as const,
};

function must<T>(data: T | undefined): T {
  if (data === undefined) throw new Error("Empty response");
  return data;
}

/** "Ana", "Ana, Bo and Cy", or the group's own name. */
export function dmName(dm: Pick<DMConversation, "name" | "recipients">): string {
  if (dm.name) return dm.name;
  const names = dm.recipients.map((r) => r.display_name || r.username);
  if (names.length === 0) return "Empty group";
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}

export function useDMs() {
  return useQuery({
    queryKey: dmKeys.list,
    queryFn: async () => must((await api.GET("/api/v1/dms")).data),
    staleTime: Infinity, // dm.* events refetch it
  });
}

export function useDM(dmId: string) {
  return useQuery({
    queryKey: dmKeys.detail(dmId),
    queryFn: async () =>
      must((await api.GET("/api/v1/dms/{dm_id}", { params: { path: { dm_id: dmId } } })).data),
  });
}

export function useContacts(query: string) {
  return useQuery({
    queryKey: dmKeys.contacts(query),
    queryFn: async () =>
      must((await api.GET("/api/v1/users/me/contacts", { params: { query: { q: query } } })).data),
  });
}

export function useOpenDM() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userIds, name = "" }: { userIds: string[]; name?: string }) =>
      must((await api.POST("/api/v1/dms", { body: { user_ids: userIds, name } })).data),
    onSuccess: (dm) => {
      queryClient.setQueryData(dmKeys.detail(dm.id), dm);
      void queryClient.invalidateQueries({ queryKey: dmKeys.list, exact: true });
    },
  });
}

export function useUpdateDM(dmId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name?: string; closed?: boolean }) =>
      must(
        (await api.PATCH("/api/v1/dms/{dm_id}", { params: { path: { dm_id: dmId } }, body })).data,
      ),
    onSuccess: (dm) => {
      queryClient.setQueryData(dmKeys.detail(dm.id), dm);
      void queryClient.invalidateQueries({ queryKey: dmKeys.list, exact: true });
    },
  });
}

export function useAddParticipants(dmId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userIds: string[]) =>
      must(
        (
          await api.POST("/api/v1/dms/{dm_id}/participants", {
            params: { path: { dm_id: dmId } },
            body: { user_ids: userIds },
          })
        ).data,
      ),
    onSuccess: (dm) => queryClient.setQueryData(dmKeys.detail(dm.id), dm),
  });
}

export function useRemoveParticipant(dmId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      await api.DELETE("/api/v1/dms/{dm_id}/participants/{user_id}", {
        params: { path: { dm_id: dmId, user_id: userId } },
      });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: dmKeys.list }),
  });
}

export function useBlocks() {
  return useQuery({
    queryKey: dmKeys.blocks,
    queryFn: async () => must((await api.GET("/api/v1/users/me/blocks")).data),
    staleTime: 60_000,
  });
}

export function useBlockedIds(): Set<string> {
  const { data = [] } = useBlocks();
  return new Set(data.map((u) => u.id));
}

export function useSetBlocked() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, blocked }: { userId: string; blocked: boolean }) => {
      if (blocked) await api.POST("/api/v1/users/me/blocks", { body: { user_id: userId } });
      else
        await api.DELETE("/api/v1/users/me/blocks/{user_id}", {
          params: { path: { user_id: userId } },
        });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: dmKeys.blocks }),
  });
}
