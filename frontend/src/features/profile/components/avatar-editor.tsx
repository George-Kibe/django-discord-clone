"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { errorMessage, ImagePicker } from "@/components/image-picker";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import { meQueryKey, type Me } from "@/lib/auth/session";

import { removeAvatar, uploadAvatar } from "../upload";

export function AvatarEditor({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function upload(blob: Blob) {
    queryClient.setQueryData(meQueryKey, await uploadAvatar(blob));
    toast.success("Avatar updated");
  }

  async function remove() {
    setBusy(true);
    try {
      queryClient.setQueryData(meQueryKey, await removeAvatar());
      toast.success("Avatar removed");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <UserAvatar user={me} className="size-20 text-2xl" data-testid="profile-avatar" />
      <div className="flex flex-wrap gap-2">
        <ImagePicker
          label="Change avatar"
          title="Crop your avatar"
          disabled={busy}
          onCropped={upload}
          inputTestId="avatar-input"
          saveTestId="save-avatar"
        />
        {me.avatar_url ? (
          <Button
            type="button"
            variant="ghost"
            onClick={remove}
            disabled={busy}
            data-testid="remove-avatar"
          >
            Remove
          </Button>
        ) : null}
      </div>
    </div>
  );
}
