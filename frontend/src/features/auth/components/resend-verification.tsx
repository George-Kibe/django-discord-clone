"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";

export function ResendVerificationButton({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function resend() {
    setState("sending");
    try {
      await api.POST("/api/v1/auth/resend-verification", { body: { email } });
      setState("sent");
      setMessage("We sent a new link. It may take a minute to arrive.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof ApiError ? error.message : "Couldn't send the email. Try again.");
    }
  }

  return (
    <div className="grid gap-2">
      <Button
        type="button"
        variant="outline"
        onClick={resend}
        disabled={state === "sending" || state === "sent"}
      >
        {state === "sending" ? "Sending…" : state === "sent" ? "Email sent" : "Resend email"}
      </Button>
      {message ? (
        <p role="status" className="text-center text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}
    </div>
  );
}
