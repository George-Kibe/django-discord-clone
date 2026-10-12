"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import type { Conversation } from "@/features/chat/api";
import { isMuted, useMuteSettings } from "@/features/notifications/api";
import { api } from "@/lib/api/client";
import type { components } from "@/types/api";

export type ReadState = components["schemas"]["ReadState"];

export const readStatesKey = ["read-states"] as const;

/** The conversation a read state belongs to (channel or DM). */
export function stateKey(state: Pick<ReadState, "channel_id" | "dm_id">): string {
  return state.channel_id ?? state.dm_id ?? "";
}

/** UUIDv7 ids sort by creation time, so plain string comparison orders messages. */
export function isUnread(state: ReadState | undefined): boolean {
  if (!state?.last_message_id) return false;
  return !state.last_read_message_id || state.last_message_id > state.last_read_message_id;
}

export function useReadStates() {
  return useQuery({
    queryKey: readStatesKey,
    staleTime: Infinity, // kept current by message.created and read_state.updated events
    queryFn: async () => {
      const { data } = await api.GET("/api/v1/read-states");
      if (!data) throw new Error("Empty response");
      return data;
    },
  });
}

/**
 * Unread channels/servers/DMs and badge counts: mentions for channels and servers, unread
 * messages for DMs (`mention_count` on DM rows). Muted channels and servers aren't marked unread,
 * but their mentions still count.
 */
export function summarize(states: ReadState[], muted: (state: ReadState) => boolean = () => false) {
  const channels = new Set<string>();
  const servers = new Set<string>();
  const dms = new Set<string>();
  const mentions = new Map<string, number>(); // channel, server or DM id → count
  let dmTotal = 0;
  for (const state of states) {
    if (state.dm_id) {
      if (muted(state)) continue;
      if (state.mention_count > 0 || isUnread(state)) dms.add(state.dm_id);
      if (state.mention_count > 0) {
        mentions.set(state.dm_id, state.mention_count);
        dmTotal += state.mention_count;
      }
      continue;
    }
    if (!state.channel_id || !state.server_id) continue;
    if (isUnread(state) && !muted(state)) {
      channels.add(state.channel_id);
      servers.add(state.server_id);
    }
    if (state.mention_count > 0) {
      mentions.set(state.channel_id, state.mention_count);
      mentions.set(state.server_id, (mentions.get(state.server_id) ?? 0) + state.mention_count);
    }
  }
  return { channels, servers, dms, mentions, dmTotal };
}

export function useUnread() {
  const { data = [] } = useReadStates();
  const { data: mutes } = useMuteSettings();
  return summarize(
    data,
    (s) =>
      (s.dm_id ? isMuted(mutes, { type: "dm", id: s.dm_id }) : false) ||
      (s.channel_id ? isMuted(mutes, { type: "channel", id: s.channel_id }) : false) ||
      (s.server_id ? isMuted(mutes, { type: "server", id: s.server_id }) : false),
  );
}

/** Patches the read state of a channel or DM (by its id). */
export function patchReadState(
  queryClient: QueryClient,
  conversationId: string,
  patch: (state: ReadState) => ReadState,
): void {
  queryClient.setQueryData<ReadState[]>(readStatesKey, (old) =>
    old?.map((state) => (stateKey(state) === conversationId ? patch(state) : state)),
  );
}

export function useAck(c: Conversation) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (messageId: string) => {
      if (c.kind === "channel")
        await api.POST("/api/v1/channels/{channel_id}/ack", {
          params: { path: { channel_id: c.id } },
          body: { message_id: messageId },
        });
      else
        await api.POST("/api/v1/dms/{dm_id}/ack", {
          params: { path: { dm_id: c.id } },
          body: { message_id: messageId },
        });
    },
    onMutate: (messageId) =>
      patchReadState(queryClient, c.id, (state) => ({
        ...state,
        last_read_message_id:
          state.last_read_message_id && state.last_read_message_id > messageId
            ? state.last_read_message_id
            : messageId,
        mention_count: 0,
      })),
  });
}
