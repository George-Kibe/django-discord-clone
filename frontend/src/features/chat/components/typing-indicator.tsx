"use client";

import { typingText, useTypers } from "@/features/realtime/typing";

/** Fixed height so the list doesn't jump when someone starts or stops typing. */
export function TypingIndicator({ channelId }: { channelId: string }) {
  const text = typingText(useTypers(channelId));
  return (
    <div
      className="h-6 truncate px-4 text-xs text-muted-foreground"
      aria-live="polite"
      data-testid="typing-indicator"
    >
      {text ? (
        <>
          <span className="mr-1 inline-flex gap-0.5 align-middle" aria-hidden>
            <span className="size-1 animate-bounce rounded-full bg-current" />
            <span className="size-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
            <span className="size-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
          </span>
          <strong className="font-semibold">{text}</strong>
        </>
      ) : null}
    </div>
  );
}
