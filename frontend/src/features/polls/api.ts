"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { messageKeys, type Conversation, type Pages } from "@/features/chat/api";
import { api } from "@/lib/api/client";
import type { components } from "@/types/api";

export type PollSummary = components["schemas"]["PollSummary"];

/** Broadcasts don't know your own votes; keep them unless the update is about you. */
export function applyPollUpdate(
  current: PollSummary | null,
  next: Omit<PollSummary, "my_votes">,
  voter: { isMe: boolean; optionIds: number[] | null },
): PollSummary {
  const mine = voter.isMe && voter.optionIds !== null ? voter.optionIds : (current?.my_votes ?? []);
  return { ...next, my_votes: mine };
}

export function patchPoll(
  data: Pages | undefined,
  messageId: string,
  fn: (poll: PollSummary | null) => PollSummary,
): Pages | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((p) => ({
      ...p,
      results: p.results.map((m) => (m.id === messageId ? { ...m, poll: fn(m.poll) } : m)),
    })),
  };
}

export function useVote(c: Conversation, messageId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ pollId, optionIds }: { pollId: string; optionIds: number[] }) => {
      const params = { path: { poll_id: pollId } };
      if (optionIds.length)
        await api.PUT("/api/v1/polls/{poll_id}/votes", { params, body: { option_ids: optionIds } });
      else await api.DELETE("/api/v1/polls/{poll_id}/votes", { params });
    },
    onMutate: ({ optionIds }) =>
      queryClient.setQueryData<Pages>(messageKeys.of(c), (old) =>
        patchPoll(old, messageId, (poll) => {
          if (!poll) return poll as unknown as PollSummary;
          const before = new Set(poll.my_votes);
          const after = new Set(optionIds);
          return {
            ...poll,
            my_votes: optionIds,
            options: poll.options.map((o) => ({
              ...o,
              votes: o.votes + (after.has(o.id) ? 1 : 0) - (before.has(o.id) ? 1 : 0),
            })),
            total_voters: poll.total_voters + (after.size ? 1 : 0) - (before.size ? 1 : 0),
          };
        }),
      ),
    onError: () => void queryClient.invalidateQueries({ queryKey: messageKeys.of(c) }),
  });
}

export function useClosePoll() {
  return useMutation({
    mutationFn: async (pollId: string) => {
      await api.POST("/api/v1/polls/{poll_id}/close", { params: { path: { poll_id: pollId } } });
    },
  });
}
