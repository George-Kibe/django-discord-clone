"use client";

import { useRef, useState, type KeyboardEvent } from "react";

import { Textarea } from "@/components/ui/textarea";

const MAX = 4000;

export function Composer({
  channelName,
  disabled,
  disabledReason,
  onSend,
}: {
  channelName: string;
  disabled: boolean;
  disabledReason?: string;
  onSend: (content: string) => void;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  function submit() {
    const content = value.trim();
    if (!content || content.length > MAX) return;
    onSend(content);
    setValue("");
    ref.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form
      className="px-4 pb-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label htmlFor="composer" className="sr-only">
        Message #{channelName}
      </label>
      <Textarea
        id="composer"
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        rows={1}
        maxLength={MAX}
        placeholder={
          disabled ? (disabledReason ?? "You can't send messages here.") : `Message #${channelName}`
        }
        className="max-h-60 min-h-11 resize-none bg-card"
        data-testid="composer"
      />
      {value.length > MAX - 200 ? (
        <p className="mt-1 text-right text-xs text-muted-foreground" aria-live="polite">
          {value.length}/{MAX}
        </p>
      ) : null}
    </form>
  );
}
