"use client";

import { Loader2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, type ReactNode } from "react";

import { MobileSidebar } from "@/components/app/mobile-sidebar";
import { ApiError } from "@/lib/api/errors";
import { useServer, type ServerDetail } from "@/features/servers/api";
import { ChannelSidebar } from "@/features/servers/components/channel-sidebar";
import { MemberList } from "@/features/servers/components/member-list";

const ServerContext = createContext<ServerDetail | null>(null);

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

export function ServerLayout({ children }: { children: ReactNode }) {
  const { serverId } = useParams<{ serverId: string }>();
  const server = useServer(serverId);
  const router = useRouter();
  const missing = server.error instanceof ApiError && server.error.status === 404;

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
      <ChannelSidebar server={server.data} className="hidden md:flex" />
      <div className="flex min-w-0 flex-1">{children}</div>
      <MemberList serverId={serverId} />
    </ServerContext>
  );
}
