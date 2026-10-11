"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleX, Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { meQueryKey } from "@/lib/auth/session";
import { hasSessionHint } from "@/lib/cookies";

type State = { status: "pending" } | { status: "ok" } | { status: "error"; message: string };

export function VerifyEmail() {
  const token = useSearchParams().get("token");
  const queryClient = useQueryClient();
  const [state, setState] = useState<State>(
    token ? { status: "pending" } : { status: "error", message: "This link is missing its token." },
  );
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    api
      .POST("/api/v1/auth/verify-email", { body: { token } })
      .then(() => {
        setState({ status: "ok" });
        void queryClient.invalidateQueries({ queryKey: meQueryKey });
      })
      .catch((error: unknown) =>
        setState({
          status: "error",
          message: error instanceof ApiError ? error.message : "Couldn't verify. Try again.",
        }),
      );
  }, [token, queryClient]);

  if (state.status === "pending") {
    return (
      <p role="status" className="flex items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Verifying your email…
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <div className="grid gap-4 text-center" data-testid="verify-error">
        <CircleX className="mx-auto size-10 text-destructive" aria-hidden />
        <p role="alert">{state.message}</p>
        <Button asChild variant="outline">
          <Link href={hasSessionHint() ? "/settings/account" : "/login"}>Request a new link</Link>
        </Button>
      </div>
    );
  }
  const signedIn = hasSessionHint();
  return (
    <div className="grid gap-4 text-center" data-testid="verify-success">
      <CircleCheck className="mx-auto size-10 text-emerald-400" aria-hidden />
      <p role="status">Your email address is verified.</p>
      <Button asChild>
        <Link href={signedIn ? "/channels/me" : "/login"}>
          {signedIn ? "Continue to the app" : "Sign in"}
        </Link>
      </Button>
    </div>
  );
}
