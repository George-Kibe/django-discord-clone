import type { components } from "@/types/api";

type Message = components["schemas"]["Message"];

export type PresenceStatus = "online" | "idle" | "dnd" | "offline";

/** Server → client events on the gateway (docs/API.md §3). Not part of the OpenAPI schema. */
export type GatewayEvents = {
  ready: {
    user: { id: string; username: string };
    session_id: string;
    heartbeat_interval: number;
    server_ids: string[];
  };
  "message.created": Message & { server_id: string };
  "message.updated": Message & { server_id: string };
  "message.deleted": { id: string; channel_id: string; server_id: string };
  "typing.started": {
    channel_id: string;
    user_id: string;
    username: string;
    display_name: string;
    expires_in: number;
  };
  "presence.updated": {
    user_id: string;
    status: PresenceStatus;
    version: number;
    server_id: string;
  };
  "read_state.updated": {
    channel_id: string;
    server_id: string;
    last_read_message_id: string | null;
    mention_count: number;
  };
  "user.updated": { user_id: string; server_id: string };
  "member.joined": { user_id: string; server_id: string };
  "member.left": { user_id: string; server_id: string };
  "member.updated": { user_id: string; server_id: string };
  "server.updated": { server_id: string };
  "server.deleted": { server_id: string };
  "server.joined": { server_id: string };
  "server.removed": { server_id: string };
  "server.access_changed": { server_id: string };
  "channel.created": { server_id: string; id: string };
  "channel.updated": { server_id: string; id: string };
  "channel.deleted": { server_id: string; id: string };
  "channel.reordered": { server_id: string };
  "category.created": { server_id: string; id: string };
  "category.updated": { server_id: string; id: string };
  "category.deleted": { server_id: string; id: string };
  "role.created": { server_id: string; id: string };
  "role.updated": { server_id: string; id: string };
  "role.deleted": { server_id: string; id: string };
  "role.reordered": { server_id: string };
};

export type GatewayEvent = {
  [K in keyof GatewayEvents]: { type: K; data: GatewayEvents[K] };
}[keyof GatewayEvents];
