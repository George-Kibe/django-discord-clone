"use client";

import { Download, ExternalLink, FileText } from "lucide-react";
import { useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

import type { Attachment } from "../api";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Inline image previews (click for a lightbox) and download cards for other files. */
export function Attachments({ items }: { items: Attachment[] }) {
  const [open, setOpen] = useState<Attachment | null>(null);
  if (!items.length) return null;
  const images = items.filter((a) => a.is_image);
  const files = items.filter((a) => !a.is_image);
  return (
    <div className="mt-1 grid gap-1" data-testid="attachments">
      {images.length ? (
        <div className="flex flex-wrap gap-1">
          {images.map((image) => (
            <button
              key={image.id}
              type="button"
              onClick={() => setOpen(image)}
              className="overflow-hidden rounded-md border border-border focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              aria-label={`Open image ${image.filename}`}
            >
              {/* Cloudinary already serves sized, optimised previews. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.preview_url ?? image.url ?? ""}
                alt={image.filename}
                width={image.width ?? undefined}
                height={image.height ?? undefined}
                loading="lazy"
                className="max-h-72 w-auto max-w-[min(100%,24rem)] object-contain"
              />
            </button>
          ))}
        </div>
      ) : null}
      {files.map((file) => (
        <a
          key={file.id}
          href={file.url ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="flex max-w-sm items-center gap-3 rounded-md border border-border bg-card p-3 hover:bg-accent"
          data-testid="file-attachment"
        >
          <FileText className="size-8 shrink-0 text-brand" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-brand underline">
              {file.filename}
            </span>
            <span className="block text-xs text-muted-foreground">
              {formatBytes(file.size_bytes)}
            </span>
          </span>
          <Download className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </a>
      ))}
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-[min(95vw,64rem)] p-2" data-testid="lightbox">
          <DialogTitle className="sr-only">{open?.filename}</DialogTitle>
          <DialogDescription className="sr-only">Full-size image</DialogDescription>
          {open ? (
            <div className="grid gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={open.url ?? ""}
                alt={open.filename}
                className="max-h-[80vh] w-full object-contain"
              />
              <a
                href={open.url ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 justify-self-start text-sm text-brand underline"
              >
                <ExternalLink className="size-3.5" aria-hidden /> Open original
              </a>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
