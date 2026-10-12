"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { FormField, FormMessage } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { hasPerm } from "@/lib/permissions";

import { keys, useCategories, useChannels, useServer, type Channel } from "../api";
import { ChannelPermissions } from "./channel-permissions";

const NONE = "none";

export function ChannelSettingsDialog({
  channel,
  open,
  onOpenChange,
}: {
  channel: Channel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic);
  const [category, setCategory] = useState(channel.category_id ?? NONE);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: categories = [] } = useCategories(channel.server_id);
  const { data: channels = [] } = useChannels(channel.server_id);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: keys.channels(channel.server_id) });
  const { data: server } = useServer(channel.server_id);
  const canManageRoles = hasPerm(server?.me.permissions, "MANAGE_ROLES");

  /** FR-CH-02: swap with the neighbouring channel in the same category. */
  async function move(delta: -1 | 1) {
    const siblings = channels
      .filter((c) => (c.category_id ?? null) === (channel.category_id ?? null))
      .sort((a, b) => a.position - b.position);
    const index = siblings.findIndex((c) => c.id === channel.id);
    const target = siblings[index + delta];
    if (!target) return;
    const reordered = [...siblings];
    [reordered[index], reordered[index + delta]] = [target, reordered[index]];
    setBusy(true);
    try {
      await api.PATCH("/api/v1/servers/{server_id}/channels/reorder", {
        params: { path: { server_id: channel.server_id } },
        body: {
          channels: reordered.map((c, position) => ({
            id: c.id,
            category_id: c.category_id ?? null,
            position,
          })),
        },
      });
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't move the channel.");
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.PATCH("/api/v1/channels/{channel_id}", {
        params: { path: { channel_id: channel.id } },
        body: { name, topic, category_id: category === NONE ? null : category },
      });
      await refresh();
      toast.success("Channel updated");
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete #${channel.name}? Its messages will be gone for good.`)) return;
    setBusy(true);
    try {
      await api.DELETE("/api/v1/channels/{channel_id}", {
        params: { path: { channel_id: channel.id } },
      });
      await refresh();
      onOpenChange(false);
      router.push(`/channels/${channel.server_id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't delete.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit #{channel.name}</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            {canManageRoles ? <TabsTrigger value="permissions">Permissions</TabsTrigger> : null}
          </TabsList>
          {canManageRoles ? (
            <TabsContent value="permissions" className="pt-3">
              <ChannelPermissions channel={channel} />
            </TabsContent>
          ) : null}
          <TabsContent value="overview" className="pt-3">
            <form onSubmit={save} className="grid gap-4" noValidate>
              {error ? <FormMessage tone="error">{error}</FormMessage> : null}
              <FormField label="Channel name" hint="Lowercase, spaces become hyphens.">
                {(field) => (
                  <Input {...field} value={name} onChange={(e) => setName(e.target.value)} />
                )}
              </FormField>
              <FormField label="Topic">
                {(field) => (
                  <Textarea
                    {...field}
                    rows={3}
                    maxLength={1024}
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                  />
                )}
              </FormField>
              <div className="grid gap-2">
                <Label htmlFor="channel-category">Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger id="channel-category" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No category</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => move(-1)}
                  disabled={busy}
                >
                  Move up
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => move(1)}
                  disabled={busy}
                >
                  Move down
                </Button>
              </div>
              <DialogFooter className="sm:justify-between">
                <Button type="button" variant="destructive" onClick={remove} disabled={busy}>
                  Delete channel
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Save"}
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
