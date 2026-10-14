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
  backfill,
  conversationOf,
  mergeNewest,
  messageKeys,
  patchReaction,
  removeMessage,
  replaceMessage,
  type Pages,
} from "@/features/chat/api";
import { dmKeys, type DMConversation } from "@/features/dms/api";
import { applyPollUpdate, patchPoll } from "@/features/polls/api";
import {
  markReadLocally,
  notificationKeys,
  upsertNotification,
  type AppNotification,
} from "@/features/notifications/api";
import { keys } from "@/features/servers/api";
import { refreshSession } from "@/lib/api/client";
import { meQueryKey } from "@/lib/auth/session";
import { clearSessionHint } from "@/lib/cookies";
import { RealtimeClient, type ConnectionStatus } from "@/lib/realtime/client";
import type { GatewayEvent } from "@/lib/realtime/events";
import { wsUrl } from "@/lib/realtime/ws-url";

import { showBrowserNotification } from "@/features/notifications/browser";

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

/** Moves a DM to the top of the sidebar when a message arrives (or refetches if it's new). */
function bumpDM(queryClient: QueryClient, dmId: string, messageId: string) {
  const list = queryClient.getQueryData<DMConversation[]>(dmKeys.list);
  const found = list?.find((d) => d.id === dmId);
  if (!list || !found) {
    void queryClient.invalidateQueries({ queryKey: dmKeys.list, exact: true });
    return;
  }
  queryClient.setQueryData<DMConversation[]>(dmKeys.list, [
    { ...found, last_message_id: messageId },
    ...list.filter((d) => d.id !== dmId),
  ]);
}

export type EventContext = {
  myId: string;
  serverId?: string;
  leaveServer: (id: string, reason: string) => void;
  leaveDM?: (id: string) => void;
  onNotification?: (notification: AppNotification) => void;
  onExportFailed?: () => void;
};

/** Applies one gateway event to the client caches (ADR-024: hot paths patch, the rest refetch). */
export function applyEvent(queryClient: QueryClient, event: GatewayEvent, ctx: EventContext): void {
  switch (event.type) {
    case "message.created": {
      const message = event.data;
      const conversation = conversationOf(message);
      queryClient.setQueryData<Pages>(messageKeys.of(conversation), (old) =>
        mergeNewest(old, [message]),
      );
      if (message.author) typingStore.stop(conversation.id, message.author.id);
      const mine = message.author?.id === ctx.myId;
      patchReadState(queryClient, conversation.id, (state) => ({
        ...state,
        last_message_id: message.id,
        last_read_message_id: mine ? message.id : state.last_read_message_id,
      }));
      if (message.dm_id) bumpDM(queryClient, message.dm_id, message.id);
      return;
    }
    case "message.updated":
      queryClient.setQueryData<Pages>(messageKeys.of(conversationOf(event.data)), (old) =>
        replaceMessage(old, event.data),
      );
      return;
    case "message.deleted":
      queryClient.setQueryData<Pages>(messageKeys.of(conversationOf(event.data)), (old) =>
        removeMessage(old, event.data.id),
      );
      return;
    case "reaction.added":
    case "reaction.removed": {
      const { message_id, emoji, count, user_id } = event.data;
      const me = user_id === ctx.myId ? event.type === "reaction.added" : undefined;
      queryClient.setQueryData<Pages>(messageKeys.of(conversationOf(event.data)), (old) =>
        patchReaction(old, message_id, emoji, count, me),
      );
      return;
    }
    case "poll.updated": {
      const { message_id, poll, voter_id, voter_option_ids } = event.data;
      queryClient.setQueryData<Pages>(messageKeys.of(conversationOf(event.data)), (old) =>
        patchPoll(old, message_id, (current) =>
          applyPollUpdate(current, poll, {
            isMe: voter_id === ctx.myId,
            optionIds: voter_option_ids,
          }),
        ),
      );
      return;
    }
    case "export.ready":
      return; // announced through its inbox notification
    case "export.failed":
      ctx.onExportFailed?.();
      return;
    case "pins.updated":
      void queryClient.invalidateQueries({
        queryKey: messageKeys.pins(conversationOf(event.data)),
      });
      return;
    case "notification.created":
    case "notification.updated":
      upsertNotification(queryClient, event.data);
      ctx.onNotification?.(event.data);
      return;
    case "notification.read":
      markReadLocally(queryClient, event.data.ids);
      return;
    case "mute_settings.updated":
      void queryClient.invalidateQueries({ queryKey: notificationKeys.mutes });
      return;
    case "dm.created":
    case "dm.updated":
      void queryClient.invalidateQueries({ queryKey: dmKeys.list, exact: true });
      void queryClient.invalidateQueries({ queryKey: dmKeys.detail(event.data.dm_id) });
      void queryClient.invalidateQueries({ queryKey: readStatesKey });
      return;
    case "dm.removed":
      queryClient.removeQueries({ queryKey: dmKeys.detail(event.data.dm_id) });
      void queryClient.invalidateQueries({ queryKey: dmKeys.list, exact: true });
      ctx.leaveDM?.(event.data.dm_id);
      return;
    case "typing.started":
      if (event.data.user_id === ctx.myId) return;
      typingStore.start(
        event.data.channel_id ?? event.data.dm_id ?? "",
        { userId: event.data.user_id, name: event.data.display_name || event.data.username },
        event.data.expires_in,
      );
      return;
    case "presence.updated":
      presenceStore.update(event.data.user_id, event.data.status, event.data.version);
      return;
    case "read_state.updated":
      patchReadState(queryClient, event.data.channel_id ?? event.data.dm_id ?? "", (state) => ({
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
    case "category.reordered":
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
/**
 * Catch up on what happened while we weren't subscribed: refetch everything and backfill loaded
 * conversations. Also runs on the *first* `ready`: anything fetched before the gateway
 * subscribed may already be stale (a channel created, a message sent, a badge bumped in between).
 */
export async function resync(queryClient: QueryClient) {
  typingStore.clear();
  presenceStore.clear(); // member lists are refetched below
  const isMessages = (key: readonly unknown[]) =>
    key.length === 3 && key[2] === "messages" && (key[0] === "channels" || key[0] === "dms");
  const messageQueries = queryClient
    .getQueryCache()
    .findAll({ predicate: (query) => isMessages(query.queryKey) });
  void queryClient.invalidateQueries({
    predicate: ({ queryKey }) => !isMessages(queryKey), // messages are backfilled instead
  });
  await Promise.all(
    messageQueries.map(({ queryKey }) =>
      backfill(queryClient, {
        kind: queryKey[0] === "channels" ? "channel" : "dm",
        id: String(queryKey[1]),
      }).catch(() => undefined),
    ),
  );
}

export function RealtimeProvider({ myId, children }: { myId: string; children: ReactNode }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { serverId, dmId } = useParams<{ serverId?: string; dmId?: string }>();
  const [status, setStatus] = useState<ConnectionStatus>("closed");
  const clientRef = useRef<RealtimeClient | null>(null);
  // Handlers read the latest route without reconnecting when it changes.
  const latest = useRef({ serverId, dmId, router });
  useEffect(() => {
    latest.current = { serverId, dmId, router };
  });
  // Exposed for diagnostics and E2E tests ("open" means subscribed, after `ready`).
  useEffect(() => {
    document.documentElement.dataset.realtime = status;
  }, [status]);

  useEffect(() => {
    const leaveServer = (id: string, reason: string) => {
      if (latest.current.serverId !== id) return;
      toast.info(reason);
      latest.current.router.replace("/channels/me");
    };
    const leaveDM = (id: string) => {
      if (latest.current.dmId !== id) return;
      toast.info("You're no longer in that conversation.");
      latest.current.router.replace("/channels/me");
    };
    const onNotification = (notification: AppNotification) =>
      showBrowserNotification(notification, (href) => latest.current.router.push(href));
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
          void resync(queryClient);
        }
        applyEvent(queryClient, event, {
          myId,
          serverId: latest.current.serverId,
          leaveServer,
          leaveDM,
          onNotification,
          onExportFailed: () => toast.error("Your transcript export failed. Please try again."),
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
