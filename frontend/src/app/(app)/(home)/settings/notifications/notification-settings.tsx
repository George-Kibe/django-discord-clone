"use client";

import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { UserAvatar } from "@/components/user-avatar";
import { useBlocks, useSetBlocked } from "@/features/dms/api";
import {
  browserNotificationsEnabled,
  browserNotificationsSupported,
  setBrowserNotificationsEnabled,
} from "@/features/notifications/browser";

const noop = () => () => undefined;

export function NotificationSettings() {
  // Read browser-only state after hydration.
  const supported = useSyncExternalStore(noop, browserNotificationsSupported, () => false);
  const [enabled, setEnabled] = useState(() =>
    typeof window === "undefined" ? false : browserNotificationsEnabled(),
  );
  const blocks = useBlocks();
  const setBlocked = useSetBlocked();

  async function toggle(on: boolean) {
    if (!on) {
      setBrowserNotificationsEnabled(false);
      setEnabled(false);
      return;
    }
    const permission =
      Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
    if (permission !== "granted") {
      toast.error("Your browser blocked notifications. Allow them in the site settings.");
      return;
    }
    setBrowserNotificationsEnabled(true);
    setEnabled(true);
  }

  return (
    <div className="grid gap-8">
      <section className="grid gap-4" aria-labelledby="desktop-heading">
        <div>
          <h1 id="desktop-heading" className="text-xl font-semibold">
            Notifications
          </h1>
          <p className="text-sm text-muted-foreground">
            Mentions, replies and direct messages always appear in your inbox. Mute a server,
            channel or conversation from its header to silence @everyone, role mentions and DMs
            there.
          </p>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
          <Label htmlFor="desktop-notifications" className="grid gap-1">
            <span>Desktop notifications</span>
            <span className="text-xs font-normal text-muted-foreground">
              {supported
                ? "Show a notification when this tab is in the background."
                : "This browser doesn't support notifications."}
            </span>
          </Label>
          <Switch
            id="desktop-notifications"
            checked={enabled}
            disabled={!supported}
            onCheckedChange={(on) => void toggle(on)}
          />
        </div>
      </section>
      <Separator />
      <section className="grid gap-3" aria-labelledby="blocked-heading">
        <div>
          <h2 id="blocked-heading" className="text-lg font-semibold">
            Blocked users
          </h2>
          <p className="text-sm text-muted-foreground">
            Blocked users can&apos;t message you, and their messages are collapsed.
          </p>
        </div>
        {blocks.data?.length ? (
          <ul className="grid gap-2" data-testid="blocked-users">
            {blocks.data.map((user) => (
              <li
                key={user.id}
                className="flex items-center gap-3 rounded-md border border-border p-2"
              >
                <UserAvatar user={user} className="size-8" />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {user.display_name || user.username}{" "}
                  <span className="text-muted-foreground">@{user.username}</span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setBlocked.mutate({ userId: user.id, blocked: false })}
                >
                  Unblock
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">You haven&apos;t blocked anyone.</p>
        )}
      </section>
    </div>
  );
}
