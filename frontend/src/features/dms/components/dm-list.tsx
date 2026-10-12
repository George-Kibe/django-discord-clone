"use client";

import { Plus, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { MentionBadge } from "@/components/mention-badge";
import { useUnread } from "@/features/realtime/read-states";
import { ApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils";

import { dmName, useDMs, useOpenDM, useUpdateDM, type DMConversation } from "../api";
import { DMAvatar } from "./dm-avatar";
import { UserPickerDialog } from "./user-picker-dialog";

function DMLink({ dm, active }: { dm: DMConversation; active: boolean }) {
  const router = useRouter();
  const close = useUpdateDM(dm.id);
  const { dms: unread, mentions } = useUnread();
  const name = dmName(dm);
  const count = mentions.get(dm.id) ?? 0;
  const isUnread = unread.has(dm.id) && !active;
  return (
    <li className="group relative" data-testid="dm-item">
      <Link
        href={`/channels/me/${dm.id}`}
        aria-current={active ? "page" : undefined}
        data-unread={isUnread}
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1.5 pr-8 text-sm text-muted-foreground hover:bg-accent hover:text-foreground",
          active && "bg-accent text-foreground",
          isUnread && "font-semibold text-foreground",
        )}
      >
        <DMAvatar dm={dm} />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{name}</span>
          {dm.is_group ? (
            <span className="block text-xs font-normal text-muted-foreground">
              {dm.recipients.length + 1} members
            </span>
          ) : null}
        </span>
        {count > 0 && !active ? <MentionBadge count={count} /> : null}
        {isUnread ? <span className="sr-only">(unread)</span> : null}
      </Link>
      <button
        type="button"
        onClick={async () => {
          // The row disappears once closed, so don't rely on mutate()'s per-call callbacks.
          await close.mutateAsync({ closed: true }).catch(() => undefined);
          if (active) router.push("/channels/me");
        }}
        aria-label={`Close conversation with ${name}`}
        className="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </li>
  );
}

/** Direct messages in the Home sidebar (FR-DM-01/02). */
export function DMList() {
  const { data: dms = [] } = useDMs();
  const { dmId } = useParams<{ dmId?: string }>();
  const [picking, setPicking] = useState(false);
  const open = useOpenDM();
  const router = useRouter();

  return (
    <section aria-labelledby="dm-heading" className="px-2 pb-2">
      <div className="flex items-center justify-between px-1 pt-2 pb-1">
        <h2
          id="dm-heading"
          className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        >
          Direct messages
        </h2>
        <button
          type="button"
          onClick={() => setPicking(true)}
          aria-label="New message"
          className="flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          data-testid="new-dm"
        >
          <Plus className="size-4" aria-hidden />
        </button>
      </div>
      {dms.length ? (
        <ul className="grid gap-0.5" data-testid="dm-list">
          {dms.map((dm) => (
            <DMLink key={dm.id} dm={dm} active={dm.id === dmId} />
          ))}
        </ul>
      ) : (
        <p className="px-1 text-xs text-muted-foreground">No conversations yet.</p>
      )}
      <UserPickerDialog
        open={picking}
        onOpenChange={setPicking}
        title="New message"
        description="Message one person, or pick several for a group (up to 10 people)."
        submitLabel={(n) => (n > 1 ? "Create group" : "Open conversation")}
        max={9}
        withName
        onSubmit={async (users, name) => {
          try {
            const dm = await open.mutateAsync({ userIds: users.map((u) => u.id), name });
            router.push(`/channels/me/${dm.id}`);
          } catch (e) {
            toast.error(e instanceof ApiError ? e.message : "Couldn't start the conversation.");
            throw e;
          }
        }}
      />
    </section>
  );
}
