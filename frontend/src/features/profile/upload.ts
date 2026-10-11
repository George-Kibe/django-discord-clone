import { api } from "@/lib/api/client";
import type { Me } from "@/lib/auth/session";

/** Signed direct upload to Cloudinary (ADR-010), then attach as the avatar. */
export async function uploadAvatar(blob: Blob): Promise<Me> {
  const filename = "avatar.jpg";
  const { data: signed } = await api.POST("/api/v1/media/sign", {
    body: { purpose: "avatar", filename, size: blob.size },
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

  const { data } = await api.PUT("/api/v1/users/me/avatar", {
    body: { public_id: signed.public_id },
  });
  if (!data) throw new Error("Couldn't save the avatar.");
  return data;
}

export async function removeAvatar(): Promise<Me> {
  const { data } = await api.DELETE("/api/v1/users/me/avatar");
  if (!data) throw new Error("Couldn't remove the avatar.");
  return data;
}
