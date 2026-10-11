"use client";

import { Hash } from "lucide-react";
import { useCallback, useMemo } from "react";

import { useMe } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";

import type { Channel } from "@/features/servers/api";

import {
  flattenMessages,
  newNonce,
  useDeleteMessage,
  useMessages,
  useNewMessagePolling,
  useSendMessage,
  type ChatMessage,
} from "../api";
import { Composer } from "./composer";
import { MessageList } from "./message-list";

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
  useNewMessagePolling(channel.id, messages.isSuccess);
  const list = useMemo(() => flattenMessages(messages.data), [messages.data]);
  const canSend = hasPerm(channel.permissions, "SEND_MESSAGES") && Boolean(me?.email_verified);
  const { fetchNextPage, isFetchingNextPage, hasNextPage } = messages;
  const loadOlder = useCallback(() => void fetchNextPage(), [fetchNextPage]);

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
        />
      )}
      <Composer
        channelName={channel.name}
        disabled={!canSend}
        disabledReason={
          me && !me.email_verified ? "Verify your email to send messages." : undefined
        }
        onSend={(content) => send.mutate({ content, nonce: newNonce() })}
      />
    </section>
  );
}
