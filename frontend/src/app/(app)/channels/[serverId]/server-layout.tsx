"use client";

import { Loader2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { MobileSidebar } from "@/components/app/mobile-sidebar";
import { ApiError } from "@/lib/api/errors";
import { useServer, type ServerDetail } from "@/features/servers/api";
import { ChannelSidebar } from "@/features/servers/components/channel-sidebar";
import { MemberList, displayName } from "@/features/servers/components/member-list";
import { SearchPanel } from "@/features/chat/components/search-panel";
import { useChannels, useMembers } from "@/features/servers/api";

const ServerContext = createContext<ServerDetail | null>(null);

type Panel = "members" | "search";
const PanelContext = createContext<{ panel: Panel; setPanel: (panel: Panel) => void }>({
  panel: "members",
  setPanel: () => undefined,
});

/** The right-hand column: member list or search results. */
export function useServerPanel() {
  return useContext(PanelContext);
}

export function useCurrentServer(): ServerDetail {
  const server = useContext(ServerContext);
  if (!server) throw new Error("useCurrentServer must be used inside a server layout");
  return server;
}

/** Mobile: the channel list opens from the chat header (NFR-UX-01). */
export function ServerMobileNav() {
  const server = useCurrentServer();
  return (
    <MobileSidebar label="channels">
      <ChannelSidebar server={server} className="w-full border-r-0" />
    </MobileSidebar>
  );
}

function ServerSearch({ server, onClose }: { server: ServerDetail; onClose: () => void }) {
  const { data: members = [] } = useMembers(server.id);
  const { data: channels = [] } = useChannels(server.id);
  return (
    <div className="fixed inset-0 z-30 flex bg-background lg:static lg:z-auto">
      <SearchPanel
        scope={{ kind: "server", id: server.id }}
        people={members.map((m) => ({ id: m.user.id, name: displayName(m) }))}
        channels={channels.map((c) => ({ id: c.id, name: c.name }))}
        hrefFor={(m) => `/channels/${server.id}/${m.channel_id}`}
        onClose={onClose}
      />
    </div>
  );
}

export function ServerLayout({ children }: { children: ReactNode }) {
  const { serverId } = useParams<{ serverId: string }>();
  const server = useServer(serverId);
  const router = useRouter();
  const missing = server.error instanceof ApiError && server.error.status === 404;
  const [panel, setPanel] = useState<Panel>("members");

  useEffect(() => {
    if (missing) router.replace("/channels/me");
  }, [missing, router]);

  if (!server.data) {
    return (
      <div className="flex flex-1 items-center justify-center" role="status">
        {server.isError && !missing ? (
          <p className="text-destructive">Couldn&apos;t load this server.</p>
        ) : (
          <Loader2
            className="size-6 animate-spin text-muted-foreground"
            aria-label="Loading server"
          />
        )}
      </div>
    );
  }

  return (
    <ServerContext value={server.data}>
      <PanelContext value={{ panel, setPanel }}>
        <ChannelSidebar server={server.data} className="hidden md:flex" />
        <div className="flex min-w-0 flex-1">{children}</div>
        {panel === "search" ? (
          <ServerSearch server={server.data} onClose={() => setPanel("members")} />
        ) : (
          <MemberList serverId={serverId} />
        )}
      </PanelContext>
    </ServerContext>
  );
}
