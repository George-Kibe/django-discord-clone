"use client";

import { CornerUpLeft, Flag, Pencil, Pin, PinOff, Reply, RotateCw, Trash2 } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { UserAvatar } from "@/components/user-avatar";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils";

import {
  useDeleteMessage,
  useEditMessage,
  useSetPinned,
  useToggleReaction,
  type ChatMessage,
  type Conversation,
} from "../api";
import { emojiName } from "../emoji";
import {
  decodeMentions,
  encodeMentions,
  mentionsMe,
  mentionsToMarkdown,
  type Mentionables,
} from "../mentions";
import { PollCard } from "@/features/polls/components/poll-card";

import { Attachments } from "./attachments";
import { EmojiPicker } from "./emoji-picker";
import { Markdown, type MentionStyle } from "./markdown";
import { ReportDialog } from "./report-dialog";

const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export type MessageContext = {
  conversation: Conversation;
  myId: string;
  myRoleIds: ReadonlySet<string>;
  canManageMessages: boolean;
  canReact: boolean;
  canPin: boolean;
  blockedIds: ReadonlySet<string>;
  mentionables: Mentionables;
  mentionStyle: MentionStyle;
  onReply: (message: ChatMessage) => void;
  onRetry: (message: ChatMessage) => void;
};

function ReplyLine({ message }: { message: ChatMessage }) {
  const reply = message.reply_to;
  if (!reply) return null;
  const name = reply.author ? reply.author.display_name || reply.author.username : "Deleted User";
  return (
    <div
      className="flex items-center gap-1 pl-12 text-xs text-muted-foreground"
      data-testid="reply-preview"
    >
      <CornerUpLeft className="size-3.5 shrink-0" aria-hidden />
      {reply.deleted ? (
        <span className="italic">Original message was deleted</span>
      ) : (
        <>
          <span className="font-semibold text-foreground">@{name}</span>
          <span className="truncate">
            {reply.content || (reply.has_attachments ? "Click to see attachment" : "")}
          </span>
        </>
      )}
    </div>
  );
}

function Reactions({ message, ctx }: { message: ChatMessage; ctx: MessageContext }) {
  const toggle = useToggleReaction(ctx.conversation);
  if (!message.reactions.length || message.pending) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1" data-testid="reactions">
      {message.reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => toggle.mutate({ message, emoji: r.emoji })}
          disabled={!ctx.canReact && !r.me}
          aria-pressed={r.me}
          aria-label={`${emojiName(r.emoji)}: ${r.count} reaction${r.count === 1 ? "" : "s"}${r.me ? ", including you" : ""}`}
          className={cn(
            "flex h-6 items-center gap-1 rounded-md border px-1.5 text-sm",
            r.me
              ? "border-primary bg-primary/15"
              : "border-border bg-card hover:border-muted-foreground",
          )}
          data-testid="reaction"
        >
          <span aria-hidden>{r.emoji}</span>
          <span className="text-xs font-semibold" aria-hidden>
            {r.count}
          </span>
        </button>
      ))}
      {ctx.canReact ? (
        <EmojiPicker
          label="Add reaction"
          align="start"
          onPick={(emoji) => toggle.mutate({ message, emoji })}
          trigger={
            <button
              type="button"
              aria-label="Add reaction"
              className="flex h-6 items-center rounded-md border border-border px-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              +
            </button>
          }
        />
      ) : null}
    </div>
  );
}

export function MessageItem({
  message,
  grouped,
  ctx,
}: {
  message: ChatMessage;
  grouped: boolean;
  ctx: MessageContext;
}) {
  const edit = useEditMessage(ctx.conversation);
  const remove = useDeleteMessage(ctx.conversation);
  const toggleReaction = useToggleReaction(ctx.conversation);
  const setPinned = useSetPinned(ctx.conversation);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [reporting, setReporting] = useState(false);
  const created = new Date(message.created_at);
  const author = message.author;
  const name = author ? author.display_name || author.username : "Deleted User";
  const mine = author?.id === ctx.myId;
  const canEdit = mine && !message.pending;
  const canDelete = mine || ctx.canManageMessages;
  const blocked = Boolean(author && ctx.blockedIds.has(author.id)) && !revealed;
  const highlighted = !message.pending && mentionsMe(message, ctx.myId, ctx.myRoleIds);
  const showHeader = !grouped || Boolean(message.reply_to);

  function startEditing() {
    setDraft(decodeMentions(message.content, message));
    setEditing(true);
  }

  async function save() {
    const content = encodeMentions(draft.trim(), ctx.mentionables);
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

  async function pin(pinned: boolean) {
    try {
      await setPinned.mutateAsync({ message, pinned });
      toast.success(pinned ? "Message pinned." : "Message unpinned.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't change the pin.");
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void save();
    } else if (event.key === "Escape") {
      setEditing(false);
    }
  }

  if (blocked) {
    return (
      <div className="px-4 py-1 pl-16 text-sm text-muted-foreground" data-testid="blocked-message">
        Blocked message —{" "}
        <button type="button" className="underline" onClick={() => setRevealed(true)}>
          Show
        </button>
      </div>
    );
  }

  return (
    <article
      className={cn(
        "group relative px-4 hover:bg-accent/40",
        showHeader ? "mt-3 pt-1 pb-0.5" : "py-0.5",
        highlighted && "border-l-2 border-amber-500 bg-amber-500/10 hover:bg-amber-500/15",
      )}
      aria-label={`${name} at ${dateTime.format(created)}`}
      data-testid="message"
      data-message-id={message.id}
      data-pending={message.pending ? "true" : "false"}
      data-mentioned={highlighted ? "true" : "false"}
    >
      <ReplyLine message={message} />
      <div className="flex gap-3">
        <div className="w-10 shrink-0">
          {!showHeader ? (
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
          {showHeader ? (
            <header className="flex items-baseline gap-2">
              <span className="font-semibold">{name}</span>
              <time
                dateTime={message.created_at}
                className="text-xs text-muted-foreground"
                title={dateTime.format(created)}
              >
                {dateTime.format(created)}
              </time>
              {message.pinned_at ? (
                <Pin className="size-3 text-muted-foreground" aria-label="Pinned" />
              ) : null}
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
              {message.content ? (
                <Markdown mentions={ctx.mentionStyle}>{mentionsToMarkdown(message)}</Markdown>
              ) : null}
              {message.edited_at ? (
                <span className="ml-1 text-[0.65rem] text-muted-foreground">(edited)</span>
              ) : null}
              {message.failed ? (
                <button
                  type="button"
                  onClick={() => ctx.onRetry(message)}
                  className="ml-2 inline-flex items-center gap-1 text-xs underline"
                >
                  <RotateCw className="size-3" aria-hidden /> Not sent. Retry
                </button>
              ) : null}
            </div>
          )}
          <Attachments items={message.attachments} />
          {message.poll ? (
            <PollCard
              message={message}
              poll={message.poll}
              conversation={ctx.conversation}
              canClose={mine || ctx.canManageMessages}
            />
          ) : null}
          <Reactions message={message} ctx={ctx} />
        </div>
      </div>
      {!editing && !message.pending ? (
        <div
          className="absolute -top-3 right-4 hidden rounded-md border border-border bg-card shadow-sm group-focus-within:flex group-hover:flex has-[[data-state=open]]:flex"
          role="toolbar"
          aria-label="Message actions"
        >
          {ctx.canReact ? (
            <EmojiPicker
              label="Add reaction"
              onPick={(emoji) => toggleReaction.mutate({ message, emoji })}
            />
          ) : null}
          <button
            type="button"
            onClick={() => ctx.onReply(message)}
            aria-label="Reply"
            className="p-1.5 hover:bg-accent"
          >
            <Reply className="size-4" aria-hidden />
          </button>
          {ctx.canPin ? (
            <button
              type="button"
              onClick={() => void pin(!message.pinned_at)}
              aria-label={message.pinned_at ? "Unpin message" : "Pin message"}
              className="p-1.5 hover:bg-accent"
            >
              {message.pinned_at ? (
                <PinOff className="size-4" aria-hidden />
              ) : (
                <Pin className="size-4" aria-hidden />
              )}
            </button>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              onClick={startEditing}
              aria-label="Edit message"
              className="p-1.5 hover:bg-accent"
            >
              <Pencil className="size-4" aria-hidden />
            </button>
          ) : null}
          {!mine && author ? (
            <button
              type="button"
              onClick={() => setReporting(true)}
              aria-label="Report message"
              className="p-1.5 hover:bg-accent"
            >
              <Flag className="size-4" aria-hidden />
            </button>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              onClick={() => void del()}
              aria-label="Delete message"
              className="p-1.5 text-destructive hover:bg-accent"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>
      ) : message.pending && canDelete ? (
        <div className="absolute -top-3 right-4 hidden rounded-md border border-border bg-card shadow-sm group-focus-within:flex group-hover:flex">
          <button
            type="button"
            onClick={() => void del()}
            aria-label="Delete message"
            className="p-1.5 text-destructive hover:bg-accent"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}
      {reporting ? (
        <ReportDialog messageId={message.id} open={reporting} onOpenChange={setReporting} />
      ) : null}
    </article>
  );
}
