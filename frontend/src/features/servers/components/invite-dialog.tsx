"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";

import { inviteUrl, type Invite } from "../api";

const AGES = [
  { value: "1800", label: "30 minutes" },
  { value: "3600", label: "1 hour" },
  { value: "86400", label: "1 day" },
  { value: "604800", label: "7 days" },
  { value: "0", label: "Never" },
];
const USES = [
  { value: "0", label: "No limit" },
  { value: "1", label: "1 use" },
  { value: "5", label: "5 uses" },
  { value: "25", label: "25 uses" },
];

export function InviteDialog({
  serverId,
  serverName,
  open,
  onOpenChange,
}: {
  serverId: string;
  serverName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [maxAge, setMaxAge] = useState("604800");
  const [maxUses, setMaxUses] = useState("0");
  const [invite, setInvite] = useState<Invite | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setBusy(true);
    try {
      const { data } = await api.POST("/api/v1/servers/{server_id}/invites", {
        params: { path: { server_id: serverId } },
        body: { max_age: Number(maxAge) as 0, max_uses: Number(maxUses) },
      });
      setInvite(data ?? null);
      setCopied(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Couldn't create the invite.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!invite) return;
    await navigator.clipboard.writeText(inviteUrl(invite.code)).catch(() => undefined);
    setCopied(true);
    toast.success("Invite link copied");
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (onOpenChange(o), o || setInvite(null))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite friends to {serverName}</DialogTitle>
          <DialogDescription>Anyone with the link can join after signing in.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="invite-age">Expire after</Label>
            <Select value={maxAge} onValueChange={setMaxAge}>
              <SelectTrigger id="invite-age" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AGES.map((a) => (
                  <SelectItem key={a.value} value={a.value}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="invite-uses">Max uses</Label>
            <Select value={maxUses} onValueChange={setMaxUses}>
              <SelectTrigger id="invite-uses" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {USES.map((u) => (
                  <SelectItem key={u.value} value={u.value}>
                    {u.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {invite ? (
          <div className="flex gap-2">
            <Input
              readOnly
              value={inviteUrl(invite.code)}
              aria-label="Invite link"
              data-testid="invite-link"
            />
            <Button type="button" onClick={copy} aria-label="Copy invite link">
              {copied ? <Check /> : <Copy />}
            </Button>
          </div>
        ) : null}
        <Button
          type="button"
          variant={invite ? "outline" : "default"}
          onClick={generate}
          disabled={busy}
        >
          {busy ? "Creating…" : invite ? "Create another link" : "Create invite link"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
