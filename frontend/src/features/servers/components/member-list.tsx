"use client";

import { useQuery } from "@tanstack/react-query";
import { Crown, MessageSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useMemo } from "react";

import { PresenceDot } from "@/components/presence-dot";
import { useLivePresence } from "@/features/realtime/presence";
import { UserAvatar } from "@/components/user-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useBlockedIds, useOpenDM, useSetBlocked } from "@/features/dms/api";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { useMe } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

import { useMembers, useRoles, type Member, type Role } from "../api";

export function roleColor(color: number | undefined): string | undefined {
  return color ? `#${color.toString(16).padStart(6, "0")}` : undefined;
}

type Section = { title: string; members: Member[] };

/**
 * Like Discord's member list: online members under their highest hoisted role (or "Online"),
 * then everyone offline in one "Offline" group.
 */
export function groupMembers(members: Member[], roles: Role[]): Section[] {
  const hoisted = roles
    .filter((r) => r.hoist && !r.is_default)
    .sort((a, b) => b.position - a.position);
  const sections = new Map<string, Member[]>();
  for (const member of members) {
    const top = hoisted.find((r) => member.role_ids.includes(r.id));
    const title = member.presence === "offline" ? "Offline" : (top?.name ?? "Online");
    sections.set(title, [...(sections.get(title) ?? []), member]);
  }
  const order = [...hoisted.map((r) => r.name), "Online", "Offline"];
  return order
    .filter((title) => sections.has(title))
    .map((title) => ({
      title,
      members: sections.get(title)!.sort((a, b) => displayName(a).localeCompare(displayName(b))),
    }));
}

export function displayName(member: Member): string {
  return member.nickname || member.user.display_name || member.user.username;
}

function topColor(member: Member, roles: Role[]): string | undefined {
  const colored = roles
    .filter((r) => r.color && member.role_ids.includes(r.id))
    .sort((a, b) => b.position - a.position)[0];
  return colored ? roleColor(colored.color) : undefined;
}

function ProfileActions({ userId, username }: { userId: string; username: string }) {
  const { data: me } = useMe();
  const router = useRouter();
  const open = useOpenDM();
  const blocked = useBlockedIds();
  const setBlocked = useSetBlocked();
  if (!me || me.id === userId) return null;
  const isBlocked = blocked.has(userId);
  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        className="flex-1"
        disabled={open.isPending || isBlocked}
        onClick={async () => {
          // mutateAsync: the card may unmount meanwhile (e.g. a presence change re-sorts the
          // member list), and mutate()'s per-call callbacks would then be dropped.
          try {
            const dm = await open.mutateAsync({ userIds: [userId] });
            router.push(`/channels/me/${dm.id}`);
          } catch (e) {
            toast.error(e instanceof ApiError ? e.message : "Couldn't open the conversation.");
          }
        }}
      >
        <MessageSquare /> Message
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={setBlocked.isPending}
        onClick={() => {
          if (
            !isBlocked &&
            !window.confirm(`Block @${username}? You won't get DMs from each other.`)
          )
            return;
          setBlocked.mutate(
            { userId, blocked: !isBlocked },
            { onSuccess: () => toast.success(isBlocked ? "Unblocked." : "Blocked.") },
          );
        }}
      >
        {isBlocked ? "Unblock" : "Block"}
      </Button>
    </div>
  );
}

function ProfileCard({ member, roles }: { member: Member; roles: Role[] }) {
  const profile = useQuery({
    queryKey: ["users", member.user.id],
    queryFn: async () =>
      (await api.GET("/api/v1/users/{id}", { params: { path: { id: member.user.id } } })).data,
  });
  const memberRoles = roles.filter((r) => member.role_ids.includes(r.id));
  return (
    <div className="grid gap-3" data-testid="profile-card">
      <div className="flex items-center gap-3">
        <span className="relative shrink-0">
          <UserAvatar user={member.user} className="size-14 text-xl" />
          <PresenceDot status={member.presence} className="size-4 border-popover" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold">{displayName(member)}</p>
          <p className="truncate text-sm text-muted-foreground">@{member.user.username}</p>
        </div>
      </div>
      {profile.data?.bio ? <p className="text-sm whitespace-pre-wrap">{profile.data.bio}</p> : null}
      {memberRoles.length ? (
        <div>
          <p className="mb-1 text-xs font-semibold text-muted-foreground uppercase">Roles</p>
          <ul className="flex flex-wrap gap-1">
            {memberRoles.map((role) => (
              <li
                key={role.id}
                className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs"
              >
                <span
                  className="size-2 rounded-full bg-muted-foreground"
                  style={{ background: roleColor(role.color) }}
                  aria-hidden
                />
                {role.name}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {profile.data?.mutual_servers?.length ? (
        <div>
          <p className="mb-1 text-xs font-semibold text-muted-foreground uppercase">
            Mutual servers — {profile.data.mutual_servers.length}
          </p>
          <ul className="grid gap-1" data-testid="mutual-servers">
            {profile.data.mutual_servers.map((s) => (
              <li key={s.id} className="truncate text-sm">
                {s.name}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Member since {new Date(member.joined_at).toLocaleDateString()}
      </p>
      <ProfileActions userId={member.user.id} username={member.user.username} />
    </div>
  );
}

export function MemberList({ serverId }: { serverId: string }) {
  const { data: fetched = [] } = useMembers(serverId);
  const { data: roles = [] } = useRoles(serverId);
  const live = useLivePresence();
  const members = useMemo(
    () =>
      fetched.map((m) => {
        const status = live.get(m.user.id)?.status;
        return status && status !== m.presence ? { ...m, presence: status } : m;
      }),
    [fetched, live],
  );
  const sections = useMemo(() => groupMembers(members, roles), [members, roles]);
  return (
    <aside
      aria-label="Members"
      className="hidden w-60 shrink-0 overflow-y-auto border-l border-border bg-card/40 p-2 lg:block"
      data-testid="member-list"
    >
      {sections.map((section) => (
        <section key={section.title} className="mb-4">
          <h2 className="px-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {section.title} — {section.members.length}
          </h2>
          <ul>
            {section.members.map((member) => (
              <li key={member.user.id} data-testid="member" data-presence={member.presence}>
                <Popover>
                  <PopoverTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                    <span className="relative shrink-0">
                      <UserAvatar user={member.user} className="size-8" />
                      <PresenceDot status={member.presence} />
                    </span>
                    <span
                      className={cn(
                        "truncate text-sm",
                        member.presence === "offline" && "text-muted-foreground",
                      )}
                      style={{
                        color: member.presence === "offline" ? undefined : topColor(member, roles),
                      }}
                    >
                      {displayName(member)}
                    </span>
                    {member.is_owner ? (
                      <Crown
                        className="size-3.5 shrink-0 text-amber-400"
                        aria-label="Server owner"
                      />
                    ) : null}
                  </PopoverTrigger>
                  <PopoverContent side="left" align="start" className="w-72">
                    <ProfileCard member={member} roles={roles} />
                  </PopoverContent>
                </Popover>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </aside>
  );
}
