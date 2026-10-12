"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { UserAvatar } from "@/components/user-avatar";

import { useAuditLog, type AuditEvent, type ServerDetail } from "../../api";

const ACTIONS: [string, string][] = [
  ["", "All actions"],
  ["member.kick", "Kicks"],
  ["member.ban", "Bans"],
  ["member.unban", "Unbans"],
  ["member.update", "Member roles"],
  ["role.create", "Roles created"],
  ["role.update", "Roles updated"],
  ["role.delete", "Roles deleted"],
  ["channel.create", "Channels created"],
  ["channel.update", "Channels updated"],
  ["channel.delete", "Channels deleted"],
  ["overwrite.update", "Channel permissions"],
  ["message.delete", "Messages deleted"],
  ["invite.create", "Invites created"],
  ["invite.revoke", "Invites revoked"],
  ["server.update", "Server settings"],
];

function summary(changes: AuditEvent["changes"]): string {
  if (!changes || typeof changes !== "object") return "";
  return Object.entries(changes as Record<string, unknown>)
    .map(([key, value]) => {
      if (value && typeof value === "object" && "from" in value && "to" in value) {
        const v = value as { from: unknown; to: unknown };
        return `${key}: ${String(v.from)} → ${String(v.to)}`;
      }
      return `${key}: ${Array.isArray(value) ? value.join(", ") || "—" : String(value)}`;
    })
    .join(" · ");
}

/** FR-MOD-02: who changed what. */
export function AuditLogTab({ server }: { server: ServerDetail }) {
  const [action, setAction] = useState("");
  const log = useAuditLog(server.id, action || null);
  const events = log.data?.pages.flatMap((p) => p.results) ?? [];
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2">
        <Label htmlFor="audit-filter">Show</Label>
        <select
          id="audit-filter"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          {ACTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {log.isPending ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : !events.length ? (
        <p className="text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <ol className="grid gap-2" aria-label="Audit log" data-testid="audit-log">
          {events.map((event) => (
            <li key={event.id} className="flex gap-3 rounded-md border border-border p-3">
              {event.actor ? <UserAvatar user={event.actor} className="size-8" /> : null}
              <div className="min-w-0 flex-1 text-sm">
                <p>
                  <strong>{event.actor?.username ?? "Someone"}</strong> · {event.action_label}
                  {event.target_label ? (
                    <>
                      {" "}
                      · <span className="font-medium">{event.target_label}</span>
                    </>
                  ) : null}
                </p>
                {summary(event.changes) ? (
                  <p className="text-xs break-words text-muted-foreground">
                    {summary(event.changes)}
                  </p>
                ) : null}
                <time className="text-xs text-muted-foreground" dateTime={event.created_at}>
                  {new Date(event.created_at).toLocaleString()}
                </time>
              </div>
            </li>
          ))}
        </ol>
      )}
      {log.hasNextPage ? (
        <Button variant="outline" onClick={() => void log.fetchNextPage()}>
          Load more
        </Button>
      ) : null}
    </div>
  );
}
