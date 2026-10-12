"use client";

import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import {
  backfillChannel,
  mergeNewest,
  messageKeys,
  removeMessage,
  replaceMessage,
  type Pages,
} from "@/features/chat/api";
import { keys } from "@/features/servers/api";
import { refreshSession } from "@/lib/api/client";
import { meQueryKey } from "@/lib/auth/session";
import { clearSessionHint } from "@/lib/cookies";
import { RealtimeClient, type ConnectionStatus } from "@/lib/realtime/client";
import type { GatewayEvent } from "@/lib/realtime/events";
import { wsUrl } from "@/lib/realtime/ws-url";

import { presenceStore } from "./presence";
import { patchReadState, readStatesKey } from "./read-states";
import { typingStore } from "./typing";

type RealtimeContextValue = {
  status: ConnectionStatus;
  request: (type: string, data?: Record<string, unknown>) => boolean;
};

const RealtimeContext = createContext<RealtimeContextValue>({
  status: "closed",
  request: () => false,
});

export function useRealtime(): RealtimeContextValue {
  return useContext(RealtimeContext);
}

/** Everything about one server whose shape (not hot data) changed: refetch it. */
function refetchServer(queryClient: QueryClient, serverId: string, what: (keyof typeof keys)[]) {
  for (const name of what) {
    const key = keys[name];
    if (typeof key === "function")
      void queryClient.invalidateQueries({ queryKey: key(serverId), exact: true });
  }
}

function forgetServer(queryClient: QueryClient, serverId: string) {
  queryClient.removeQueries({ queryKey: keys.server(serverId) });
  void queryClient.invalidateQueries({ queryKey: keys.servers, exact: true });
  void queryClient.invalidateQueries({ queryKey: readStatesKey });
}

/** Applies one gateway event to the client caches (ADR-024: hot paths patch, the rest refetch). */
export function applyEvent(
  queryClient: QueryClient,
  event: GatewayEvent,
  ctx: { myId: string; serverId?: string; leaveServer: (id: string, reason: string) => void },
): void {
  switch (event.type) {
    case "message.created": {
      const message = event.data;
      queryClient.setQueryData<Pages>(messageKeys.channel(message.channel_id), (old) =>
        mergeNewest(old, [message]),
      );
      if (message.author) typingStore.stop(message.channel_id, message.author.id);
      const mine = message.author?.id === ctx.myId;
      patchReadState(queryClient, message.channel_id, (state) => ({
        ...state,
        last_message_id: message.id,
        last_read_message_id: mine ? message.id : state.last_read_message_id,
      }));
      return;
    }
    case "message.updated":
      queryClient.setQueryData<Pages>(messageKeys.channel(event.data.channel_id), (old) =>
        replaceMessage(old, event.data),
      );
      return;
    case "message.deleted":
      queryClient.setQueryData<Pages>(messageKeys.channel(event.data.channel_id), (old) =>
        removeMessage(old, event.data.id),
      );
      return;
    case "typing.started":
      if (event.data.user_id === ctx.myId) return;
      typingStore.start(
        event.data.channel_id,
        { userId: event.data.user_id, name: event.data.display_name || event.data.username },
        event.data.expires_in,
      );
      return;
    case "presence.updated":
      presenceStore.update(event.data.user_id, event.data.status, event.data.version);
      return;
    case "read_state.updated":
      patchReadState(queryClient, event.data.channel_id, (state) => ({
        ...state,
        last_read_message_id: event.data.last_read_message_id,
        mention_count: event.data.mention_count,
      }));
      return;
    case "user.updated":
    case "member.joined":
    case "member.left":
    case "member.updated":
      refetchServer(queryClient, event.data.server_id, ["members"]);
      if (event.data.user_id === ctx.myId && event.type === "user.updated")
        void queryClient.invalidateQueries({ queryKey: meQueryKey });
      return;
    case "role.created":
    case "role.updated":
    case "role.deleted":
    case "role.reordered":
      refetchServer(queryClient, event.data.server_id, ["roles", "members"]);
      return;
    case "channel.created":
    case "channel.updated":
    case "channel.deleted":
    case "channel.reordered":
    case "category.created":
    case "category.updated":
    case "category.deleted":
      refetchServer(queryClient, event.data.server_id, ["channels", "categories"]);
      void queryClient.invalidateQueries({ queryKey: readStatesKey });
      return;
    case "server.updated":
      void queryClient.invalidateQueries({
        queryKey: keys.server(event.data.server_id),
        exact: true,
      });
      void queryClient.invalidateQueries({ queryKey: keys.servers, exact: true });
      return;
    case "server.access_changed":
      // My roles or the channel permissions changed: permissions and visible channels.
      void queryClient.invalidateQueries({
        queryKey: keys.server(event.data.server_id),
        exact: true,
      });
      refetchServer(queryClient, event.data.server_id, ["channels", "categories"]);
      void queryClient.invalidateQueries({ queryKey: readStatesKey });
      return;
    case "server.joined":
      void queryClient.invalidateQueries({ queryKey: keys.servers, exact: true });
      void queryClient.invalidateQueries({ queryKey: readStatesKey });
      return;
    case "server.deleted":
      forgetServer(queryClient, event.data.server_id);
      ctx.leaveServer(event.data.server_id, "This server was deleted.");
      return;
    case "server.removed":
      forgetServer(queryClient, event.data.server_id);
      ctx.leaveServer(event.data.server_id, "You're no longer a member of that server.");
      return;
    case "ready":
      return;
  }
}

/** After a reconnect: catch up on whatever happened while the socket was down. */
async function resync(queryClient: QueryClient) {
  typingStore.clear();
  presenceStore.clear(); // member lists are refetched below
  const messageQueries = queryClient.getQueryCache().findAll({ queryKey: ["channels"] });
  void queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[0] !== "channels", // messages are backfilled instead
  });
  await Promise.all(
    messageQueries
      .map((query) => query.queryKey)
      .filter((key) => key.length === 3 && key[2] === "messages")
      .map((key) => backfillChannel(queryClient, String(key[1])).catch(() => undefined)),
  );
}

export function RealtimeProvider({ myId, children }: { myId: string; children: ReactNode }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { serverId } = useParams<{ serverId?: string }>();
  const [status, setStatus] = useState<ConnectionStatus>("closed");
  const clientRef = useRef<RealtimeClient | null>(null);
  // Handlers read the latest route without reconnecting when it changes.
  const latest = useRef({ serverId, router });
  useEffect(() => {
    latest.current = { serverId, router };
  });

  useEffect(() => {
    let connectedBefore = false;
    const leaveServer = (id: string, reason: string) => {
      if (latest.current.serverId !== id) return;
      toast.info(reason);
      latest.current.router.replace("/channels/me");
    };
    const client = new RealtimeClient({
      url: () => wsUrl("/ws/", window.location),
      onStatus: setStatus,
      refresh: refreshSession,
      onAuthFailed: () => {
        clearSessionHint();
        queryClient.clear();
        latest.current.router.replace("/login");
      },
      onEvent: (event) => {
        if (event.type === "ready") {
          if (connectedBefore) void resync(queryClient);
          connectedBefore = true;
        }
        applyEvent(queryClient, event, {
          myId,
          serverId: latest.current.serverId,
          leaveServer,
        });
      },
    });
    clientRef.current = client;
    client.start();
    const online = () => client.reconnectNow();
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("online", online);
      client.stop();
      clientRef.current = null;
      typingStore.clear();
      presenceStore.clear();
    };
  }, [myId, queryClient]);

  const value = useMemo<RealtimeContextValue>(
    () => ({
      status,
      request: (type, data) => clientRef.current?.request(type, data) ?? false,
    }),
    [status],
  );
  return <RealtimeContext value={value}>{children}</RealtimeContext>;
}
