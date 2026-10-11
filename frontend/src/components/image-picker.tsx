"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { toast } from "sonner";

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
import { cropToBlob, IMAGE_TYPES, validateImageFile } from "@/lib/media/crop-image";

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return "Something went wrong.";
}

/** "Choose image" button + square crop dialog. Calls `onCropped` with the cropped JPEG. */
export function ImagePicker({
  label,
  title,
  shape = "round",
  disabled,
  onCropped,
  inputTestId,
  saveTestId,
}: {
  label: ReactNode;
  title: string;
  shape?: "round" | "rect";
  disabled?: boolean;
  onCropped: (blob: Blob) => Promise<void>;
  inputTestId?: string;
  saveTestId?: string;
}) {
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
    const problem = validateImageFile(file);
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
      await onCropped(await cropToBlob(source, area));
      setSource(null);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" onClick={() => inputRef.current?.click()} disabled={disabled || busy}>
        {label}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_TYPES.join(",")}
        className="sr-only"
        aria-label={title}
        data-testid={inputTestId}
        onChange={(event) => {
          pick(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <Dialog open={source !== null} onOpenChange={(open) => !open && !busy && setSource(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>Drag to reposition and use the slider to zoom.</DialogDescription>
          </DialogHeader>
          <div className="relative h-72 overflow-hidden rounded-md bg-black">
            {source ? (
              <Cropper
                image={source}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape={shape}
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
            <Button type="button" onClick={save} disabled={busy || !area} data-testid={saveTestId}>
              {busy ? "Uploading…" : "Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
