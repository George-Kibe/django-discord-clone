"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { Loader2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { ChatMessage } from "../api";
import { MessageItem, type MessageContext } from "./message-item";

const GROUP_WINDOW_MS = 5 * 60 * 1000;

export function isGrouped(previous: ChatMessage | undefined, message: ChatMessage): boolean {
  if (!previous || !previous.author || !message.author) return false;
  if (previous.author.id !== message.author.id) return false;
  return (
    new Date(message.created_at).getTime() - new Date(previous.created_at).getTime() <
    GROUP_WINDOW_MS
  );
}

/**
 * Virtualised, bottom-anchored message list (FR-MSG-05). Scrolling to the top loads older pages;
 * the scroll position is kept stable when they're prepended, and new messages stick to the
 * bottom only if the reader was already there.
 */
export function MessageList({
  messages,
  channelName,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  ctx,
  intro,
  onAtBottomChange,
}: {
  messages: ChatMessage[];
  channelName: string;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  ctx: MessageContext;
  /** Shown above the first message ("Welcome to #general!"). */
  intro: React.ReactNode;
  onAtBottomChange?: (atBottom: boolean) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const firstId = useRef<string | undefined>(undefined);
  const count = messages.length + 1; // +1 for the header row (start of channel / loader)

  // TanStack Virtual returns non-memoisable functions; fine here (the React Compiler isn't enabled).
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 12,
    // Key by the client nonce when present, so a row keeps its DOM (hover, focus) when the
    // optimistic copy is swapped for the confirmed message.
    getItemKey: (index) =>
      index === 0 ? "__top__" : (messages[index - 1].nonce ?? messages[index - 1].id),
  });

  const totalSize = virtualizer.getTotalSize();
  const [viewport, setViewport] = useState(0);
  const bottomGap = Math.max(0, viewport - totalSize); // short channels sit at the bottom

  useEffect(() => {
    const element = parentRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewport(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Keep the reader's place when older messages are prepended.
  useLayoutEffect(() => {
    const first = messages[0]?.id;
    if (firstId.current && first !== firstId.current) {
      const previousFirstIndex = messages.findIndex((m) => m.id === firstId.current);
      if (previousFirstIndex > 0)
        virtualizer.scrollToIndex(previousFirstIndex + 1, { align: "start" });
    }
    firstId.current = first;
  }, [messages, virtualizer]);

  // Stick to the bottom while the reader is there. New messages arrive and rows get measured
  // (which grows the list after the first jump), so re-pin whenever the size changes.
  useLayoutEffect(() => {
    const element = parentRef.current;
    if (element && atBottom.current) element.scrollTop = element.scrollHeight;
  }, [totalSize, viewport, messages.length]);

  useEffect(() => {
    const element = parentRef.current;
    if (!element) return;
    const onScroll = () => {
      const bottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
      if (bottom !== atBottom.current) onAtBottomChange?.(bottom);
      atBottom.current = bottom;
      if (element.scrollTop < 200 && hasOlder && !loadingOlder) onLoadOlder();
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, [hasOlder, loadingOlder, onLoadOlder, onAtBottomChange]);

  return (
    <div
      ref={parentRef}
      className="min-h-0 flex-1 overflow-y-auto"
      role="log"
      aria-live="polite"
      aria-label={`Messages in ${channelName}`}
      data-testid="message-list"
    >
      <div className="relative w-full" style={{ height: totalSize + bottomGap }}>
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            data-index={row.index}
            ref={virtualizer.measureElement}
            className="absolute top-0 left-0 w-full"
            style={{ transform: `translateY(${row.start + bottomGap}px)` }}
          >
            {row.index === 0 ? (
              hasOlder ? (
                <div className="flex justify-center py-4 text-muted-foreground" role="status">
                  {loadingOlder ? (
                    <Loader2 className="size-5 animate-spin" aria-label="Loading older messages" />
                  ) : null}
                </div>
              ) : (
                <div className="px-4 pt-16 pb-4">{intro}</div>
              )
            ) : (
              <MessageItem
                message={messages[row.index - 1]}
                grouped={isGrouped(messages[row.index - 2], messages[row.index - 1])}
                ctx={ctx}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
