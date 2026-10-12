"use client";

import { BarChart3, FileText, Loader2, Paperclip, X } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { toast } from "sonner";

import { UserAvatar } from "@/components/user-avatar";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api/errors";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, uploadAttachment } from "@/lib/media/upload";
import { cn } from "@/lib/utils";

import { PollDialog } from "@/features/polls/components/poll-dialog";

import type { ChatMessage, PollInput, UploadedAttachment } from "../api";
import { encodeMentions, mentionQuery, type Mentionables } from "../mentions";
import { formatBytes } from "./attachments";
import { EmojiPicker } from "./emoji-picker";

const MAX = 4000;

type Upload = {
  key: string;
  file: File;
  progress: number;
  status: "uploading" | "done" | "error";
  publicId?: string;
  isImage: boolean;
  localUrl: string | null;
  abort: AbortController;
};

type Suggestion =
  | {
      kind: "user";
      id: string;
      label: string;
      detail: string;
      insert: string;
      user: Mentionables["users"][number];
    }
  | { kind: "role"; id: string; label: string; detail: string; insert: string }
  | { kind: "everyone"; id: string; label: string; detail: string; insert: string };

function suggestions(query: string, m: Mentionables): Suggestion[] {
  const q = query.toLowerCase();
  const users: Suggestion[] = m.users
    .filter(
      (u) =>
        u.username.toLowerCase().startsWith(q) ||
        (u.display_name ?? "").toLowerCase().startsWith(q),
    )
    .map((u) => ({
      kind: "user",
      id: u.id,
      label: u.display_name || u.username,
      detail: `@${u.username}`,
      insert: `@${u.username} `,
      user: u,
    }));
  const roles: Suggestion[] = m.roles
    .filter((r) => r.name.toLowerCase().startsWith(q))
    .map((r) => ({
      kind: "role",
      id: r.id,
      label: `@${r.name}`,
      detail: "Role",
      insert: `@${r.name} `,
    }));
  const everyone: Suggestion[] =
    m.everyone && "everyone".startsWith(q)
      ? [
          {
            kind: "everyone",
            id: "everyone",
            label: "@everyone",
            detail: "Notify everyone who can see this",
            insert: "@everyone ",
          },
        ]
      : [];
  return [...users, ...roles, ...everyone].slice(0, 8);
}

export function Composer({
  label,
  disabled,
  disabledReason,
  canAttach,
  mentionables,
  replyTo,
  onCancelReply,
  onSend,
  onTyping,
  canCreatePolls = false,
  onSendPoll,
}: {
  /** "#general" or "@ana": used in the placeholder and label. */
  label: string;
  disabled: boolean;
  disabledReason?: string;
  canAttach: boolean;
  mentionables: Mentionables;
  replyTo: ChatMessage | null;
  onCancelReply: () => void;
  onSend: (content: string, attachments: UploadedAttachment[]) => void;
  onTyping?: () => void;
  canCreatePolls?: boolean;
  onSendPoll?: (poll: PollInput) => void;
}) {
  const [polling, setPolling] = useState(false);
  const [value, setValue] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const listId = useId();

  const query = useMemo(() => mentionQuery(value.slice(0, caret)), [value, caret]);
  const options = useMemo(
    () => (query && query.start !== dismissed ? suggestions(query.query, mentionables) : []),
    [query, dismissed, mentionables],
  );
  const open = options.length > 0;
  const uploading = uploads.some((u) => u.status === "uploading");

  useEffect(() => {
    if (replyTo) ref.current?.focus();
  }, [replyTo]);

  // Revoke local previews when uploads go away.
  useEffect(
    () => () => {
      for (const u of uploads) if (u.localUrl) URL.revokeObjectURL(u.localUrl);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function addFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    if (!canAttach) {
      toast.error("You can't attach files here.");
      return;
    }
    const room = MAX_ATTACHMENTS - uploads.length;
    if (list.length > room) toast.error(`You can attach up to ${MAX_ATTACHMENTS} files.`);
    for (const file of list.slice(0, Math.max(0, room))) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast.error(`${file.name} is larger than 10 MB.`);
        continue;
      }
      const isImage = file.type.startsWith("image/");
      const upload: Upload = {
        key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
        file,
        progress: 0,
        status: "uploading",
        isImage,
        localUrl: isImage ? URL.createObjectURL(file) : null,
        abort: new AbortController(),
      };
      setUploads((current) => [...current, upload]);
      const update = (patch: Partial<Upload>) =>
        setUploads((current) =>
          current.map((u) => (u.key === upload.key ? { ...u, ...patch } : u)),
        );
      uploadAttachment(file, (progress) => update({ progress }), upload.abort.signal)
        .then(({ publicId, isImage: image }) =>
          update({ status: "done", progress: 1, publicId, isImage: image }),
        )
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          update({ status: "error" });
          toast.error(error instanceof ApiError ? error.message : `Couldn't upload ${file.name}.`);
        });
    }
  }

  function removeUpload(key: string) {
    setUploads((current) => {
      const target = current.find((u) => u.key === key);
      target?.abort.abort();
      if (target?.localUrl) URL.revokeObjectURL(target.localUrl);
      return current.filter((u) => u.key !== key);
    });
  }

  function submit() {
    const content = encodeMentions(value.trim(), mentionables);
    const ready = uploads.filter((u) => u.status === "done" && u.publicId);
    if ((!content && !ready.length) || content.length > MAX || uploading) return;
    onSend(
      content,
      ready.map((u) => ({
        publicId: u.publicId!,
        filename: u.file.name,
        size: u.file.size,
        isImage: u.isImage,
        localUrl: u.localUrl,
      })),
    );
    setValue("");
    setUploads([]);
    ref.current?.focus();
  }

  function choose(option: Suggestion) {
    if (!query) return;
    const before = value.slice(0, query.start);
    const after = value.slice(caret);
    const next = `${before}${option.insert}${after}`;
    setValue(next);
    const position = before.length + option.insert.length;
    setCaret(position);
    requestAnimationFrame(() => {
      ref.current?.setSelectionRange(position, position);
      ref.current?.focus();
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setActive((i) => (i + delta + options.length) % options.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        choose(options[Math.min(active, options.length - 1)]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(query?.start ?? null);
        return;
      }
    }
    if (event.key === "Escape" && replyTo) {
      onCancelReply();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (event.clipboardData.files.length) {
      event.preventDefault();
      addFiles(event.clipboardData.files);
    }
  }

  function onDrop(event: DragEvent<HTMLFormElement>) {
    if (event.dataTransfer.files.length) {
      event.preventDefault();
      addFiles(event.dataTransfer.files);
    }
  }

  const replyName = replyTo?.author
    ? replyTo.author.display_name || replyTo.author.username
    : "Deleted User";

  return (
    <form
      className="relative px-4 pb-1"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Mention suggestions"
          className="absolute right-4 bottom-full left-4 z-20 mb-1 max-h-64 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md"
          data-testid="mention-suggestions"
        >
          {options.map((option, index) => (
            <li
              key={`${option.kind}-${option.id}`}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => {
                event.preventDefault(); // keep focus in the textarea
                choose(option);
              }}
              onMouseEnter={() => setActive(index)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm",
                index === active && "bg-accent",
              )}
            >
              {option.kind === "user" ? (
                <UserAvatar user={option.user} className="size-6 text-xs" />
              ) : null}
              <span className="font-medium">{option.label}</span>
              <span className="ml-auto truncate text-xs text-muted-foreground">
                {option.detail}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {replyTo ? (
        <div
          className="flex items-center justify-between rounded-t-md bg-muted px-3 py-1.5 text-sm"
          data-testid="replying-to"
        >
          <span className="truncate text-muted-foreground">
            Replying to <strong className="text-foreground">{replyName}</strong>
          </span>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Cancel reply"
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}
      {uploads.length ? (
        <ul
          className={cn("flex gap-2 overflow-x-auto bg-card p-2", !replyTo && "rounded-t-md")}
          aria-label="Attachments to send"
          data-testid="pending-uploads"
        >
          {uploads.map((u) => (
            <li
              key={u.key}
              className="relative flex w-36 shrink-0 flex-col gap-1 rounded-md border border-border bg-background p-2"
              data-status={u.status}
            >
              {u.localUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={u.localUrl} alt="" className="h-20 w-full rounded object-cover" />
              ) : (
                <FileText className="h-20 w-full text-muted-foreground" aria-hidden />
              )}
              <span className="truncate text-xs">{u.file.name}</span>
              <span className="text-[0.65rem] text-muted-foreground">
                {u.status === "uploading"
                  ? `Uploading ${Math.round(u.progress * 100)}%`
                  : u.status === "error"
                    ? "Upload failed"
                    : formatBytes(u.file.size)}
              </span>
              <button
                type="button"
                onClick={() => removeUpload(u.key)}
                aria-label={`Remove ${u.file.name}`}
                className="absolute top-1 right-1 rounded-full bg-background/90 p-0.5 text-muted-foreground hover:text-destructive"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-end gap-1 rounded-md bg-card pr-1 focus-within:ring-2 focus-within:ring-ring">
        {canAttach && !disabled ? (
          <>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              aria-label="Attach files"
              className="flex size-11 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
            >
              <Paperclip className="size-5" aria-hidden />
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              data-testid="file-input"
              onChange={(event) => {
                if (event.target.files) addFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </>
        ) : null}
        <label htmlFor="composer" className="sr-only">
          Message {label}
        </label>
        <Textarea
          id="composer"
          ref={ref}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setActive(0);
            if (e.target.value.trim()) onTyping?.();
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          disabled={disabled}
          rows={1}
          maxLength={MAX}
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          placeholder={
            disabled ? (disabledReason ?? "You can't send messages here.") : `Message ${label}`
          }
          className="max-h-60 min-h-11 flex-1 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          data-testid="composer"
        />
        {!disabled ? (
          <div className="flex h-11 items-center">
            {uploading ? (
              <Loader2
                className="mr-1 size-4 animate-spin text-muted-foreground"
                aria-label="Uploading"
              />
            ) : null}
            {canCreatePolls && onSendPoll ? (
              <button
                type="button"
                onClick={() => setPolling(true)}
                aria-label="Create poll"
                className="flex size-8 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                data-testid="create-poll"
              >
                <BarChart3 className="size-4" aria-hidden />
              </button>
            ) : null}
            <EmojiPicker
              label="Insert emoji"
              onPick={(emoji) => {
                const next = value.slice(0, caret) + emoji + value.slice(caret);
                setValue(next);
                setCaret(caret + emoji.length);
                ref.current?.focus();
              }}
            />
          </div>
        ) : null}
      </div>
      {onSendPoll ? (
        <PollDialog open={polling} onOpenChange={setPolling} onCreate={onSendPoll} />
      ) : null}
      {value.length > MAX - 200 ? (
        <p className="mt-1 text-right text-xs text-muted-foreground" aria-live="polite">
          {value.length}/{MAX}
        </p>
      ) : null}
    </form>
  );
}
