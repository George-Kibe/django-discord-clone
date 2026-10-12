"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { FormField, FormMessage } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api/client";
import { applyFieldErrors } from "@/lib/api/errors";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";

import { resetPasswordSchema, type ResetPasswordValues } from "../schemas";

export function ResetPasswordForm() {
  const params = useSearchParams();
  const uid = params.get("uid");
  const token = params.get("token");
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirm: "" },
  });
  const hydrated = useHydrated();
  const { errors, isSubmitting } = form.formState;

  if (!uid || !token) {
    return (
      <FormMessage tone="error">
        This reset link is incomplete. <Link href="/forgot-password">Request a new one</Link>.
      </FormMessage>
    );
  }

  async function onSubmit(values: ResetPasswordValues) {
    setFormError(null);
    try {
      await api.POST("/api/v1/auth/password/reset/confirm", {
        body: { uid: uid!, token: token!, password: values.password },
      });
      setDone(true);
    } catch (error) {
      setFormError(applyFieldErrors(error, form.setError, ["password"]));
    }
  }

  if (done) {
    return (
      <div className="grid gap-4" data-testid="reset-success">
        <FormMessage tone="success">
          Your password has been reset. Every other session was signed out.
        </FormMessage>
        <Button asChild>
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    );
  }
  return (
    <form method="post" onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
      {formError ? (
        <FormMessage tone="error">
          {formError}{" "}
          <Link href="/forgot-password" className="underline">
            Request a new link
          </Link>
        </FormMessage>
      ) : null}
      <FormField
        label="New password"
        error={errors.password?.message}
        hint="At least 10 characters."
      >
        {(field) => (
          <Input
            {...field}
            type="password"
            autoComplete="new-password"
            autoFocus
            {...form.register("password")}
          />
        )}
      </FormField>
      <FormField label="Confirm new password" error={errors.confirm?.message}>
        {(field) => (
          <Input
            {...field}
            type="password"
            autoComplete="new-password"
            {...form.register("confirm")}
          />
        )}
      </FormField>
      <Button
        type="submit"
        disabled={isSubmitting || !hydrated}
        // Before hydration it ignores clicks (no native submit) without looking disabled.
        className={cn("w-full", !hydrated && "disabled:opacity-100")}
      >
        {isSubmitting ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}
