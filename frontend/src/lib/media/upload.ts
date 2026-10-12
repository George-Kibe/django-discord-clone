import { api } from "@/lib/api/client";

export type UploadPurpose = "avatar" | "server_icon";

/** Signed direct upload to Cloudinary (ADR-010). Returns the public_id to attach. */
export async function uploadImage(purpose: UploadPurpose, blob: Blob): Promise<string> {
  const filename = `${purpose}.jpg`;
  const { data: signed } = await api.POST("/api/v1/media/sign", {
    body: { purpose, filename, size: blob.size },
  });
  if (!signed) throw new Error("Couldn't start the upload.");

  const form = new FormData();
  form.append("file", blob, filename);
  for (const key of [
    "api_key",
    "timestamp",
    "signature",
    "public_id",
    "allowed_formats",
    "overwrite",
  ] as const) {
    form.append(key, String(signed[key]));
  }
  const upload = await fetch(signed.upload_url, { method: "POST", body: form });
  if (!upload.ok) throw new Error("The image upload failed. Please try again.");
  return signed.public_id;
}

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS = 5;

/**
 * Message attachment (FR-MSG-10): sign, then upload straight to Cloudinary with progress.
 * Images become "image" resources (previews), other files "raw".
 */
export async function uploadAttachment(
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ publicId: string; isImage: boolean }> {
  const { data: signed, error } = await api.POST("/api/v1/media/sign", {
    body: { purpose: "attachment", filename: file.name, size: file.size },
  });
  if (!signed) throw error ?? new Error("Couldn't start the upload.");

  const form = new FormData();
  form.append("file", file);
  for (const key of ["api_key", "timestamp", "signature", "public_id", "overwrite"] as const) {
    form.append(key, String(signed[key]));
  }
  if (signed.allowed_formats) form.append("allowed_formats", signed.allowed_formats);

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", signed.upload_url);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () =>
      xhr.status < 300 ? resolve() : reject(new Error("The upload failed. Please try again."));
    xhr.onerror = () => reject(new Error("The upload failed. Check your connection."));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(form);
  });
  return { publicId: signed.public_id, isImage: signed.resource_type === "image" };
}
