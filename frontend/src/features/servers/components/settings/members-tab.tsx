"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Crown } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { UserAvatar } from "@/components/user-avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { useMe } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";

import { Button } from "@/components/ui/button";

import {
  keys,
  useMembers,
  useModeration,
  useRoles,
  type Member,
  type ServerDetail,
} from "../../api";
import { displayName, roleColor } from "../member-list";
import { ModerateDialog } from "./moderate-dialog";

function ModerationButtons({
  server,
  member,
  myTop,
}: {
  server: ServerDetail;
  member: Member;
  myTop: number;
}) {
  const { data: roles = [] } = useRoles(server.id);
  const { kick, ban } = useModeration(server.id);
  const [action, setAction] = useState<"kick" | "ban" | null>(null);
  const { data: me } = useMe();
  const targetTop = Math.max(
    0,
    ...roles.filter((r) => member.role_ids.includes(r.id)).map((r) => r.position ?? 0),
  );
  const outranks = !member.is_owner && member.user.id !== me?.id && targetTop < myTop;
  const canKick = hasPerm(server.me.permissions, "KICK_MEMBERS") && outranks;
  const canBan = hasPerm(server.me.permissions, "BAN_MEMBERS") && outranks;
  if (!canKick && !canBan) return null;
  const name = displayName(member);
  return (
    <div className="flex gap-2">
      {canKick ? (
        <Button size="sm" variant="outline" onClick={() => setAction("kick")}>
          Kick
        </Button>
      ) : null}
      {canBan ? (
        <Button size="sm" variant="destructive" onClick={() => setAction("ban")}>
          Ban
        </Button>
      ) : null}
      {action ? (
        <ModerateDialog
          action={action}
          name={name}
          open
          onOpenChange={(o) => !o && setAction(null)}
          onConfirm={(reason) =>
            (action === "kick" ? kick : ban).mutateAsync({ userId: member.user.id, reason })
          }
        />
      ) : null}
    </div>
  );
}

export function MembersTab({ server }: { server: ServerDetail }) {
  const queryClient = useQueryClient();
  const { data: members = [] } = useMembers(server.id);
  const { data: roles = [] } = useRoles(server.id);
  const assignable = roles
    .filter((r) => !r.is_default)
    .sort((a, b) => (b.position ?? 0) - (a.position ?? 0));
  const canManage = hasPerm(server.me.permissions, "MANAGE_ROLES");
  const myTop = server.me.is_owner
    ? Number.MAX_SAFE_INTEGER
    : Math.max(
        0,
        ...roles.filter((r) => server.me.role_ids.includes(r.id)).map((r) => r.position ?? 0),
      );

  async function toggle(member: Member, roleId: string, on: boolean) {
    const role_ids = on
      ? [...member.role_ids, roleId]
      : member.role_ids.filter((id) => id !== roleId);
    try {
      await api.PATCH("/api/v1/servers/{server_id}/members/{user_id}", {
        params: { path: { server_id: server.id, user_id: member.user.id } },
        body: { role_ids },
      });
      await queryClient.invalidateQueries({ queryKey: keys.members(server.id) });
      await queryClient.invalidateQueries({ queryKey: keys.server(server.id) });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't update roles.");
    }
  }

  return (
    <ul className="grid gap-2" aria-label="Members">
      {members.map((member) => (
        <li
          key={member.user.id}
          className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3"
          data-testid="settings-member"
        >
          <UserAvatar user={member.user} className="size-9" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 truncate font-medium">
              {displayName(member)}
              {member.is_owner ? (
                <Crown
                  className="size-3.5 text-amber-600 dark:text-amber-400"
                  aria-label="Server owner"
                />
              ) : null}
            </p>
            <p className="truncate text-xs text-muted-foreground">@{member.user.username}</p>
          </div>
          <fieldset
            className="flex flex-wrap gap-3"
            aria-label={`Roles for ${displayName(member)}`}
          >
            {assignable.map((role) => (
              <label key={role.id} className="flex items-center gap-1.5 text-sm">
                <Checkbox
                  checked={member.role_ids.includes(role.id)}
                  disabled={
                    !canManage ||
                    (role.position ?? 0) >= myTop ||
                    (member.is_owner && !server.me.is_owner)
                  }
                  onCheckedChange={(checked) => void toggle(member, role.id, checked === true)}
                />
                {/* Role colour as a dot: coloured text fails contrast for many role colours. */}
                <span
                  className="size-2 rounded-full bg-muted-foreground"
                  style={{ background: roleColor(role.color) }}
                  aria-hidden
                />
                <span>{role.name}</span>
              </label>
            ))}
          </fieldset>
          <ModerationButtons server={server} member={member} myTop={myTop} />
        </li>
      ))}
    </ul>
  );
}
