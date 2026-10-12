"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import type { components } from "@/types/api";

export type ReadState = components["schemas"]["ReadState"];

export const readStatesKey = ["read-states"] as const;

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

/** Unread channel/server ids and mention counts (mentions are counted from Phase 5 on). */
export function summarize(states: ReadState[]) {
  const channels = new Set<string>();
  const servers = new Set<string>();
  const mentions = new Map<string, number>(); // channel id and server id → count
  for (const state of states) {
    if (isUnread(state)) {
      channels.add(state.channel_id);
      servers.add(state.server_id);
    }
    if (state.mention_count > 0) {
      mentions.set(state.channel_id, state.mention_count);
      mentions.set(state.server_id, (mentions.get(state.server_id) ?? 0) + state.mention_count);
    }
  }
  return { channels, servers, mentions };
}

export function useUnread() {
  const { data = [] } = useReadStates();
  return summarize(data);
}

export function patchReadState(
  queryClient: QueryClient,
  channelId: string,
  patch: (state: ReadState) => ReadState,
): void {
  queryClient.setQueryData<ReadState[]>(readStatesKey, (old) =>
    old?.map((state) => (state.channel_id === channelId ? patch(state) : state)),
  );
}

export function useAck(channelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (messageId: string) => {
      const { data } = await api.POST("/api/v1/channels/{channel_id}/ack", {
        params: { path: { channel_id: channelId } },
        body: { message_id: messageId },
      });
      return data;
    },
    onMutate: (messageId) =>
      patchReadState(queryClient, channelId, (state) => ({
        ...state,
        last_read_message_id:
          state.last_read_message_id && state.last_read_message_id > messageId
            ? state.last_read_message_id
            : messageId,
        mention_count: 0,
      })),
  });
}
