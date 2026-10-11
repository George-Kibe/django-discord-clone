"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { FormField, FormMessage } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { emailSchema } from "@/features/auth/schemas";
import { api } from "@/lib/api/client";
import { applyFieldErrors } from "@/lib/api/errors";

const schema = z.object({
  new_email: emailSchema,
  password: z.string().min(1, "Enter your current password."),
});
type Values = z.infer<typeof schema>;

export function EmailChangeForm() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { new_email: "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: Values) {
    setFormError(null);
    try {
      await api.POST("/api/v1/users/me/email", { body: values });
      setSentTo(values.new_email);
      form.reset();
    } catch (error) {
      setFormError(applyFieldErrors(error, form.setError, ["new_email", "password"]));
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
      {sentTo ? (
        <FormMessage tone="success">
          We sent a confirmation link to <strong>{sentTo}</strong>. Your email changes once you open
          it.
        </FormMessage>
      ) : null}
      {formError ? <FormMessage tone="error">{formError}</FormMessage> : null}
      <FormField label="New email" error={errors.new_email?.message}>
        {(field) => (
          <Input {...field} type="email" autoComplete="email" {...form.register("new_email")} />
        )}
      </FormField>
      <FormField label="Current password" error={errors.password?.message}>
        {(field) => (
          <Input
            {...field}
            type="password"
            autoComplete="current-password"
            {...form.register("password")}
          />
        )}
      </FormField>
      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Sending…" : "Change email"}
        </Button>
      </div>
    </form>
  );
}
