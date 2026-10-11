"use client";

import { Pencil, RotateCw, Trash2 } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { UserAvatar } from "@/components/user-avatar";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils";

import { useDeleteMessage, useEditMessage, type ChatMessage } from "../api";
import { Markdown } from "./markdown";

const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function MessageItem({
  message,
  grouped,
  canEdit,
  canDelete,
  onRetry,
}: {
  message: ChatMessage;
  grouped: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onRetry: (message: ChatMessage) => void;
}) {
  const edit = useEditMessage(message.channel_id);
  const remove = useDeleteMessage(message.channel_id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const created = new Date(message.created_at);
  const author = message.author;
  const name = author ? author.display_name || author.username : "Deleted User";

  async function save() {
    const content = draft.trim();
    if (!content || content === message.content) return setEditing(false);
    try {
      await edit.mutateAsync({ id: message.id, content });
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't edit the message.");
    }
  }

  async function del() {
    if (!message.pending && !window.confirm("Delete this message?")) return;
    try {
      await remove.mutateAsync(message);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't delete the message.");
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void save();
    } else if (event.key === "Escape") {
      setEditing(false);
      setDraft(message.content);
    }
  }

  return (
    <article
      className={cn(
        "group relative flex gap-3 px-4 hover:bg-accent/40",
        grouped ? "py-0.5" : "mt-3 pt-1 pb-0.5",
      )}
      aria-label={`${name} at ${dateTime.format(created)}`}
      data-testid="message"
      data-pending={message.pending ? "true" : "false"}
    >
      <div className="w-10 shrink-0">
        {grouped ? (
          <time
            dateTime={message.created_at}
            className="hidden pt-1 text-[0.65rem] text-muted-foreground group-hover:block"
          >
            {time.format(created)}
          </time>
        ) : author ? (
          <UserAvatar user={author} className="size-10" />
        ) : (
          <span className="block size-10 rounded-full bg-muted" aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!grouped ? (
          <header className="flex items-baseline gap-2">
            <span className="font-semibold">{name}</span>
            <time
              dateTime={message.created_at}
              className="text-xs text-muted-foreground"
              title={dateTime.format(created)}
            >
              {dateTime.format(created)}
            </time>
          </header>
        ) : null}
        {editing ? (
          <div className="grid gap-1 py-1">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              autoFocus
              aria-label="Edit message"
            />
            <p className="text-xs text-muted-foreground">Escape to cancel · Enter to save</p>
          </div>
        ) : (
          <div
            className={cn(
              "text-sm leading-relaxed",
              message.pending && "opacity-60",
              message.failed && "text-destructive",
            )}
          >
            <Markdown>{message.content}</Markdown>
            {message.edited_at ? (
              <span className="ml-1 text-[0.65rem] text-muted-foreground">(edited)</span>
            ) : null}
            {message.failed ? (
              <button
                type="button"
                onClick={() => onRetry(message)}
                className="ml-2 inline-flex items-center gap-1 text-xs underline"
              >
                <RotateCw className="size-3" aria-hidden /> Not sent. Retry
              </button>
            ) : null}
          </div>
        )}
      </div>
      {!editing && (canEdit || canDelete) ? (
        <div className="absolute -top-3 right-4 hidden rounded-md border border-border bg-card shadow-sm group-focus-within:flex group-hover:flex">
          {canEdit && !message.pending ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label="Edit message"
              className="p-1.5 hover:bg-accent"
            >
              <Pencil className="size-4" aria-hidden />
            </button>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              onClick={del}
              aria-label="Delete message"
              className="p-1.5 text-destructive hover:bg-accent"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
