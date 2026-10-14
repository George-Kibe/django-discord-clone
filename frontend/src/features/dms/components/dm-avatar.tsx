"use client";

import { Users } from "lucide-react";

import { PresenceDot } from "@/components/presence-dot";
import { UserAvatar } from "@/components/user-avatar";
import { useLivePresence } from "@/features/realtime/presence";
import { cn } from "@/lib/utils";

import type { DMConversation } from "../api";

/** 1:1: the other person with a presence dot. Groups: a group icon. */
export function DMAvatar({ dm, className }: { dm: DMConversation; className?: string }) {
  const live = useLivePresence();
  if (dm.is_group || !dm.recipients[0]) {
    return (
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground",
          className,
        )}
        aria-hidden
      >
        <Users className="size-4" />
      </span>
    );
  }
  const other = dm.recipients[0];
  const presence = live.get(other.id)?.status ?? other.presence;
  return (
    <span className="relative inline-flex shrink-0">
      <UserAvatar user={other} className={cn("size-8", className)} />
      <PresenceDot status={presence} />
    </span>
  );
}
