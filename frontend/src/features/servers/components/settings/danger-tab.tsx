"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";

import { keys, useMembers, type ServerDetail } from "../../api";
import { displayName } from "../member-list";

const fail = (e: unknown) =>
  toast.error(e instanceof ApiError ? e.message : "Something went wrong.");

export function DangerTab({ server }: { server: ServerDetail }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { data: members = [] } = useMembers(server.id);
  const [newOwner, setNewOwner] = useState<string>("");
  const [confirmName, setConfirmName] = useState("");
  const candidates = members.filter((m) => !m.is_owner);

  async function transfer() {
    const target = members.find((m) => m.user.id === newOwner);
    if (
      !target ||
      !window.confirm(`Make ${displayName(target)} the owner? You'll lose owner rights.`)
    )
      return;
    try {
      const { data } = await api.POST("/api/v1/servers/{server_id}/transfer-ownership", {
        params: { path: { server_id: server.id } },
        body: { user_id: newOwner },
      });
      if (data) queryClient.setQueryData(keys.server(server.id), data);
      await queryClient.invalidateQueries({ queryKey: keys.members(server.id) });
      toast.success("Ownership transferred");
      router.push(`/channels/${server.id}`);
    } catch (e) {
      fail(e);
    }
  }

  async function remove() {
    try {
      await api.DELETE("/api/v1/servers/{server_id}", {
        params: { path: { server_id: server.id } },
      });
      toast.success("Server deleted");
      // Leave first: dropping the server's cache unmounts this tab, and the page is gone anyway.
      router.replace("/channels/me");
      queryClient.removeQueries({ queryKey: keys.server(server.id) });
      void queryClient.invalidateQueries({ queryKey: keys.servers, exact: true });
    } catch (e) {
      fail(e);
    }
  }

  return (
    <div className="grid max-w-xl gap-8">
      <section className="grid gap-3" aria-labelledby="transfer-heading">
        <h2 id="transfer-heading" className="font-semibold">
          Transfer ownership
        </h2>
        {candidates.length ? (
          <div className="flex flex-wrap gap-2">
            <Select value={newOwner} onValueChange={setNewOwner}>
              <SelectTrigger className="w-64" aria-label="New owner">
                <SelectValue placeholder="Choose a member" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((m) => (
                  <SelectItem key={m.user.id} value={m.user.id}>
                    {displayName(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" onClick={transfer} disabled={!newOwner}>
              Transfer
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Invite someone first: the new owner has to be a member.
          </p>
        )}
      </section>
      <section
        className="grid gap-3 rounded-md border border-destructive/50 p-4"
        aria-labelledby="delete-heading"
      >
        <h2 id="delete-heading" className="font-semibold text-destructive">
          Delete server
        </h2>
        <p className="text-sm text-muted-foreground">
          This permanently deletes {server.name}, its channels and every message. It can&apos;t be
          undone.
        </p>
        <Label htmlFor="confirm-name">Type the server name to confirm</Label>
        <Input
          id="confirm-name"
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          autoComplete="off"
        />
        <div>
          <Button
            type="button"
            variant="destructive"
            disabled={confirmName !== server.name}
            onClick={remove}
          >
            Delete server
          </Button>
        </div>
      </section>
    </div>
  );
}
