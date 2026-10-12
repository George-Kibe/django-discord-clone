"use client";

import { BarChart3, Check, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { ChatMessage, Conversation } from "@/features/chat/api";
import { ApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils";

import { useClosePoll, useVote, type PollSummary } from "../api";

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function closesIn(iso: string, now: number): string {
  const minutes = Math.round((new Date(iso).getTime() - now) / 60_000);
  if (minutes < 60) return relative.format(Math.max(minutes, 1), "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 48) return relative.format(hours, "hour");
  return relative.format(Math.round(hours / 24), "day");
}

/** The current time, refreshed every 30 s (closing countdowns). */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** A poll inside a message (FR-POLL-01..04): vote, change, withdraw, live results. */
export function PollCard({
  message,
  poll,
  conversation,
  canClose,
}: {
  message: ChatMessage;
  poll: PollSummary;
  conversation: Conversation;
  canClose: boolean;
}) {
  const vote = useVote(conversation, message.id);
  const now = useNow();
  const close = useClosePoll();
  const closed =
    poll.closed_at !== null ||
    (poll.closes_at !== null && new Date(poll.closes_at).getTime() <= now);
  const pending = message.pending === true;
  const mine = new Set(poll.my_votes);
  const totalVotes = poll.options.reduce((sum, o) => sum + o.votes, 0);
  const showResults = closed || mine.size > 0;

  function choose(optionId: number) {
    if (closed || pending) return;
    let next: number[];
    if (poll.allow_multiple) {
      next = mine.has(optionId)
        ? poll.my_votes.filter((id) => id !== optionId)
        : [...poll.my_votes, optionId];
    } else {
      next = mine.has(optionId) ? [] : [optionId];
    }
    vote.mutate(
      { pollId: poll.id, optionIds: next },
      {
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't save your vote."),
      },
    );
  }

  return (
    <div
      className="mt-1 grid max-w-md gap-2 rounded-lg border border-border bg-card p-3"
      data-testid="poll"
      data-closed={closed ? "true" : "false"}
    >
      <div className="flex items-start gap-2">
        <BarChart3 className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
        <h3 className="font-semibold">{poll.question}</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        {poll.allow_multiple ? "Select one or more answers" : "Select one answer"}
      </p>
      <div
        role={poll.allow_multiple ? "group" : "radiogroup"}
        aria-label={poll.question}
        className="grid gap-1.5"
      >
        {poll.options.map((option) => {
          const share = totalVotes ? Math.round((option.votes / totalVotes) * 100) : 0;
          const selected = mine.has(option.id);
          return (
            <button
              key={option.id}
              type="button"
              role={poll.allow_multiple ? "checkbox" : "radio"}
              aria-checked={selected}
              disabled={closed || pending}
              onClick={() => choose(option.id)}
              className={cn(
                "relative overflow-hidden rounded-md border px-3 py-2 text-left text-sm transition-colors",
                selected ? "border-primary" : "border-border hover:border-muted-foreground",
                (closed || pending) && "cursor-default",
              )}
              data-testid="poll-option"
            >
              {showResults ? (
                <span
                  className="absolute inset-y-0 left-0 bg-primary/20"
                  style={{ width: `${share}%` }}
                  aria-hidden
                />
              ) : null}
              <span className="relative flex items-center gap-2">
                {selected ? <Check className="size-4 text-brand" aria-hidden /> : null}
                <span className="flex-1">{option.text}</span>
                {showResults ? (
                  <span className="text-xs text-muted-foreground" data-testid="poll-votes">
                    {option.votes} vote{option.votes === 1 ? "" : "s"} · {share}%
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span data-testid="poll-total">
          {poll.total_voters} voter{poll.total_voters === 1 ? "" : "s"}
        </span>
        <span aria-hidden>·</span>
        {closed ? (
          <span className="inline-flex items-center gap-1">
            <Lock className="size-3" aria-hidden /> Poll closed
          </span>
        ) : poll.closes_at ? (
          <span>Closes {closesIn(poll.closes_at, now)}</span>
        ) : (
          <span>Open</span>
        )}
        <span className="ml-auto flex gap-1">
          {!closed && mine.size > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7"
              onClick={() => vote.mutate({ pollId: poll.id, optionIds: [] })}
            >
              Remove vote
            </Button>
          ) : null}
          {!closed && canClose && !pending ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              onClick={() =>
                close.mutate(poll.id, {
                  onError: (e) =>
                    toast.error(e instanceof ApiError ? e.message : "Couldn't close the poll."),
                })
              }
            >
              End poll
            </Button>
          ) : null}
        </span>
      </div>
    </div>
  );
}
