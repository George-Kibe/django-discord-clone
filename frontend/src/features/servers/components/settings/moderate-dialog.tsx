"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api/errors";

/** Confirm a kick or ban with an optional reason (kept in the audit log). */
export function ModerateDialog({
  action,
  name,
  open,
  onOpenChange,
  onConfirm,
}: {
  action: "kick" | "ban";
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const verb = action === "kick" ? "Kick" : "Ban";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await onConfirm(reason.trim());
      toast.success(action === "kick" ? `Kicked ${name}.` : `Banned ${name}.`);
      setReason("");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : `Couldn't ${action} ${name}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>
              {verb} {name}
            </DialogTitle>
            <DialogDescription>
              {action === "kick"
                ? "They can rejoin with a new invite."
                : "They're removed and can't rejoin until you unban them."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="moderation-reason">Reason (optional, kept in the audit log)</Label>
            <Textarea
              id="moderation-reason"
              value={reason}
              maxLength={512}
              rows={3}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={busy}>
              {verb}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
