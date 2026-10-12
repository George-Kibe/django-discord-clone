"use client";

import { Pin } from "lucide-react";
import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UserAvatar } from "@/components/user-avatar";

import { usePins, type Conversation } from "../api";
import { mentionsToMarkdown } from "../mentions";
import { Attachments } from "./attachments";
import { Markdown } from "./markdown";

/** Pinned messages (FR-MSG-13), refreshed by pins.updated events. */
export function PinsButton({ conversation }: { conversation: Conversation }) {
  const [open, setOpen] = useState(false);
  const pins = usePins(conversation, open);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Pinned messages"
        className="flex size-8 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        data-testid="pins-button"
      >
        <Pin className="size-4" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <h2 className="border-b border-border px-3 py-2 font-semibold">Pinned messages</h2>
        <div className="max-h-[60vh] overflow-y-auto p-2" data-testid="pins-list">
          {pins.isPending ? (
            <p className="p-2 text-sm text-muted-foreground">Loading…</p>
          ) : !pins.data?.length ? (
            <p className="p-2 text-sm text-muted-foreground">No pinned messages yet.</p>
          ) : (
            <ul className="grid gap-2">
              {pins.data.map((message) => (
                <li key={message.id} className="rounded-md border border-border p-2">
                  <div className="mb-1 flex items-center gap-2">
                    {message.author ? (
                      <UserAvatar user={message.author} className="size-6 text-xs" />
                    ) : null}
                    <span className="text-sm font-semibold">
                      {message.author?.display_name || message.author?.username || "Deleted User"}
                    </span>
                    <time
                      className="ml-auto text-xs text-muted-foreground"
                      dateTime={message.created_at}
                    >
                      {new Date(message.created_at).toLocaleDateString()}
                    </time>
                  </div>
                  <div className="text-sm">
                    <Markdown>{mentionsToMarkdown(message)}</Markdown>
                  </div>
                  <Attachments items={message.attachments} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
