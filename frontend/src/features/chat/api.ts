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

export type Message = components["schemas"]["Message"];
export type MessagePage = components["schemas"]["MessagePage"];
export type Attachment = components["schemas"]["Attachment"];
export type ReactionSummary = components["schemas"]["ReactionSummary"];
export type ReplyPreview = components["schemas"]["ReplyPreview"];

/** A message in the UI: real, or an optimistic one still being sent. */
export type ChatMessage = Message & { pending?: boolean; failed?: boolean };

export type Pages = InfiniteData<{ results: ChatMessage[]; has_more: boolean }, string | null>;

/** Where messages live: a server channel or a DM conversation. */
export type Conversation = { kind: "channel" | "dm"; id: string };

export const messageKeys = {
  of: (c: Conversation) => [c.kind === "channel" ? "channels" : "dms", c.id, "messages"] as const,
  channel: (channelId: string) => ["channels", channelId, "messages"] as const,
  pins: (c: Conversation) => ["pins", c.kind, c.id] as const,
};

export function conversationOf(message: {
  channel_id?: string | null;
  dm_id?: string | null;
}): Conversation {
  return message.channel_id
    ? { kind: "channel", id: message.channel_id }
    : { kind: "dm", id: message.dm_id ?? "" };
}

const PAGE_SIZE = 50;

type HistoryQuery = { limit: number; before?: string; after?: string };

async function fetchPage(c: Conversation, query: HistoryQuery) {
  const { data } =
    c.kind === "channel"
      ? await api.GET("/api/v1/channels/{channel_id}/messages", {
          params: { path: { channel_id: c.id }, query },
        })
      : await api.GET("/api/v1/dms/{dm_id}/messages", {
          params: { path: { dm_id: c.id }, query },
        });
  if (!data) throw new Error("Empty response");
  return data as { results: ChatMessage[]; has_more: boolean };
}

/**
 * History, newest page first. Each page's `results` are newest-first, as the API returns them.
 * `fetchNextPage` loads older messages (cursor: `before` = the oldest id loaded so far).
 */
export function useMessages(c: Conversation) {
  return useInfiniteQuery({
    queryKey: messageKeys.of(c),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      fetchPage(c, { limit: PAGE_SIZE, ...(pageParam ? { before: pageParam } : {}) }),
    getNextPageParam: (lastPage) =>
      lastPage.has_more ? (lastPage.results.at(-1)?.id ?? null) : null,
    staleTime: Infinity, // kept current by gateway events, backfilled after reconnects
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

function mapMessages(
  data: Pages | undefined,
  fn: (m: ChatMessage) => ChatMessage | null,
): Pages | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((p) => ({
      ...p,
      results: p.results.map(fn).filter((m): m is ChatMessage => m !== null),
    })),
  };
}

/**
 * Replaces a message in place. Broadcast payloads can't know whether *you* reacted, so by default
 * the reactions already in the cache are kept (reaction events keep them current).
 */
export function replaceMessage(
  data: Pages | undefined,
  message: ChatMessage,
  { keepReactions = true }: { keepReactions?: boolean } = {},
): Pages | undefined {
  return mapMessages(data, (m) =>
    m.id === message.id
      ? { ...message, reactions: keepReactions ? m.reactions : message.reactions }
      : m,
  );
}

export function removeMessage(data: Pages | undefined, id: string): Pages | undefined {
  return mapMessages(data, (m) => (m.id === id ? null : m));
}

/** Applies a reaction count from the server (or an optimistic toggle). */
export function setReaction(
  reactions: ReactionSummary[],
  emoji: string,
  count: number,
  me: boolean | undefined,
): ReactionSummary[] {
  const existing = reactions.find((r) => r.emoji === emoji);
  if (count <= 0) return reactions.filter((r) => r.emoji !== emoji);
  if (!existing) return [...reactions, { emoji, count, me: me ?? false }];
  return reactions.map((r) => (r.emoji === emoji ? { ...r, count, me: me ?? r.me } : r));
}

export function patchReaction(
  data: Pages | undefined,
  messageId: string,
  emoji: string,
  count: number,
  me: boolean | undefined,
): Pages | undefined {
  return mapMessages(data, (m) =>
    m.id === messageId ? { ...m, reactions: setReaction(m.reactions, emoji, count, me) } : m,
  );
}

const BACKFILL_PAGES = 5;

/**
 * After a reconnect: fetch what was missed since the newest message we have. Long gaps (more
 * than a few pages) just reload the conversation from the newest page instead.
 */
export async function backfill(queryClient: QueryClient, c: Conversation) {
  const key = messageKeys.of(c);
  for (let page = 0; page < BACKFILL_PAGES; page++) {
    const after = newestRealId(queryClient.getQueryData<Pages>(key));
    if (!after) {
      // Nothing loaded yet (an empty conversation): just fetch it again.
      await queryClient.invalidateQueries({ queryKey: key, exact: true });
      return;
    }
    const data = await fetchPage(c, { after, limit: 100 });
    queryClient.setQueryData<Pages>(key, (old) => mergeNewest(old, data.results));
    if (!data.has_more) return;
  }
  await queryClient.resetQueries({ queryKey: key, exact: true });
}

function randomNonce(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function newNonce(): string {
  return randomNonce();
}

/** A file uploaded to Cloudinary, waiting to be attached to the next message. */
export type UploadedAttachment = {
  publicId: string;
  filename: string;
  size: number;
  isImage: boolean;
  localUrl: string | null;
};

export type PollInput = {
  question: string;
  options: string[];
  allow_multiple: boolean;
  duration_minutes: number | null;
};

export type SendInput = {
  content: string;
  nonce: string;
  replyTo?: ChatMessage | null;
  attachments?: UploadedAttachment[];
  poll?: PollInput | null;
};

export function replyPreview(message: ChatMessage): ReplyPreview {
  return {
    id: message.id,
    author: message.author,
    content: message.content.slice(0, 200),
    deleted: false,
    has_attachments: message.attachments.length > 0,
  };
}

/** Optimistic send with a client nonce (FR-MSG-11): retries never duplicate. */
export function useSendMessage(c: Conversation, author: Message["author"]) {
  const queryClient = useQueryClient();
  const key = messageKeys.of(c);

  return useMutation({
    mutationFn: async ({ content, nonce, replyTo, attachments, poll }: SendInput) => {
      const body = {
        content,
        nonce,
        poll: poll ?? null,
        reply_to: replyTo?.id ?? null,
        attachments:
          attachments?.map((a) => ({ public_id: a.publicId, filename: a.filename })) ?? [],
      };
      const { data } =
        c.kind === "channel"
          ? await api.POST("/api/v1/channels/{channel_id}/messages", {
              params: { path: { channel_id: c.id } },
              body,
            })
          : await api.POST("/api/v1/dms/{dm_id}/messages", {
              params: { path: { dm_id: c.id } },
              body,
            });
      if (!data) throw new Error("Empty response");
      return data as ChatMessage;
    },
    onMutate: ({ content, nonce, replyTo, attachments = [], poll }) => {
      const optimistic: ChatMessage = {
        id: `pending-${nonce}`,
        channel_id: c.kind === "channel" ? c.id : null,
        dm_id: c.kind === "dm" ? c.id : null,
        author,
        type: poll ? "poll" : replyTo ? "reply" : "default",
        content,
        nonce,
        created_at: new Date().toISOString(),
        edited_at: null,
        pinned_at: null,
        reply_to: replyTo ? replyPreview(replyTo) : null,
        attachments: attachments.map((a) => ({
          id: a.publicId,
          filename: a.filename,
          content_type: "",
          size_bytes: a.size,
          width: null,
          height: null,
          is_image: a.isImage,
          url: a.localUrl,
          preview_url: a.localUrl,
        })),
        reactions: [],
        mentions: [],
        mention_roles: [],
        mention_everyone: false,
        poll: poll
          ? {
              id: `pending-${nonce}`,
              question: poll.question,
              allow_multiple: poll.allow_multiple,
              closes_at: null,
              closed_at: null,
              options: poll.options.map((text, i) => ({ id: -1 - i, text, votes: 0 })),
              total_voters: 0,
              my_votes: [],
            }
          : null,
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
      queryClient.setQueryData<Pages>(key, (old) =>
        mapMessages(old, (m) => (m.nonce === nonce && m.pending ? { ...m, failed: true } : m)),
      ),
  });
}

export function useEditMessage(c: Conversation) {
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
      queryClient.setQueryData<Pages>(messageKeys.of(c), (old) => replaceMessage(old, message)),
  });
}

export function useDeleteMessage(c: Conversation) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (message: ChatMessage) => {
      if (!message.pending) {
        await api.DELETE("/api/v1/messages/{message_id}", {
          params: { path: { message_id: message.id } },
        });
      }
      return message.id;
    },
    onSuccess: (id) =>
      queryClient.setQueryData<Pages>(messageKeys.of(c), (old) => removeMessage(old, id)),
  });
}

/** Adds or removes your reaction; the gateway event then confirms the count. */
export function useToggleReaction(c: Conversation) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ message, emoji }: { message: ChatMessage; emoji: string }) => {
      const mine = message.reactions.find((r) => r.emoji === emoji)?.me ?? false;
      const params = { path: { message_id: message.id, emoji } };
      if (mine) await api.DELETE("/api/v1/messages/{message_id}/reactions/{emoji}", { params });
      else await api.PUT("/api/v1/messages/{message_id}/reactions/{emoji}", { params });
    },
    onMutate: ({ message, emoji }) => {
      const current = message.reactions.find((r) => r.emoji === emoji);
      const mine = current?.me ?? false;
      const count = (current?.count ?? 0) + (mine ? -1 : 1);
      queryClient.setQueryData<Pages>(messageKeys.of(c), (old) =>
        patchReaction(old, message.id, emoji, count, !mine),
      );
    },
    onError: () => void queryClient.invalidateQueries({ queryKey: messageKeys.of(c) }),
  });
}

export function usePins(c: Conversation, enabled: boolean) {
  return useQuery({
    queryKey: messageKeys.pins(c),
    enabled,
    queryFn: async () => {
      const { data } =
        c.kind === "channel"
          ? await api.GET("/api/v1/channels/{channel_id}/pins", {
              params: { path: { channel_id: c.id } },
            })
          : await api.GET("/api/v1/dms/{dm_id}/pins", { params: { path: { dm_id: c.id } } });
      return (data ?? []) as ChatMessage[];
    },
  });
}

export function useSetPinned(c: Conversation) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ message, pinned }: { message: ChatMessage; pinned: boolean }) => {
      const params = { path: { message_id: message.id } };
      if (pinned) await api.PUT("/api/v1/messages/{message_id}/pin", { params });
      else await api.DELETE("/api/v1/messages/{message_id}/pin", { params });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: messageKeys.pins(c) }),
  });
}
