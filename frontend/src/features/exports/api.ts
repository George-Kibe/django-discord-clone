"use client";

import { useMutation } from "@tanstack/react-query";

import type { Conversation } from "@/features/chat/api";
import { api } from "@/lib/api/client";

export function useStartExport(c: Conversation) {
  return useMutation({
    mutationFn: async (range: { date_from: string | null; date_to: string | null }) => {
      const { data } = await api.POST("/api/v1/exports", {
        body: { ...(c.kind === "channel" ? { channel_id: c.id } : { dm_id: c.id }), ...range },
      });
      return data;
    },
  });
}

/** Fetches a fresh signed link (valid 15 minutes) and starts the download. */
export async function downloadExport(exportId: string): Promise<void> {
  const { data } = await api.GET("/api/v1/exports/{export_id}", {
    params: { path: { export_id: exportId } },
  });
  if (!data?.download_url) throw new Error("This export is no longer available.");
  const link = document.createElement("a");
  link.href = data.download_url;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
