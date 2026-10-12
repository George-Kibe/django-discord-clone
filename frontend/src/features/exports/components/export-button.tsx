"use client";

import { FileDown } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Conversation } from "@/features/chat/api";
import { ApiError } from "@/lib/api/errors";

import { useStartExport } from "../api";

/** FR-EXP-01/02: PDF transcript, generated in the background; the inbox links the file. */
export function ExportButton({
  conversation,
  label,
}: {
  conversation: Conversation;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const start = useStartExport(conversation);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await start.mutateAsync({ date_from: from || null, date_to: to || null });
      toast.success("Preparing your transcript. We'll notify you when it's ready.");
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't start the export.");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Export transcript"
        className="flex size-8 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        data-testid="export-button"
      >
        <FileDown className="size-4" aria-hidden />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Export {label}</DialogTitle>
              <DialogDescription>
                A PDF of the messages, made in the background. The download stays available for 24
                hours.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="export-from">From (optional)</Label>
                <Input
                  id="export-from"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="export-to">To (optional)</Label>
                <Input
                  id="export-to"
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={start.isPending}>
                Export PDF
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
