"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useRealtime } from "@/features/realtime/provider";
import { stateKey, useAck, useReadStates } from "@/features/realtime/read-states";
import { useBlockedIds } from "@/features/dms/api";
import { useMe } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";

import {
  flattenMessages,
  newNonce,
  useDeleteMessage,
  useMessages,
  useSendMessage,
  type ChatMessage,
  type Conversation,
} from "../api";
import type { Mentionables } from "../mentions";
import { Composer } from "./composer";
import type { MentionStyle } from "./markdown";
import type { MessageContext } from "./message-item";
import { MessageList } from "./message-list";
import { TypingIndicator } from "./typing-indicator";

const TYPING_EVERY_MS = 5000; // the server shows "typing" for 8 s per signal
const ACK_EVERY_MS = 1000;

/**
 * Marks the conversation read while the newest message is on screen and the tab is visible.
 * Throttled: a busy channel sends at most one ack per second (for the newest message then).
 */
function useAutoAck(conversation: Conversation, newestId: string | undefined, atBottom: boolean) {
  const { mutate: ack } = useAck(conversation);
  const { data: states } = useReadStates();
  const state = states?.find((s) => stateKey(s) === conversation.id);
  const lastRead = state?.last_read_message_id;
  const unread = (state?.mention_count ?? 0) > 0;
  const sent = useRef<string | undefined>(undefined);
  const latest = useRef({ newestId, atBottom, lastRead, unread });
  const timer = useRef<number | null>(null);

  useEffect(() => {
    latest.current = { newestId, atBottom, lastRead, unread };
  });

  const flush = useCallback(() => {
    const { newestId: id, atBottom: bottom, lastRead: read, unread: badge } = latest.current;
    if (!bottom || !id || document.visibilityState !== "visible") return;
    const upToDate = (read && read >= id) || (sent.current && sent.current >= id);
    if (upToDate && !badge) return;
    sent.current = id;
    ack(id);
  }, [ack]);

  useEffect(() => {
    if (!atBottom || !newestId || timer.current !== null) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      flush();
    }, ACK_EVERY_MS);
  }, [atBottom, newestId, unread, flush]);

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
  conversation,
  label,
  title,
  icon,
  topic,
  permissions,
  mentionables,
  mentionStyle = {},
  myRoleIds = new Set(),
  intro,
  headerStart,
  headerActions,
  sendBlockedReason,
}: {
  conversation: Conversation;
  /** "#general" / "@ana": composer placeholder and accessible names. */
  label: string;
  title: ReactNode;
  icon: ReactNode;
  topic?: string;
  permissions: number;
  mentionables: Mentionables;
  mentionStyle?: MentionStyle;
  myRoleIds?: ReadonlySet<string>;
  intro: ReactNode;
  headerStart?: ReactNode;
  headerActions?: ReactNode;
  /** Why sending is impossible even with permissions (e.g. a block). */
  sendBlockedReason?: string;
}) {
  const { data: me } = useMe();
  const messages = useMessages(conversation);
  const author = me
    ? {
        id: me.id,
        username: me.username,
        display_name: me.display_name ?? "",
        avatar_url: me.avatar_url,
      }
    : null;
  const send = useSendMessage(conversation, author);
  const discard = useDeleteMessage(conversation);
  const blockedIds = useBlockedIds();
  const list = useMemo(() => flattenMessages(messages.data), [messages.data]);
  const newestId = useMemo(() => list.findLast((m) => !m.pending)?.id, [list]);
  const [atBottom, setAtBottom] = useState(true);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  useAutoAck(conversation, newestId, atBottom);
  const { request } = useRealtime();
  const lastTyping = useRef(0);
  const verified = Boolean(me?.email_verified);
  const canSend = hasPerm(permissions, "SEND_MESSAGES") && verified && !sendBlockedReason;
  const { fetchNextPage, isFetchingNextPage, hasNextPage } = messages;
  const loadOlder = useCallback(() => void fetchNextPage(), [fetchNextPage]);

  function typing() {
    const now = Date.now();
    if (now - lastTyping.current < TYPING_EVERY_MS) return;
    const target =
      conversation.kind === "channel"
        ? { channel_id: conversation.id }
        : { dm_id: conversation.id };
    if (request("typing.start", target)) lastTyping.current = now;
  }

  const ctx: MessageContext = {
    conversation,
    myId: me?.id ?? "",
    myRoleIds,
    canManageMessages: hasPerm(permissions, "MANAGE_MESSAGES"),
    canReact: hasPerm(permissions, "ADD_REACTIONS") && !sendBlockedReason,
    canPin: conversation.kind === "dm" || hasPerm(permissions, "MANAGE_MESSAGES"),
    blockedIds,
    mentionables,
    mentionStyle,
    onReply: setReplyTo,
    onRetry: (message) => {
      discard.mutate(message);
      send.mutate({
        content: message.content,
        nonce: message.nonce ?? newNonce(),
        replyTo: null,
      });
    },
  };

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={label}>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2 md:px-4">
        {headerStart}
        <span className="shrink-0 text-muted-foreground">{icon}</span>
        <h1 className="truncate font-semibold" data-testid="channel-title">
          {title}
        </h1>
        {topic ? (
          <p className="hidden truncate border-l border-border pl-2 text-sm text-muted-foreground sm:block">
            {topic}
          </p>
        ) : null}
        <div className="ml-auto flex items-center gap-1">{headerActions}</div>
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
          channelName={label}
          hasOlder={Boolean(hasNextPage)}
          loadingOlder={isFetchingNextPage}
          onLoadOlder={loadOlder}
          ctx={ctx}
          intro={intro}
          onAtBottomChange={setAtBottom}
        />
      )}
      <TypingIndicator channelId={conversation.id} />
      <Composer
        label={label}
        disabled={!canSend}
        disabledReason={
          sendBlockedReason ?? (me && !verified ? "Verify your email to send messages." : undefined)
        }
        canAttach={hasPerm(permissions, "ATTACH_FILES")}
        mentionables={mentionables}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onTyping={typing}
        canCreatePolls={hasPerm(permissions, "CREATE_POLLS") && canSend}
        onSendPoll={(poll) => send.mutate({ content: "", nonce: newNonce(), poll })}
        onSend={(content, attachments) => {
          lastTyping.current = 0; // the next keystroke signals typing again right away
          send.mutate({ content, nonce: newNonce(), replyTo, attachments });
          setReplyTo(null);
        }}
      />
    </section>
  );
}
