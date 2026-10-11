"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { FormField, FormMessage } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api/client";
import { applyFieldErrors } from "@/lib/api/errors";
import { meQueryKey, type Me } from "@/lib/auth/session";

import { profileSchema, type ProfileInput, type ProfileValues } from "../schemas";

const STATUS_OPTIONS = [
  { value: "online", label: "Online" },
  { value: "idle", label: "Idle" },
  { value: "dnd", label: "Do not disturb" },
  { value: "invisible", label: "Invisible" },
] as const;

export function ProfileForm({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ProfileInput, unknown, ProfileValues>({
    resolver: zodResolver(profileSchema),
    values: {
      display_name: me.display_name ?? "",
      username: me.username,
      bio: me.bio ?? "",
      status: me.status,
    },
  });
  const { errors, isSubmitting, isDirty } = form.formState;
  const bioLength = useWatch({ control: form.control, name: "bio" })?.length ?? 0;

  async function onSubmit(values: ProfileValues) {
    setFormError(null);
    try {
      const { data } = await api.PATCH("/api/v1/users/me", { body: values });
      queryClient.setQueryData(meQueryKey, data);
      toast.success("Profile saved");
    } catch (error) {
      setFormError(
        applyFieldErrors(error, form.setError, ["display_name", "username", "bio", "status"]),
      );
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
      {formError ? <FormMessage tone="error">{formError}</FormMessage> : null}
      <FormField label="Display name" error={errors.display_name?.message}>
        {(field) => <Input {...field} {...form.register("display_name")} />}
      </FormField>
      <FormField label="Username" error={errors.username?.message}>
        {(field) => <Input {...field} autoComplete="username" {...form.register("username")} />}
      </FormField>
      <FormField label="About me" error={errors.bio?.message} hint={`${bioLength}/500`}>
        {(field) => <Textarea {...field} rows={4} {...form.register("bio")} />}
      </FormField>
      <FormField label="Status" error={errors.status?.message}>
        {(field) => (
          <Controller
            control={form.control}
            name="status"
            render={({ field: control }) => (
              <Select value={control.value} onValueChange={control.onChange}>
                <SelectTrigger
                  id={field.id}
                  aria-describedby={field["aria-describedby"]}
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        )}
      </FormField>
      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting || !isDirty}>
          {isSubmitting ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
