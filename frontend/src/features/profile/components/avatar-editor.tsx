"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { toast } from "sonner";

import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ApiError } from "@/lib/api/errors";
import { meQueryKey, type Me } from "@/lib/auth/session";

import { AVATAR_TYPES, cropToBlob, validateAvatarFile } from "../crop-image";
import { removeAvatar, uploadAvatar } from "../upload";

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

export function AvatarEditor({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(
    () => () => {
      if (source) URL.revokeObjectURL(source);
    },
    [source],
  );

  function pick(file: File | undefined) {
    if (!file) return;
    const problem = validateAvatarFile(file);
    if (problem) {
      toast.error(problem);
      return;
    }
    setZoom(1);
    setCrop({ x: 0, y: 0 });
    setSource(URL.createObjectURL(file));
  }

  async function save() {
    if (!source || !area) return;
    setBusy(true);
    try {
      const updated = await uploadAvatar(await cropToBlob(source, area));
      queryClient.setQueryData(meQueryKey, updated);
      toast.success("Avatar updated");
      setSource(null);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
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
        <Button type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
          Change avatar
        </Button>
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
        <input
          ref={inputRef}
          type="file"
          accept={AVATAR_TYPES.join(",")}
          className="sr-only"
          aria-label="Choose an avatar image"
          data-testid="avatar-input"
          onChange={(event) => {
            pick(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>

      <Dialog open={source !== null} onOpenChange={(open) => !open && !busy && setSource(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Crop your avatar</DialogTitle>
            <DialogDescription>Drag to reposition and use the slider to zoom.</DialogDescription>
          </DialogHeader>
          <div className="relative h-72 overflow-hidden rounded-md bg-black">
            {source ? (
              <Cropper
                image={source}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, pixels) => setArea(pixels)}
              />
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label id="zoom-label">Zoom</Label>
            <Slider
              aria-labelledby="zoom-label"
              min={1}
              max={3}
              step={0.05}
              value={[zoom]}
              onValueChange={([value]) => setZoom(value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setSource(null)} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={busy || !area} data-testid="save-avatar">
              {busy ? "Uploading…" : "Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
