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
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";

/** FR-MOD-03: report a message to site staff. */
export function ReportDialog({
  messageId,
  open,
  onOpenChange,
}: {
  messageId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason.trim()) return;
    setBusy(true);
    try {
      await api.POST("/api/v1/messages/{message_id}/report", {
        params: { path: { message_id: messageId } },
        body: { reason: reason.trim() },
      });
      toast.success("Thanks, our staff will take a look.");
      setReason("");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't send the report.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Report message</DialogTitle>
            <DialogDescription>
              Reports go to the site staff, not to the server&apos;s moderators.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="report-reason">What&apos;s wrong with it?</Label>
            <Textarea
              id="report-reason"
              value={reason}
              maxLength={1000}
              rows={4}
              onChange={(e) => setReason(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={busy || !reason.trim()}>
              Send report
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
