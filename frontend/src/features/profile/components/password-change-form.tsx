"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { FormField, FormMessage } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { passwordSchema } from "@/features/auth/schemas";
import { api } from "@/lib/api/client";
import { applyFieldErrors } from "@/lib/api/errors";
import { meQueryKey } from "@/lib/auth/session";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";

const schema = z
  .object({
    current_password: z.string().min(1, "Enter your current password."),
    new_password: passwordSchema,
    confirm: z.string(),
  })
  .refine((data) => data.new_password === data.confirm, {
    path: ["confirm"],
    message: "Passwords don't match.",
  });
type Values = z.infer<typeof schema>;

export function PasswordChangeForm() {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { current_password: "", new_password: "", confirm: "" },
  });
  const hydrated = useHydrated();
  const { errors, isSubmitting } = form.formState;

  async function onSubmit({ current_password, new_password }: Values) {
    setFormError(null);
    try {
      const { data } = await api.POST("/api/v1/auth/password/change", {
        body: { current_password, new_password },
      });
      queryClient.setQueryData(meQueryKey, data);
      form.reset();
      toast.success("Password changed. Other sessions were signed out.");
    } catch (error) {
      setFormError(applyFieldErrors(error, form.setError, ["current_password", "new_password"]));
    }
  }

  return (
    <form method="post" onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
      {formError ? <FormMessage tone="error">{formError}</FormMessage> : null}
      <FormField label="Current password" error={errors.current_password?.message}>
        {(field) => (
          <Input
            {...field}
            type="password"
            autoComplete="current-password"
            {...form.register("current_password")}
          />
        )}
      </FormField>
      <FormField
        label="New password"
        error={errors.new_password?.message}
        hint="At least 10 characters."
      >
        {(field) => (
          <Input
            {...field}
            type="password"
            autoComplete="new-password"
            {...form.register("new_password")}
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
      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={isSubmitting || !hydrated}
          // Before hydration it ignores clicks (no native submit) without looking disabled.
          className={cn(!hydrated && "disabled:opacity-100")}
        >
          {isSubmitting ? "Saving…" : "Change password"}
        </Button>
      </div>
    </form>
  );
}
