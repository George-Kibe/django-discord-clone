"use client";

import { AtSign, Loader2, LogOut, Pencil, Search, UserPlus, Users } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PresenceDot } from "@/components/presence-dot";
import { UserAvatar } from "@/components/user-avatar";
import { ChatView } from "@/features/chat/components/chat-view";
import { PinsButton } from "@/features/chat/components/pins-button";
import { ExportButton } from "@/features/exports/components/export-button";
import { SearchPanel } from "@/features/chat/components/search-panel";
import type { Mentionables } from "@/features/chat/mentions";
import { MuteButton } from "@/features/notifications/components/mute-button";
import { useLivePresence } from "@/features/realtime/presence";
import { ApiError } from "@/lib/api/errors";
import { useMe } from "@/lib/auth/session";
import { DM_PERMISSIONS } from "@/lib/permissions";

import {
  dmName,
  useAddParticipants,
  useBlockedIds,
  useDM,
  useRemoveParticipant,
  useUpdateDM,
  type DMConversation,
} from "../api";
import { DMAvatar } from "./dm-avatar";
import { UserPickerDialog } from "./user-picker-dialog";

const iconButton =
  "flex size-8 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground";

function Participants({ dm }: { dm: DMConversation }) {
  const { data: me } = useMe();
  const live = useLivePresence();
  const remove = useRemoveParticipant(dm.id);
  const isOwner = dm.owner_id === me?.id;
  return (
    <aside
      aria-label="Members"
      className="hidden w-60 shrink-0 overflow-y-auto border-l border-border bg-card/40 p-2 lg:block"
      data-testid="dm-members"
    >
      <h2 className="px-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Members — {dm.recipients.length + 1}
      </h2>
      <ul>
        {dm.recipients.map((user) => (
          <li key={user.id} className="group flex items-center gap-2 rounded-md px-2 py-1.5">
            <span className="relative shrink-0">
              <UserAvatar user={user} className="size-8" />
              <PresenceDot status={live.get(user.id)?.status ?? user.presence} />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm">
              {user.display_name || user.username}
            </span>
            {isOwner ? (
              <button
                type="button"
                onClick={() =>
                  remove.mutate(user.id, {
                    onError: () => toast.error("Couldn't remove them."),
                  })
                }
                aria-label={`Remove ${user.username} from the group`}
                className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100"
              >
                Remove
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </aside>
  );
}

export function DMPage() {
  const { dmId } = useParams<{ dmId: string }>();
  const { data: dm, isPending, isError } = useDM(dmId);
  const { data: me } = useMe();
  const router = useRouter();
  const blocked = useBlockedIds();
  const [adding, setAdding] = useState(false);
  const [searching, setSearching] = useState(false);
  const add = useAddParticipants(dmId);
  const leave = useRemoveParticipant(dmId);
  const rename = useUpdateDM(dmId);

  const mentionables = useMemo<Mentionables>(
    () => ({
      users: (dm?.recipients ?? []).map((u) => ({
        id: u.id,
        username: u.username,
        display_name: u.display_name,
        avatar_url: u.avatar_url,
      })),
      roles: [],
      everyone: false,
    }),
    [dm],
  );

  if (isPending) {
    return (
      <div className="flex h-full items-center justify-center" role="status">
        <Loader2
          className="size-6 animate-spin text-muted-foreground"
          aria-label="Loading conversation"
        />
      </div>
    );
  }
  if (isError || !dm) {
    return (
      <p className="m-auto p-4 text-muted-foreground" role="alert">
        This conversation doesn&apos;t exist or you&apos;re not in it.
      </p>
    );
  }

  const name = dmName(dm);
  const other = dm.is_group ? null : dm.recipients[0];
  const blockedReason =
    other && blocked.has(other.id) ? "You blocked this user. Unblock them to message." : undefined;

  async function leaveGroup() {
    if (!me || !window.confirm(`Leave ${name}?`)) return;
    try {
      await leave.mutateAsync(me.id);
      router.push("/channels/me");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't leave the group.");
    }
  }

  function renameGroup() {
    const next = window.prompt("Group name", dm?.name ?? "");
    if (next === null) return;
    rename.mutate({ name: next }, { onError: () => toast.error("Couldn't rename the group.") });
  }

  return (
    <div className="flex h-full min-h-0">
      <ChatView
        key={dm.id}
        conversation={{ kind: "dm", id: dm.id }}
        label={other ? `@${other.username}` : name}
        title={name}
        icon={
          dm.is_group ? (
            <Users className="size-5" aria-hidden />
          ) : (
            <AtSign className="size-5" aria-hidden />
          )
        }
        permissions={DM_PERMISSIONS}
        mentionables={mentionables}
        sendBlockedReason={blockedReason}
        headerStart={<span className="w-8 shrink-0 md:hidden" aria-hidden />}
        headerActions={
          <>
            {dm.is_group ? (
              <>
                <button
                  type="button"
                  onClick={renameGroup}
                  aria-label="Rename group"
                  className={iconButton}
                >
                  <Pencil className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  aria-label="Add people"
                  className={iconButton}
                  data-testid="dm-add-people"
                >
                  <UserPlus className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => void leaveGroup()}
                  aria-label="Leave group"
                  className={iconButton}
                >
                  <LogOut className="size-4" aria-hidden />
                </button>
              </>
            ) : null}
            <MuteButton target={{ type: "dm", id: dm.id }} />
            <PinsButton conversation={{ kind: "dm", id: dm.id }} />
            <ExportButton conversation={{ kind: "dm", id: dm.id }} label={name} />
            <button
              type="button"
              onClick={() => setSearching((s) => !s)}
              aria-pressed={searching}
              aria-label="Search messages"
              className={iconButton}
            >
              <Search className="size-4" aria-hidden />
            </button>
          </>
        }
        intro={
          <>
            <DMAvatar dm={dm} className="size-16 text-2xl" />
            <h2 className="mt-3 text-2xl font-bold">{name}</h2>
            <p className="text-muted-foreground">
              {dm.is_group
                ? `Welcome to the beginning of the ${name} group.`
                : `This is the beginning of your direct message history with ${name}.`}
            </p>
          </>
        }
      />
      {searching ? (
        <div className="fixed inset-0 z-30 flex bg-background lg:static lg:z-auto">
          <SearchPanel
            scope={{ kind: "dm", id: dm.id }}
            people={[
              ...(me ? [{ id: me.id, name: me.display_name || me.username }] : []),
              ...dm.recipients.map((u) => ({ id: u.id, name: u.display_name || u.username })),
            ]}
            hrefFor={() => `/channels/me/${dm.id}`}
            onClose={() => setSearching(false)}
          />
        </div>
      ) : dm.is_group ? (
        <Participants dm={dm} />
      ) : null}
      {dm.is_group ? (
        <UserPickerDialog
          open={adding}
          onOpenChange={setAdding}
          title={`Add people to ${name}`}
          description="Groups have up to 10 people."
          submitLabel={() => "Add"}
          max={Math.max(0, 9 - dm.recipients.length)}
          exclude={dm.recipients.map((r) => r.id)}
          onSubmit={async (users) => {
            try {
              await add.mutateAsync(users.map((u) => u.id));
            } catch (e) {
              toast.error(e instanceof ApiError ? e.message : "Couldn't add them.");
              throw e;
            }
          }}
        />
      ) : null}
    </div>
  );
}
