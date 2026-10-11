"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { FormField, FormMessage } from "@/components/form-field";
import { ImagePicker } from "@/components/image-picker";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { uploadImage } from "@/lib/media/upload";

import { keys, useTopics, type ServerDetail } from "../../api";
import { ServerIcon } from "../server-icon";

const NO_TOPIC = "none";

export function OverviewTab({ server }: { server: ServerDetail }) {
  const queryClient = useQueryClient();
  const { data: topics = [] } = useTopics();
  const [name, setName] = useState(server.name);
  const [description, setDescription] = useState(server.description ?? "");
  const [isPublic, setIsPublic] = useState(server.is_public);
  const [topic, setTopic] = useState(server.topic ? String(server.topic.id) : NO_TOPIC);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function patch(body: Record<string, unknown>) {
    const { data } = await api.PATCH("/api/v1/servers/{server_id}", {
      params: { path: { server_id: server.id } },
      body,
    });
    if (data) queryClient.setQueryData(keys.server(server.id), data);
    await queryClient.invalidateQueries({ queryKey: keys.servers, exact: true });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await patch({
        name,
        description,
        is_public: isPublic,
        topic_id: topic === NO_TOPIC ? null : Number(topic),
      });
      toast.success("Server updated");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  async function setIcon(blob: Blob) {
    await patch({ icon_public_id: await uploadImage("server_icon", blob) });
    toast.success("Icon updated");
  }

  return (
    <form onSubmit={save} className="grid max-w-xl gap-5" noValidate>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
      <div className="flex items-center gap-4">
        <ServerIcon server={server} className="size-20 text-xl" />
        <div className="flex flex-wrap gap-2">
          <ImagePicker
            label="Change icon"
            title="Crop server icon"
            shape="rect"
            onCropped={setIcon}
          />
          {server.icon_url ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => void patch({ icon_public_id: "" })}
            >
              Remove
            </Button>
          ) : null}
        </div>
      </div>
      <FormField label="Server name">
        {(field) => (
          <Input
            {...field}
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </FormField>
      <FormField label="Description">
        {(field) => (
          <Textarea
            {...field}
            rows={3}
            maxLength={1000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        )}
      </FormField>
      <div className="grid gap-2">
        <Label htmlFor="server-topic">Topic</Label>
        <Select value={topic} onValueChange={setTopic}>
          <SelectTrigger id="server-topic" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_TOPIC}>No topic</SelectItem>
            {topics.map((t) => (
              <SelectItem key={t.id} value={String(t.id)}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
        <div>
          <Label htmlFor="server-public">Public server</Label>
          <p className="text-sm text-muted-foreground">
            Anyone can find it on Discover and join without an invite.
          </p>
        </div>
        <Switch id="server-public" checked={isPublic} onCheckedChange={setIsPublic} />
      </div>
      <div>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
