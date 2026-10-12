"use client";

import { Hash } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useRealtime } from "@/features/realtime/provider";
import { useAck, useReadStates } from "@/features/realtime/read-states";
import { useMe } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";

import type { Channel } from "@/features/servers/api";

import {
  flattenMessages,
  newNonce,
  useDeleteMessage,
  useMessages,
  useSendMessage,
  type ChatMessage,
} from "../api";
import { Composer } from "./composer";
import { MessageList } from "./message-list";
import { TypingIndicator } from "./typing-indicator";

const TYPING_EVERY_MS = 5000; // the server shows "typing" for 8 s per signal

const ACK_EVERY_MS = 1000;

/**
 * Marks the channel read while the newest message is on screen and the tab is visible.
 * Throttled: a busy channel sends at most one ack per second (for the newest message then).
 */
function useAutoAck(channelId: string, newestId: string | undefined, atBottom: boolean) {
  const { mutate: ack } = useAck(channelId);
  const { data: states } = useReadStates();
  const lastRead = states?.find((s) => s.channel_id === channelId)?.last_read_message_id;
  const sent = useRef<string | undefined>(undefined);
  const latest = useRef({ newestId, atBottom, lastRead });
  const timer = useRef<number | null>(null);

  useEffect(() => {
    latest.current = { newestId, atBottom, lastRead };
  });

  const flush = useCallback(() => {
    const { newestId: id, atBottom: bottom, lastRead: read } = latest.current;
    if (!bottom || !id || document.visibilityState !== "visible") return;
    if ((read && read >= id) || (sent.current && sent.current >= id)) return;
    sent.current = id;
    ack(id);
  }, [ack]);

  useEffect(() => {
    if (!atBottom || !newestId || timer.current !== null) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      flush();
    }, ACK_EVERY_MS);
  }, [atBottom, newestId, flush]);

  useEffect(() => {
    document.addEventListener("visibilitychange", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
  }, [flush]);
}

export function ChatView({
  channel,
  headerStart,
}: {
  channel: Channel;
  headerStart?: React.ReactNode;
}) {
  const { data: me } = useMe();
  const messages = useMessages(channel.id);
  const author = me
    ? {
        id: me.id,
        username: me.username,
        display_name: me.display_name ?? "",
        avatar_url: me.avatar_url,
      }
    : null;
  const send = useSendMessage(channel.id, author);
  const discard = useDeleteMessage(channel.id);
  const list = useMemo(() => flattenMessages(messages.data), [messages.data]);
  const newestId = useMemo(() => list.findLast((m) => !m.pending)?.id, [list]);
  const [atBottom, setAtBottom] = useState(true);
  useAutoAck(channel.id, newestId, atBottom);
  const { request } = useRealtime();
  const lastTyping = useRef(0);
  const canSend = hasPerm(channel.permissions, "SEND_MESSAGES") && Boolean(me?.email_verified);
  const { fetchNextPage, isFetchingNextPage, hasNextPage } = messages;
  const loadOlder = useCallback(() => void fetchNextPage(), [fetchNextPage]);

  function typing() {
    const now = Date.now();
    if (now - lastTyping.current < TYPING_EVERY_MS) return;
    if (request("typing.start", { channel_id: channel.id })) lastTyping.current = now;
  }

  function retry(message: ChatMessage) {
    discard.mutate(message);
    send.mutate({ content: message.content, nonce: message.nonce ?? newNonce() });
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={`#${channel.name}`}>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2 md:px-4">
        {headerStart}
        <Hash className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <h1 className="truncate font-semibold" data-testid="channel-title">
          {channel.name}
        </h1>
        {channel.topic ? (
          <p className="hidden truncate border-l border-border pl-2 text-sm text-muted-foreground sm:block">
            {channel.topic}
          </p>
        ) : null}
      </header>
      {messages.isPending ? (
        <div className="flex-1" role="status" aria-label="Loading messages" />
      ) : messages.isError ? (
        <p className="flex-1 p-4 text-destructive" role="alert">
          Couldn&apos;t load messages.
        </p>
      ) : (
        <MessageList
          messages={list}
          channelName={channel.name}
          hasOlder={Boolean(hasNextPage)}
          loadingOlder={isFetchingNextPage}
          onLoadOlder={loadOlder}
          myId={me?.id ?? ""}
          canManageMessages={hasPerm(channel.permissions, "MANAGE_MESSAGES")}
          onRetry={retry}
          onAtBottomChange={setAtBottom}
        />
      )}
      <TypingIndicator channelId={channel.id} />
      <Composer
        channelName={channel.name}
        disabled={!canSend}
        disabledReason={
          me && !me.email_verified ? "Verify your email to send messages." : undefined
        }
        onTyping={typing}
        onSend={(content) => {
          lastTyping.current = 0; // the next keystroke signals typing again right away
          send.mutate({ content, nonce: newNonce() });
        }}
      />
    </section>
  );
}
