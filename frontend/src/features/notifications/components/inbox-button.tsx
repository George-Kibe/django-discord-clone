"use client";

import { Bell, CheckCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";

import { unreadCount, useInbox, useMarkRead, type AppNotification } from "../api";
import { describe, notificationHref } from "../browser";

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function ago(iso: string): string {
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, "hour");
  return relative.format(Math.round(hours / 24), "day");
}

function Item({ n, onOpen }: { n: AppNotification; onOpen: (n: AppNotification) => void }) {
  const { title, body } = describe(n);
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(n)}
        className={cn(
          "flex w-full gap-3 rounded-md p-2 text-left hover:bg-accent",
          !n.read_at && "bg-primary/10",
        )}
        data-testid="notification"
        data-read={n.read_at ? "true" : "false"}
      >
        {n.actor ? <UserAvatar user={n.actor} className="size-9" /> : null}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{title}</span>
          {body ? (
            <span className="line-clamp-2 block text-sm text-muted-foreground">{body}</span>
          ) : null}
          <span className="block text-xs text-muted-foreground">
            {(n.data as { server_name?: string }).server_name
              ? `${(n.data as { server_name?: string }).server_name} · `
              : ""}
            {ago(n.created_at)}
          </span>
        </span>
        {!n.read_at ? <span className="sr-only">(unread)</span> : null}
      </button>
    </li>
  );
}

/** Notification inbox (FR-PRES-02): mentions, replies and DMs. */
export function InboxButton() {
  const [open, setOpen] = useState(false);
  const inbox = useInbox();
  const markRead = useMarkRead();
  const router = useRouter();
  const unread = unreadCount(inbox.data);
  const items = inbox.data?.pages.flatMap((p) => p.results) ?? [];
  const label = unread ? `Inbox, ${unread} unread` : "Inbox";

  function openItem(n: AppNotification) {
    if (!n.read_at) markRead.mutate([n.id]);
    setOpen(false);
    router.push(notificationHref(n));
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger
            aria-label={label}
            className="relative flex size-12 items-center justify-center rounded-3xl bg-card text-muted-foreground transition-all hover:rounded-2xl hover:bg-primary hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            data-testid="inbox-button"
          >
            <Bell className="size-5" aria-hidden />
            {unread ? (
              <span
                className="absolute -right-1 -bottom-1 min-w-5 rounded-full bg-[#d83c3e] px-1 text-center text-xs leading-5 font-bold text-white"
                aria-hidden
                data-testid="inbox-count"
              >
                {unread > 99 ? "99+" : unread}
              </span>
            ) : null}
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">Inbox</TooltipContent>
      </Tooltip>
      <PopoverContent side="right" align="start" className="w-96 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <h2 className="font-semibold">Inbox</h2>
          <Button
            variant="ghost"
            size="sm"
            disabled={!unread}
            onClick={() => markRead.mutate("all")}
          >
            <CheckCheck /> Mark all read
          </Button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-2">
          {inbox.isPending ? (
            <p className="p-2 text-sm text-muted-foreground">Loading…</p>
          ) : !items.length ? (
            <p className="p-2 text-sm text-muted-foreground">
              Nothing yet. Mentions, replies and DMs show up here.
            </p>
          ) : (
            <ul className="grid gap-1" data-testid="inbox-list">
              {items.map((n) => (
                <Item key={n.id} n={n} onOpen={openItem} />
              ))}
            </ul>
          )}
          {inbox.hasNextPage ? (
            <Button
              variant="outline"
              className="mt-2 w-full"
              onClick={() => void inbox.fetchNextPage()}
              disabled={inbox.isFetchingNextPage}
            >
              Load more
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
