"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { FormField, FormMessage } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ImagePicker } from "@/components/image-picker";
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
import { uploadImage } from "@/lib/media/upload";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { applyFieldErrors } from "@/lib/api/errors";
import { useMe } from "@/lib/auth/session";

import { parseInviteCode, useAcceptInvite, useCreateServer, useTopics } from "../api";

const createSchema = z.object({
  name: z.string().trim().min(1, "Give your server a name.").max(100),
  description: z.string().max(1000),
});
const NO_TOPIC = "none";
const joinSchema = z.object({
  invite: z.string().refine((v) => parseInviteCode(v) !== null, "Paste an invite link or code."),
});

export function AddServerDialog() {
  const [open, setOpen] = useState(false);
  const { data: me } = useMe();
  const router = useRouter();
  const create = useCreateServer();
  const accept = useAcceptInvite();
  const [error, setError] = useState<string | null>(null);
  const createForm = useForm<z.infer<typeof createSchema>>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      name: me ? `${me.display_name || me.username}'s server` : "",
      description: "",
    },
  });
  // FR-SRV-01: optional icon, description and topic right away (all editable later too).
  const { data: topics = [] } = useTopics();
  const [topic, setTopic] = useState(NO_TOPIC);
  const [isPublic, setIsPublic] = useState(false);
  const [icon, setIcon] = useState<{ publicId: string; preview: string } | null>(null);
  const joinForm = useForm<z.infer<typeof joinSchema>>({
    resolver: zodResolver(joinSchema),
    defaultValues: { invite: "" },
  });

  function done(serverId: string) {
    setOpen(false);
    createForm.reset();
    joinForm.reset();
    setTopic(NO_TOPIC);
    setIsPublic(false);
    if (icon) URL.revokeObjectURL(icon.preview);
    setIcon(null);
    router.push(`/channels/${serverId}`);
  }

  async function onCreate(values: z.infer<typeof createSchema>) {
    setError(null);
    try {
      done(
        (
          await create.mutateAsync({
            ...values,
            is_public: isPublic,
            topic_id: topic === NO_TOPIC ? null : Number(topic),
            icon_public_id: icon?.publicId ?? "",
          })
        ).id,
      );
    } catch (e) {
      setError(applyFieldErrors(e, createForm.setError, ["name"]));
    }
  }

  async function onJoin(values: z.infer<typeof joinSchema>) {
    setError(null);
    try {
      done((await accept.mutateAsync(parseInviteCode(values.invite)!)).id);
    } catch (e) {
      setError(applyFieldErrors(e, joinForm.setError, []));
    }
  }

  const unverified = me && !me.email_verified;
  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), setError(null))}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <button
              type="button"
              aria-label="Add a server"
              data-testid="add-server"
              className="flex size-12 items-center justify-center rounded-3xl bg-card text-emerald-700 transition-all hover:rounded-2xl hover:bg-emerald-500 hover:text-white focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:text-emerald-400"
            >
              <Plus aria-hidden />
            </button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">Add a server</TooltipContent>
      </Tooltip>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a server</DialogTitle>
          <DialogDescription>Create your own, or join one with an invite.</DialogDescription>
        </DialogHeader>
        {unverified ? (
          <FormMessage tone="error">
            Verify your email address before creating or joining servers.
          </FormMessage>
        ) : null}
        {error ? <FormMessage tone="error">{error}</FormMessage> : null}
        <Tabs defaultValue="create">
          <TabsList className="w-full">
            <TabsTrigger value="create">Create</TabsTrigger>
            <TabsTrigger value="join">Join</TabsTrigger>
          </TabsList>
          <TabsContent value="create">
            <form
              onSubmit={createForm.handleSubmit(onCreate)}
              noValidate
              className="grid gap-4 pt-2"
            >
              <div className="flex items-center gap-3">
                {icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={icon.preview} alt="" className="size-12 rounded-2xl object-cover" />
                ) : null}
                <ImagePicker
                  label={icon ? "Change icon" : "Upload an icon (optional)"}
                  title="Crop your server icon"
                  shape="rect"
                  disabled={!!unverified}
                  onCropped={async (blob) => {
                    const publicId = await uploadImage("server_icon", blob);
                    setIcon({ publicId, preview: URL.createObjectURL(blob) });
                  }}
                />
              </div>
              <FormField label="Server name" error={createForm.formState.errors.name?.message}>
                {(field) => <Input {...field} {...createForm.register("name")} />}
              </FormField>
              <FormField label="Description (optional)">
                {(field) => (
                  <Textarea
                    {...field}
                    rows={2}
                    maxLength={1000}
                    {...createForm.register("description")}
                  />
                )}
              </FormField>
              <div className="grid gap-1.5">
                <Label htmlFor="new-server-topic">Topic</Label>
                <Select value={topic} onValueChange={setTopic}>
                  <SelectTrigger id="new-server-topic" className="w-full">
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
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="new-server-public" className="grid gap-0.5">
                  <span>Public server</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    Listed in Discover; anyone can join.
                  </span>
                </Label>
                <Switch id="new-server-public" checked={isPublic} onCheckedChange={setIsPublic} />
              </div>
              <Button type="submit" disabled={create.isPending || !!unverified}>
                {create.isPending ? "Creating…" : "Create server"}
              </Button>
            </form>
          </TabsContent>
          <TabsContent value="join">
            <form onSubmit={joinForm.handleSubmit(onJoin)} noValidate className="grid gap-4 pt-2">
              <FormField
                label="Invite link"
                error={joinForm.formState.errors.invite?.message}
                hint="For example http://localhost/invite/AbC123xy or AbC123xy"
              >
                {(field) => <Input {...field} {...joinForm.register("invite")} />}
              </FormField>
              <Button type="submit" disabled={accept.isPending || !!unverified}>
                {accept.isPending ? "Joining…" : "Join server"}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
