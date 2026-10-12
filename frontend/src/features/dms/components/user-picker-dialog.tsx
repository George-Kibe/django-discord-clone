"use client";

import { Check, X } from "lucide-react";
import { useDeferredValue, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";

import { useContacts, type UserSummary } from "../api";

/** Pick people you share a server with (FR-DM-01): new DMs and adding to a group. */
export function UserPickerDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  max,
  exclude = [],
  withName = false,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  submitLabel: (count: number) => string;
  max: number;
  exclude?: string[];
  withName?: boolean;
  onSubmit: (users: UserSummary[], name: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const [picked, setPicked] = useState<UserSummary[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const contacts = useContacts(deferred.trim());
  const options = (contacts.data ?? []).filter((u) => !exclude.includes(u.id));
  const isPicked = (id: string) => picked.some((p) => p.id === id);

  function toggle(user: UserSummary) {
    setPicked((current) =>
      isPicked(user.id)
        ? current.filter((p) => p.id !== user.id)
        : current.length >= max
          ? current
          : [...current, user],
    );
  }

  async function submit() {
    setBusy(true);
    try {
      await onSubmit(picked, name);
      setPicked([]);
      setQuery("");
      setName("");
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  let list: ReactNode;
  if (contacts.isPending) list = <p className="p-2 text-sm text-muted-foreground">Loading…</p>;
  else if (!options.length)
    list = (
      <p className="p-2 text-sm text-muted-foreground">
        {deferred ? "Nobody matches." : "Join a server to find people to message."}
      </p>
    );
  else
    list = (
      <ul className="grid gap-0.5" aria-label="People" data-testid="user-picker-options">
        {options.map((user) => (
          <li key={user.id}>
            <button
              type="button"
              role="checkbox"
              aria-checked={isPicked(user.id)}
              onClick={() => toggle(user)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent",
                isPicked(user.id) && "bg-accent",
              )}
            >
              <UserAvatar user={user} className="size-8" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {user.display_name || user.username}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  @{user.username}
                </span>
              </span>
              {isPicked(user.id) ? <Check className="size-4 text-brand" aria-hidden /> : null}
            </button>
          </li>
        ))}
      </ul>
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {picked.length ? (
          <ul className="flex flex-wrap gap-1" aria-label="Selected">
            {picked.map((user) => (
              <li
                key={user.id}
                className="flex items-center gap-1 rounded-full bg-muted py-0.5 pr-1 pl-2 text-sm"
              >
                {user.display_name || user.username}
                <button
                  type="button"
                  onClick={() => toggle(user)}
                  aria-label={`Remove ${user.username}`}
                  className="rounded-full p-0.5 hover:bg-background"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a username"
          aria-label="Find people"
          autoFocus
        />
        <div className="max-h-64 overflow-y-auto">{list}</div>
        {withName && picked.length > 1 ? (
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Group name (optional)"
            aria-label="Group name"
            maxLength={100}
          />
        ) : null}
        <DialogFooter>
          <Button onClick={() => void submit()} disabled={!picked.length || busy}>
            {submitLabel(picked.length)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
