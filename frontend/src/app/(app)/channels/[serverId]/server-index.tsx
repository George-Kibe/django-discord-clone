"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useCategories, useChannels } from "@/features/servers/api";
import { groupChannels } from "@/features/servers/components/channel-sidebar";

import { ServerMobileNav, useCurrentServer } from "./server-layout";

/** /channels/:serverId opens the first channel the member can see. */
export function ServerIndex() {
  const server = useCurrentServer();
  const router = useRouter();
  const { data: channels } = useChannels(server.id);
  const { data: categories } = useCategories(server.id);
  const first =
    channels && categories
      ? groupChannels(categories, channels).flatMap((g) => g.channels)[0]
      : undefined;

  useEffect(() => {
    if (first) router.replace(`/channels/${server.id}/${first.id}`);
  }, [first, router, server.id]);

  if (channels && channels.length === 0) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex h-12 items-center border-b border-border px-2">
          <ServerMobileNav />
        </div>
        <p className="m-auto max-w-sm p-4 text-center text-muted-foreground">
          There are no channels you can see in {server.name} yet.
        </p>
      </div>
    );
  }
  return <div className="flex-1" role="status" aria-label="Opening channel" />;
}
