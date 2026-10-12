"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { FormField, FormMessage } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api/client";
import { applyFieldErrors } from "@/lib/api/errors";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";

import { registerSchema, type RegisterInput, type RegisterValues } from "../schemas";
import { ResendVerificationButton } from "./resend-verification";

export function RegisterForm() {
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<RegisterInput, unknown, RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: "", username: "", display_name: "", password: "" },
  });
  const hydrated = useHydrated();
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: RegisterValues) {
    setFormError(null);
    try {
      const { data } = await api.POST("/api/v1/auth/register", { body: values });
      setRegisteredEmail(data?.email ?? values.email);
    } catch (error) {
      setFormError(
        applyFieldErrors(error, form.setError, ["email", "username", "display_name", "password"]),
      );
    }
  }

  if (registeredEmail) {
    return (
      <div className="grid gap-4 text-center" data-testid="register-success">
        <MailCheck className="mx-auto size-10 text-brand" aria-hidden />
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">Check your inbox</h2>
          <p className="text-sm text-muted-foreground">
            We sent a verification link to <strong>{registeredEmail}</strong>. Open it to activate
            your account, then sign in.
          </p>
        </div>
        <ResendVerificationButton email={registeredEmail} />
        <Button asChild>
          <Link href="/login">Go to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <form method="post" onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
      {formError ? <FormMessage tone="error">{formError}</FormMessage> : null}
      <FormField label="Email" error={errors.email?.message}>
        {(field) => (
          <Input {...field} type="email" autoComplete="email" {...form.register("email")} />
        )}
      </FormField>
      <FormField
        label="Username"
        error={errors.username?.message}
        hint="2–32 characters: letters, numbers, underscores and dots."
      >
        {(field) => <Input {...field} autoComplete="username" {...form.register("username")} />}
      </FormField>
      <FormField label="Display name (optional)" error={errors.display_name?.message}>
        {(field) => <Input {...field} autoComplete="nickname" {...form.register("display_name")} />}
      </FormField>
      <FormField label="Password" error={errors.password?.message} hint="At least 10 characters.">
        {(field) => (
          <Input
            {...field}
            type="password"
            autoComplete="new-password"
            {...form.register("password")}
          />
        )}
      </FormField>
      <Button
        type="submit"
        disabled={isSubmitting || !hydrated}
        // Before hydration it ignores clicks (no native submit) without looking disabled.
        className={cn("w-full", !hydrated && "disabled:opacity-100")}
      >
        {isSubmitting ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
