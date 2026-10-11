"use client";

import { useParams } from "next/navigation";

import { ChatView } from "@/features/chat/components/chat-view";
import { useChannels } from "@/features/servers/api";

import { ServerMobileNav, useCurrentServer } from "../server-layout";

export function ChannelPage() {
  const server = useCurrentServer();
  const { channelId } = useParams<{ channelId: string }>();
  const { data: channels, isPending } = useChannels(server.id);
  const channel = channels?.find((c) => c.id === channelId);

  if (isPending) return <div className="flex-1" role="status" aria-label="Loading channel" />;
  if (!channel) {
    return (
      <p className="m-auto p-4 text-muted-foreground" role="alert">
        This channel doesn&apos;t exist or you can&apos;t see it.
      </p>
    );
  }
  // key: reset scroll/list state when switching channels.
  return <ChatView key={channel.id} channel={channel} headerStart={<ServerMobileNav />} />;
}
