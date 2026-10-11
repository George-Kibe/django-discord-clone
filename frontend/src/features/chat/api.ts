"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useEffect } from "react";

import { api } from "@/lib/api/client";
import type { components } from "@/types/api";

export type Message = components["schemas"]["Message"];
export type MessagePage = components["schemas"]["MessagePage"];

/** A message in the UI: real, or an optimistic one still being sent. */
export type ChatMessage = Message & { pending?: boolean; failed?: boolean };

type Pages = InfiniteData<{ results: ChatMessage[]; has_more: boolean }, string | null>;

export const messageKeys = {
  channel: (channelId: string) => ["channels", channelId, "messages"] as const,
};

const PAGE_SIZE = 50;
const POLL_MS = 4000;

/**
 * History, newest page first. Each page's `results` are newest-first, as the API returns them.
 * `fetchNextPage` loads older messages (cursor: `before` = the oldest id loaded so far).
 */
export function useMessages(channelId: string) {
  return useInfiniteQuery({
    queryKey: messageKeys.channel(channelId),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const { data } = await api.GET("/api/v1/channels/{channel_id}/messages", {
        params: {
          path: { channel_id: channelId },
          query: { limit: PAGE_SIZE, ...(pageParam ? { before: pageParam } : {}) },
        },
      });
      if (!data) throw new Error("Empty response");
      return data as { results: ChatMessage[]; has_more: boolean };
    },
    getNextPageParam: (lastPage) =>
      lastPage.has_more ? (lastPage.results.at(-1)?.id ?? null) : null,
    staleTime: Infinity, // new messages arrive through polling (Phase 4: WebSocket events)
    refetchOnWindowFocus: false,
  });
}

/** Flattened, oldest-first list for rendering (deduplicated by id). */
export function flattenMessages(
  data: InfiniteData<{ results: ChatMessage[]; has_more: boolean }, unknown> | undefined,
): ChatMessage[] {
  if (!data) return [];
  const seen = new Set<string>();
  const out: ChatMessage[] = [];
  for (const page of [...data.pages].reverse()) {
    for (const message of [...page.results].reverse()) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      out.push(message);
    }
  }
  return out;
}

function newestRealId(data: Pages | undefined): string | null {
  for (const message of data?.pages[0]?.results ?? []) if (!message.pending) return message.id;
  return null;
}

/** Inserts messages at the newest end, replacing optimistic copies by nonce and skipping dupes. */
export function mergeNewest(data: Pages | undefined, incoming: ChatMessage[]): Pages | undefined {
  if (!data || incoming.length === 0) return data;
  const [first, ...rest] = data.pages;
  const known = new Set(data.pages.flatMap((p) => p.results.map((m) => m.id)));
  const nonces = new Set(incoming.map((m) => m.nonce).filter(Boolean));
  const kept = first.results.filter((m) => !(m.pending && m.nonce && nonces.has(m.nonce)));
  const fresh = incoming.filter((m) => !known.has(m.id)).reverse(); // to newest-first
  return { ...data, pages: [{ ...first, results: [...fresh, ...kept] }, ...rest] };
}

/** Phase 3 stand-in for real-time: fetch messages newer than the newest one we have. */
export function useNewMessagePolling(channelId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const key = messageKeys.channel(channelId);
    const tick = async () => {
      if (document.hidden) return;
      const after = newestRealId(queryClient.getQueryData<Pages>(key));
      if (!after) return;
      const { data } = await api
        .GET("/api/v1/channels/{channel_id}/messages", {
          params: { path: { channel_id: channelId }, query: { after, limit: 100 } },
        })
        .catch(() => ({ data: undefined }));
      if (cancelled || !data?.results.length) return;
      queryClient.setQueryData<Pages>(key, (old) => mergeNewest(old, data.results));
    };
    const id = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [channelId, enabled, queryClient]);
}

function randomNonce(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Optimistic send with a client nonce (FR-MSG-11): retries never duplicate. */
export function useSendMessage(channelId: string, author: Message["author"]) {
  const queryClient = useQueryClient();
  const key = messageKeys.channel(channelId);
  const patch = (fn: (m: ChatMessage) => ChatMessage) =>
    queryClient.setQueryData<Pages>(key, (old) =>
      old ? { ...old, pages: old.pages.map((p) => ({ ...p, results: p.results.map(fn) })) } : old,
    );

  return useMutation({
    mutationFn: async ({ content, nonce }: { content: string; nonce: string }) => {
      const { data } = await api.POST("/api/v1/channels/{channel_id}/messages", {
        params: { path: { channel_id: channelId } },
        body: { content, nonce },
      });
      if (!data) throw new Error("Empty response");
      return data;
    },
    onMutate: ({ content, nonce }) => {
      const optimistic: ChatMessage = {
        id: `pending-${nonce}`,
        channel_id: channelId,
        author,
        type: "default",
        content,
        nonce,
        created_at: new Date().toISOString(),
        edited_at: null,
        pending: true,
      };
      queryClient.setQueryData<Pages>(key, (old) =>
        old
          ? {
              ...old,
              pages: [
                { ...old.pages[0], results: [optimistic, ...old.pages[0].results] },
                ...old.pages.slice(1),
              ],
            }
          : old,
      );
    },
    onSuccess: (message) =>
      queryClient.setQueryData<Pages>(key, (old) => mergeNewest(old, [message])),
    onError: (_error, { nonce }) =>
      patch((m) => (m.nonce === nonce && m.pending ? { ...m, failed: true } : m)),
  });
}

export function newNonce(): string {
  return randomNonce();
}

export function useEditMessage(channelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, content }: { id: string; content: string }) => {
      const { data } = await api.PATCH("/api/v1/messages/{message_id}", {
        params: { path: { message_id: id } },
        body: { content },
      });
      if (!data) throw new Error("Empty response");
      return data;
    },
    onSuccess: (message) =>
      queryClient.setQueryData<Pages>(messageKeys.channel(channelId), (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((p) => ({
                ...p,
                results: p.results.map((m) => (m.id === message.id ? message : m)),
              })),
            }
          : old,
      ),
  });
}

export function useDeleteMessage(channelId: string) {
  const queryClient = useQueryClient();
  const removeLocal = (id: string) =>
    queryClient.setQueryData<Pages>(messageKeys.channel(channelId), (old) =>
      old
        ? {
            ...old,
            pages: old.pages.map((p) => ({ ...p, results: p.results.filter((m) => m.id !== id) })),
          }
        : old,
    );
  return useMutation({
    mutationFn: async (message: ChatMessage) => {
      if (!message.pending) {
        await api.DELETE("/api/v1/messages/{message_id}", {
          params: { path: { message_id: message.id } },
        });
      }
      return message.id;
    },
    onSuccess: removeLocal,
  });
}
