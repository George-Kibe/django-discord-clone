"use client";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";

import { useBans, useModeration, type ServerDetail } from "../../api";

export function BansTab({ server }: { server: ServerDetail }) {
  const { data: bans = [], isPending } = useBans(server.id, true);
  const { unban } = useModeration(server.id);
  if (isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (!bans.length) return <p className="text-muted-foreground">Nobody is banned.</p>;
  return (
    <ul className="grid gap-2" aria-label="Banned users" data-testid="bans">
      {bans.map((ban) => (
        <li
          key={ban.user.id}
          className="flex items-center gap-3 rounded-md border border-border p-3"
        >
          <UserAvatar user={ban.user} className="size-9" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{ban.user.display_name || ban.user.username}</p>
            <p className="truncate text-xs text-muted-foreground">
              {ban.reason ? `Reason: ${ban.reason} · ` : ""}by{" "}
              {ban.moderator?.username ?? "a former moderator"} on{" "}
              {new Date(ban.created_at).toLocaleDateString()}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              unban.mutate(ban.user.id, {
                onSuccess: () => toast.success(`Unbanned ${ban.user.username}.`),
                onError: () => toast.error("Couldn't unban."),
              })
            }
          >
            Unban
          </Button>
        </li>
      ))}
    </ul>
  );
}
