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
