"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import type { components } from "@/types/api";

export type AppNotification = components["schemas"]["Notification"];
export type NotificationPage = components["schemas"]["NotificationPage"];
export type MuteSetting = components["schemas"]["MuteSetting"];

type Pages = InfiniteData<NotificationPage, string | null>;

export const notificationKeys = {
  inbox: ["notifications"] as const,
  mutes: ["mute-settings"] as const,
};

export function useInbox() {
  return useInfiniteQuery({
    queryKey: notificationKeys.inbox,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const { data } = await api.GET("/api/v1/notifications", {
        params: { query: pageParam ? { cursor: pageParam } : {} },
      });
      if (!data) throw new Error("Empty response");
      return data;
    },
    getNextPageParam: (last) => last.next_cursor ?? null,
    staleTime: Infinity, // notification.* events keep it current
  });
}

export function unreadCount(data: InfiniteData<NotificationPage, unknown> | undefined): number {
  return data?.pages[0]?.unread_count ?? 0;
}

function updatePages(
  data: Pages | undefined,
  fn: (page: NotificationPage, index: number) => NotificationPage,
) {
  return data ? { ...data, pages: data.pages.map(fn) } : data;
}

/** notification.created / notification.updated (a coalesced DM entry moves to the top). */
export function upsertNotification(queryClient: QueryClient, item: AppNotification) {
  queryClient.setQueryData<Pages>(notificationKeys.inbox, (old) => {
    if (!old) return old;
    const wasUnread = old.pages.some((p) => p.results.some((n) => n.id === item.id && !n.read_at));
    const without = updatePages(old, (p) => ({
      ...p,
      results: p.results.filter((n) => n.id !== item.id),
    }))!;
    return updatePages(without, (p, i) => ({
      ...p,
      results: i === 0 ? [item, ...p.results] : p.results,
      // Already counted if it's in the cache unread (e.g. a refetch beat its event).
      unread_count: p.unread_count + (wasUnread || item.read_at ? 0 : 1),
    }));
  });
}

export function markReadLocally(queryClient: QueryClient, ids: string[] | "all") {
  const now = new Date().toISOString();
  queryClient.setQueryData<Pages>(notificationKeys.inbox, (old) => {
    if (!old) return old;
    let cleared = 0;
    const pages = old.pages.map((p) => ({
      ...p,
      results: p.results.map((n) => {
        if (n.read_at || (ids !== "all" && !ids.includes(n.id))) return n;
        cleared += 1;
        return { ...n, read_at: now };
      }),
    }));
    return {
      ...old,
      pages: pages.map((p) => ({
        ...p,
        unread_count: ids === "all" ? 0 : Math.max(0, p.unread_count - cleared),
      })),
    };
  });
}

export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[] | "all") => {
      await api.POST("/api/v1/notifications/read", {
        body: ids === "all" ? { all: true } : { all: false, ids },
      });
    },
    onMutate: (ids) => markReadLocally(queryClient, ids),
  });
}

export function useMuteSettings() {
  return useQuery({
    queryKey: notificationKeys.mutes,
    queryFn: async () => (await api.GET("/api/v1/mute-settings")).data ?? [],
    staleTime: Infinity,
  });
}

export type MuteTarget = { type: "server" | "channel" | "dm"; id: string };

export function isMuted(settings: MuteSetting[] | undefined, target: MuteTarget): boolean {
  const now = Date.now();
  return (settings ?? []).some(
    (s) =>
      s[`${target.type}_id` as const] === target.id &&
      (!s.muted_until || new Date(s.muted_until).getTime() > now),
  );
}

export function useSetMuted() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ target, muted }: { target: MuteTarget; muted: boolean }) =>
      (
        await api.PUT("/api/v1/mute-settings", {
          body: { target_type: target.type, target_id: target.id, muted },
        })
      ).data ?? [],
    onSuccess: (settings) => queryClient.setQueryData(notificationKeys.mutes, settings),
  });
}
