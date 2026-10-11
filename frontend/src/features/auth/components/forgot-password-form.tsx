"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { FormField, FormMessage } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api/client";
import { applyFieldErrors } from "@/lib/api/errors";

import { forgotPasswordSchema, type ForgotPasswordValues } from "../schemas";

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: ForgotPasswordValues) {
    setFormError(null);
    try {
      await api.POST("/api/v1/auth/password/reset", { body: values });
      setSent(true);
    } catch (error) {
      setFormError(applyFieldErrors(error, form.setError, ["email"]));
    }
  }

  if (sent) {
    return (
      <FormMessage tone="success">
        If an account exists for that email, we&apos;ve sent a link to reset your password. It
        expires in 1 hour.
      </FormMessage>
    );
  }
  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
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
      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}
