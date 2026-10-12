"use client";

import { Hash, Search } from "lucide-react";
import { useParams } from "next/navigation";

import { ChatView } from "@/features/chat/components/chat-view";
import { ExportButton } from "@/features/exports/components/export-button";
import { PinsButton } from "@/features/chat/components/pins-button";
import type { Mentionables } from "@/features/chat/mentions";
import { MuteButton } from "@/features/notifications/components/mute-button";
import { useChannels, useMembers, useRoles } from "@/features/servers/api";
import { hasPerm } from "@/lib/permissions";

import { ServerMobileNav, useCurrentServer, useServerPanel } from "../server-layout";

export function ChannelPage() {
  const server = useCurrentServer();
  const { channelId } = useParams<{ channelId: string }>();
  const { data: channels, isPending } = useChannels(server.id);
  const { data: members = [] } = useMembers(server.id);
  const { data: roles = [] } = useRoles(server.id);
  const { panel, setPanel } = useServerPanel();
  const channel = channels?.find((c) => c.id === channelId);
  const canEveryone = hasPerm(channel?.permissions, "MENTION_EVERYONE");

  const mentionables: Mentionables = {
    users: members.map((m) => ({
      id: m.user.id,
      username: m.user.username,
      display_name: m.nickname || m.user.display_name,
      avatar_url: m.user.avatar_url,
    })),
    roles: roles
      .filter((r) => !r.is_default && (r.mentionable || canEveryone))
      .map((r) => ({ id: r.id, name: r.name, color: r.color })),
    everyone: canEveryone,
  };
  const mentionStyle = { roleColors: new Map(roles.map((r) => [r.id, r.color ?? 0])) };
  const myRoleIds = new Set(server.me.role_ids);

  if (isPending) return <div className="flex-1" role="status" aria-label="Loading channel" />;
  if (!channel) {
    return (
      <p className="m-auto p-4 text-muted-foreground" role="alert">
        This channel doesn&apos;t exist or you can&apos;t see it.
      </p>
    );
  }
  // key: reset scroll/list state when switching channels.
  return (
    <ChatView
      key={channel.id}
      conversation={{ kind: "channel", id: channel.id }}
      label={`#${channel.name}`}
      title={channel.name}
      icon={<Hash className="size-5" aria-hidden />}
      topic={channel.topic}
      permissions={channel.permissions}
      mentionables={mentionables}
      mentionStyle={mentionStyle}
      myRoleIds={myRoleIds}
      headerStart={<ServerMobileNav />}
      headerActions={
        <>
          <MuteButton target={{ type: "channel", id: channel.id }} />
          <PinsButton conversation={{ kind: "channel", id: channel.id }} />
          {hasPerm(channel.permissions, "EXPORT_TRANSCRIPTS") ? (
            <ExportButton
              conversation={{ kind: "channel", id: channel.id }}
              label={`#${channel.name}`}
            />
          ) : null}
          <button
            type="button"
            onClick={() => setPanel(panel === "search" ? "members" : "search")}
            aria-pressed={panel === "search"}
            aria-label="Search messages"
            className="flex size-8 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            data-testid="search-button"
          >
            <Search className="size-4" aria-hidden />
          </button>
        </>
      }
      intro={
        <>
          <span className="flex size-16 items-center justify-center rounded-full bg-muted">
            <Hash className="size-8" aria-hidden />
          </span>
          <h2 className="mt-3 text-2xl font-bold">Welcome to #{channel.name}!</h2>
          <p className="text-muted-foreground">This is the start of the #{channel.name} channel.</p>
        </>
      }
    />
  );
}
