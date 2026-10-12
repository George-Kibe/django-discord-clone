"use client";

import { Plus, X } from "lucide-react";
import { useState, type FormEvent } from "react";

import { FormMessage } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import type { PollInput } from "@/features/chat/api";

const DURATIONS = [
  { label: "No end time", minutes: null },
  { label: "1 hour", minutes: 60 },
  { label: "1 day", minutes: 24 * 60 },
  { label: "3 days", minutes: 3 * 24 * 60 },
  { label: "1 week", minutes: 7 * 24 * 60 },
] as const;

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/** FR-POLL-01: a question plus 2–10 options, optional multiple choice and end time. */
export function PollDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (poll: PollInput) => void;
}) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [multiple, setMultiple] = useState(false);
  const [duration, setDuration] = useState<number | null>(24 * 60);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const filled = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim()) return setError("Ask a question.");
    if (filled.length < 2) return setError("Add at least two answers.");
    if (new Set(filled.map((o) => o.toLowerCase())).size !== filled.length)
      return setError("Answers must be different.");
    onCreate({
      question: question.trim(),
      options: filled,
      allow_multiple: multiple,
      duration_minutes: duration,
    });
    setQuestion("");
    setOptions(["", ""]);
    setMultiple(false);
    setError(null);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Create a poll</DialogTitle>
            <DialogDescription>
              Results update live for everyone in the conversation.
            </DialogDescription>
          </DialogHeader>
          {error ? <FormMessage tone="error">{error}</FormMessage> : null}
          <div className="grid gap-1.5">
            <Label htmlFor="poll-question">Question</Label>
            <Input
              id="poll-question"
              value={question}
              maxLength={300}
              onChange={(e) => setQuestion(e.target.value)}
              autoFocus
            />
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Answers</legend>
            {options.map((value, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  value={value}
                  maxLength={100}
                  aria-label={`Answer ${index + 1}`}
                  onChange={(e) =>
                    setOptions((all) => all.map((o, i) => (i === index ? e.target.value : o)))
                  }
                />
                {options.length > 2 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove answer ${index + 1}`}
                    onClick={() => setOptions((all) => all.filter((_, i) => i !== index))}
                  >
                    <X />
                  </Button>
                ) : null}
              </div>
            ))}
            {options.length < 10 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="justify-self-start"
                onClick={() => setOptions((all) => [...all, ""])}
              >
                <Plus /> Add answer
              </Button>
            ) : null}
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="poll-duration">Duration</Label>
              <select
                id="poll-duration"
                className={selectClass}
                value={duration ?? ""}
                onChange={(e) => setDuration(e.target.value ? Number(e.target.value) : null)}
              >
                {DURATIONS.map((d) => (
                  <option key={d.label} value={d.minutes ?? ""}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <Checkbox checked={multiple} onCheckedChange={(v) => setMultiple(v === true)} />
              Allow multiple answers
            </label>
          </div>
          <DialogFooter>
            <Button type="submit">Post poll</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
