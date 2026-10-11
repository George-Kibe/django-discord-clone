"use client";

import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";

import { inviteUrl, keys, useInvites, type ServerDetail } from "../../api";

export function InvitesTab({ server }: { server: ServerDetail }) {
  const queryClient = useQueryClient();
  const { data: invites = [], isPending } = useInvites(server.id);

  async function revoke(code: string) {
    try {
      await api.DELETE("/api/v1/invites/{code}", { params: { path: { code } } });
      await queryClient.invalidateQueries({ queryKey: keys.invites(server.id) });
      toast.success("Invite revoked");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't revoke.");
    }
  }

  if (isPending) return <p className="text-muted-foreground">Loading invites…</p>;
  if (!invites.length) return <p className="text-muted-foreground">No active invites.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-muted-foreground uppercase">
          <tr>
            <th className="py-2 pr-4">Link</th>
            <th className="py-2 pr-4">Created by</th>
            <th className="py-2 pr-4">Uses</th>
            <th className="py-2 pr-4">Expires</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {invites.map((invite) => (
            <tr key={invite.code} className="border-t border-border">
              <td className="py-2 pr-4 font-mono text-xs">{inviteUrl(invite.code)}</td>
              <td className="py-2 pr-4">{invite.inviter?.username ?? "-"}</td>
              <td className="py-2 pr-4">
                {invite.uses}
                {invite.max_uses ? ` / ${invite.max_uses}` : ""}
              </td>
              <td className="py-2 pr-4">
                {invite.expires_at ? new Date(invite.expires_at).toLocaleString() : "Never"}
              </td>
              <td className="py-2 text-right">
                <Button type="button" size="sm" variant="ghost" onClick={() => revoke(invite.code)}>
                  Revoke
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
