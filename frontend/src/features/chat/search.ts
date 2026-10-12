"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import type { components } from "@/types/api";

import type { ChatMessage } from "./api";

export type SearchPage = components["schemas"]["SearchResultPage"];
export type SearchScope = { kind: "server" | "dm"; id: string };
export type SearchFilters = {
  q: string;
  author?: string;
  channel?: string;
  has?: "attachment" | "image" | "file";
  before?: string;
  after?: string;
};

export function hasCriteria(f: SearchFilters): boolean {
  return Boolean(f.q.trim() || f.author || f.channel || f.has || f.before || f.after);
}

/** Full-text search (FR-SRCH-01/02), newest first, 25 per page. */
export function useSearch(scope: SearchScope, filters: SearchFilters | null) {
  return useInfiniteQuery({
    queryKey: ["search", scope.kind, scope.id, filters],
    enabled: filters !== null && hasCriteria(filters),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const query = Object.fromEntries(
        Object.entries({ ...filters, cursor: pageParam ?? undefined }).filter(
          ([, value]) => value !== undefined && value !== "",
        ),
      );
      const { data } =
        scope.kind === "server"
          ? await api.GET("/api/v1/servers/{server_id}/messages/search", {
              params: { path: { server_id: scope.id }, query },
            })
          : await api.GET("/api/v1/dms/{dm_id}/messages/search", {
              params: { path: { dm_id: scope.id }, query },
            });
      if (!data) throw new Error("Empty response");
      return data as Omit<SearchPage, "results"> & { results: ChatMessage[] };
    },
    getNextPageParam: (last) => last.next_cursor ?? null,
  });
}
