import { api } from "@/lib/api/client";
import type { Me } from "@/lib/auth/session";
import { uploadImage } from "@/lib/media/upload";

export async function uploadAvatar(blob: Blob): Promise<Me> {
  const publicId = await uploadImage("avatar", blob);
  const { data } = await api.PUT("/api/v1/users/me/avatar", { body: { public_id: publicId } });
  if (!data) throw new Error("Couldn't save the avatar.");
  return data;
}

export async function removeAvatar(): Promise<Me> {
  const { data } = await api.DELETE("/api/v1/users/me/avatar");
  if (!data) throw new Error("Couldn't remove the avatar.");
  return data;
}
