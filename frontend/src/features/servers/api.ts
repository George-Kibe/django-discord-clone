"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import type { components } from "@/types/api";

export type Server = components["schemas"]["Server"];
export type ServerDetail = components["schemas"]["ServerDetail"];
export type Channel = components["schemas"]["Channel"];
export type Category = components["schemas"]["Category"];
export type Role = components["schemas"]["Role"];
export type Member = components["schemas"]["Member"];
export type Invite = components["schemas"]["Invite"];
export type InvitePreview = components["schemas"]["InvitePreview"];
export type Topic = components["schemas"]["Topic"];
export type PermissionInfo = components["schemas"]["PermissionInfo"];

export const keys = {
  servers: ["servers"] as const,
  server: (id: string) => ["servers", id] as const,
  channels: (serverId: string) => ["servers", serverId, "channels"] as const,
  categories: (serverId: string) => ["servers", serverId, "categories"] as const,
  roles: (serverId: string) => ["servers", serverId, "roles"] as const,
  members: (serverId: string) => ["servers", serverId, "members"] as const,
  invites: (serverId: string) => ["servers", serverId, "invites"] as const,
  topics: ["topics"] as const,
  permissions: ["permissions"] as const,
};

function must<T>(data: T | undefined): T {
  if (data === undefined) throw new Error("Empty response");
  return data;
}

// ---------------------------------------------------------------------------- queries

export function useServers() {
  return useQuery({
    queryKey: keys.servers,
    queryFn: async () => must((await api.GET("/api/v1/servers")).data),
  });
}

export function useServer(serverId: string) {
  return useQuery({
    queryKey: keys.server(serverId),
    queryFn: async () =>
      must(
        (
          await api.GET("/api/v1/servers/{server_id}", {
            params: { path: { server_id: serverId } },
          })
        ).data,
      ),
  });
}

export function useChannels(serverId: string) {
  return useQuery({
    queryKey: keys.channels(serverId),
    queryFn: async () =>
      must(
        (
          await api.GET("/api/v1/servers/{server_id}/channels", {
            params: { path: { server_id: serverId } },
          })
        ).data,
      ),
  });
}

export function useCategories(serverId: string) {
  return useQuery({
    queryKey: keys.categories(serverId),
    queryFn: async () =>
      must(
        (
          await api.GET("/api/v1/servers/{server_id}/categories", {
            params: { path: { server_id: serverId } },
          })
        ).data,
      ),
  });
}

export function useRoles(serverId: string) {
  return useQuery({
    queryKey: keys.roles(serverId),
    queryFn: async () =>
      must(
        (
          await api.GET("/api/v1/servers/{server_id}/roles", {
            params: { path: { server_id: serverId } },
          })
        ).data,
      ),
  });
}

export function useMembers(serverId: string) {
  return useQuery({
    queryKey: keys.members(serverId),
    // Kept current by gateway events: presence is patched in, membership changes refetch.
    staleTime: Infinity,
    queryFn: async () => {
      // Small servers (NFR-SCALE-01): fetch every page, 100 per page.
      const all: Member[] = [];
      for (let page = 1; page < 50; page++) {
        const data = must(
          (
            await api.GET("/api/v1/servers/{server_id}/members", {
              params: { path: { server_id: serverId }, query: { page } },
            })
          ).data,
        );
        all.push(...data.results);
        if (!data.next) break;
      }
      return all;
    },
  });
}

export function useInvites(serverId: string, enabled = true) {
  return useQuery({
    queryKey: keys.invites(serverId),
    enabled,
    queryFn: async () =>
      must(
        (
          await api.GET("/api/v1/servers/{server_id}/invites", {
            params: { path: { server_id: serverId } },
          })
        ).data,
      ),
  });
}

export function useTopics() {
  return useQuery({
    queryKey: keys.topics,
    staleTime: Infinity,
    queryFn: async () => must((await api.GET("/api/v1/topics")).data),
  });
}

export function usePermissionInfo() {
  return useQuery({
    queryKey: keys.permissions,
    staleTime: Infinity,
    queryFn: async () => must((await api.GET("/api/v1/permissions")).data),
  });
}

// ---------------------------------------------------------------------------- mutations

/** Invalidate everything about one server (cheap at this scale). */
export function useInvalidateServer() {
  const queryClient = useQueryClient();
  return (serverId: string) => queryClient.invalidateQueries({ queryKey: keys.server(serverId) });
}

export function useCreateServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: components["schemas"]["ServerCreateRequest"]) =>
      must((await api.POST("/api/v1/servers", { body })).data),
    onSuccess: (server) => {
      queryClient.setQueryData(keys.server(server.id), server);
      void queryClient.invalidateQueries({ queryKey: keys.servers, exact: true });
    },
  });
}

export function useAcceptInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) =>
      must((await api.POST("/api/v1/invites/{code}/accept", { params: { path: { code } } })).data),
    onSuccess: (server) => {
      queryClient.setQueryData(keys.server(server.id), server);
      void queryClient.invalidateQueries({ queryKey: keys.servers, exact: true });
    },
  });
}

export function useLeaveServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (serverId: string) => {
      await api.POST("/api/v1/servers/{server_id}/leave", {
        params: { path: { server_id: serverId } },
      });
      return serverId;
    },
    onSuccess: (serverId) => {
      queryClient.removeQueries({ queryKey: keys.server(serverId) });
      void queryClient.invalidateQueries({ queryKey: keys.servers, exact: true });
    },
  });
}

/** Extracts an invite code from a full link (https://host/invite/AbC123xy) or a bare code. */
export function parseInviteCode(input: string): string | null {
  const trimmed = input.trim();
  const match = /(?:\/invite\/)?([A-Za-z0-9]{6,10})\/?$/.exec(trimmed);
  return match ? match[1] : null;
}

export function inviteUrl(code: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/invite/${code}`;
}

// ---------------------------------------------------------------------------- discovery & moderation

export type DiscoverServer = components["schemas"]["DiscoverServer"];
export type Ban = components["schemas"]["Ban"];
export type AuditEvent = components["schemas"]["AuditEvent"];
export type Overwrite = components["schemas"]["Overwrite"];

export function useDiscover(q: string, topic: string | null) {
  return useInfiniteQuery({
    queryKey: ["discover", q, topic],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) =>
      must(
        (
          await api.GET("/api/v1/discover/servers", {
            params: { query: { q, page: pageParam, ...(topic ? { topic } : {}) } },
          })
        ).data,
      ),
    getNextPageParam: (last, _all, page) => (last.next ? page + 1 : null),
  });
}

export function useJoinServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (serverId: string) =>
      must(
        (
          await api.POST("/api/v1/servers/{server_id}/join", {
            params: { path: { server_id: serverId } },
          })
        ).data,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.servers, exact: true });
      void queryClient.invalidateQueries({ queryKey: ["discover"] });
    },
  });
}

export function useBans(serverId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["servers", serverId, "bans"],
    enabled,
    queryFn: async () =>
      must(
        (
          await api.GET("/api/v1/servers/{server_id}/bans", {
            params: { path: { server_id: serverId } },
          })
        ).data,
      ),
  });
}

export function useAuditLog(serverId: string, action: string | null) {
  return useInfiniteQuery({
    queryKey: ["servers", serverId, "audit-log", action],
    initialPageParam: null as number | null,
    queryFn: async ({ pageParam }) =>
      must(
        (
          await api.GET("/api/v1/servers/{server_id}/audit-log", {
            params: {
              path: { server_id: serverId },
              query: { ...(pageParam ? { cursor: pageParam } : {}), ...(action ? { action } : {}) },
            },
          })
        ).data,
      ),
    getNextPageParam: (last) => last.next_cursor ?? null,
  });
}

export function useModeration(serverId: string) {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: keys.members(serverId) });
    void queryClient.invalidateQueries({ queryKey: ["servers", serverId, "bans"] });
    void queryClient.invalidateQueries({ queryKey: ["servers", serverId, "audit-log"] });
  };
  const path = (userId: string) => ({ path: { server_id: serverId, user_id: userId } });
  return {
    kick: useMutation({
      mutationFn: async ({ userId, reason }: { userId: string; reason: string }) => {
        await api.POST("/api/v1/servers/{server_id}/members/{user_id}/kick", {
          params: path(userId),
          body: { reason },
        });
      },
      onSuccess: refresh,
    }),
    ban: useMutation({
      mutationFn: async ({ userId, reason }: { userId: string; reason: string }) => {
        await api.POST("/api/v1/servers/{server_id}/bans", {
          params: { path: { server_id: serverId } },
          body: { user_id: userId, reason },
        });
      },
      onSuccess: refresh,
    }),
    unban: useMutation({
      mutationFn: async (userId: string) => {
        await api.DELETE("/api/v1/servers/{server_id}/bans/{user_id}", { params: path(userId) });
      },
      onSuccess: refresh,
    }),
  };
}

export function useOverwrites(channelId: string, enabled = true) {
  return useQuery({
    queryKey: ["channels", channelId, "overwrites"],
    enabled,
    queryFn: async () =>
      must(
        (
          await api.GET("/api/v1/channels/{channel_id}/overwrites", {
            params: { path: { channel_id: channelId } },
          })
        ).data,
      ),
  });
}
