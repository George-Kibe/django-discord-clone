"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { FormField, FormMessage } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api/client";
import { applyFieldErrors } from "@/lib/api/errors";
import { meQueryKey, safeNextPath } from "@/lib/auth/session";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";

import { loginSchema, type LoginValues } from "../schemas";

export function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });
  const hydrated = useHydrated();
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: LoginValues) {
    setFormError(null);
    try {
      const { data } = await api.POST("/api/v1/auth/login", { body: values });
      queryClient.setQueryData(meQueryKey, data);
      router.replace(safeNextPath(next));
      router.refresh();
    } catch (error) {
      setFormError(applyFieldErrors(error, form.setError, ["email", "password"]));
    }
  }

  return (
    <form method="post" onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
      {formError ? <FormMessage tone="error">{formError}</FormMessage> : null}
      <FormField label="Email" error={errors.email?.message}>
        {(field) => (
          <Input
            {...field}
            type="email"
            autoComplete="email"
            autoFocus
            {...form.register("email")}
          />
        )}
      </FormField>
      <FormField label="Password" error={errors.password?.message}>
        {(field) => (
          <Input
            {...field}
            type="password"
            autoComplete="current-password"
            {...form.register("password")}
          />
        )}
      </FormField>
      <div className="-mt-2 text-right text-sm">
        <Link
          href="/forgot-password"
          className="text-brand underline underline-offset-4 hover:no-underline"
        >
          Forgot your password?
        </Link>
      </div>
      <Button
        type="submit"
        disabled={isSubmitting || !hydrated}
        // Before hydration it ignores clicks (no native submit) without looking disabled.
        className={cn("w-full", !hydrated && "disabled:opacity-100")}
      >
        {isSubmitting ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
