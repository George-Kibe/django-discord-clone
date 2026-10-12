"use client";

import { Compass, Search, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useDeferredValue, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api/errors";
import { useMe } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

import { useDiscover, useJoinServer, useTopics, type DiscoverServer } from "../api";
import { ServerIcon } from "./server-icon";

function ServerCard({ server }: { server: DiscoverServer }) {
  const join = useJoinServer();
  const router = useRouter();
  const { data: me } = useMe();

  async function open() {
    if (server.joined) return router.push(`/channels/${server.id}`);
    try {
      await join.mutateAsync(server.id);
      router.push(`/channels/${server.id}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't join the server.");
    }
  }

  return (
    <li
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
      data-testid="discover-server"
    >
      <div className="flex items-center gap-3">
        <ServerIcon server={server} />
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{server.name}</h2>
          {server.topic ? (
            <p className="text-xs text-muted-foreground">{server.topic.name}</p>
          ) : null}
        </div>
      </div>
      <p className="line-clamp-3 min-h-[3lh] text-sm text-muted-foreground">
        {server.description || "No description yet."}
      </p>
      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Users className="size-3.5" aria-hidden /> {server.member_count} member
          {server.member_count === 1 ? "" : "s"}
        </span>
        <Button
          size="sm"
          variant={server.joined ? "outline" : "default"}
          disabled={join.isPending || (!server.joined && !me?.email_verified)}
          onClick={() => void open()}
          aria-label={`${server.joined ? "Open" : "Join"} ${server.name}`}
        >
          {server.joined ? "Open" : "Join"}
        </Button>
      </div>
    </li>
  );
}

/** FR-SRV-08: public servers, searchable and filterable by topic. */
export function Discover() {
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState<string | null>(null);
  const deferred = useDeferredValue(query.trim());
  const { data: topics = [] } = useTopics();
  const results = useDiscover(deferred, topic);
  const servers = results.data?.pages.flatMap((p) => p.results) ?? [];

  return (
    <main className="min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-5xl gap-6 px-4 py-8 sm:px-8">
        <header className="grid gap-2">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Compass className="size-6 text-brand" aria-hidden /> Discover servers
          </h1>
          <p className="text-muted-foreground">Find a study group or community to join.</p>
          <div className="relative mt-2">
            <Search
              className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or description"
              aria-label="Search servers"
              className="pl-9"
              data-testid="discover-search"
            />
          </div>
        </header>
        <nav aria-label="Topics" className="flex flex-wrap gap-2">
          {[{ slug: null, name: "All" }, ...topics].map((t) => (
            <button
              key={t.slug ?? "all"}
              type="button"
              onClick={() => setTopic(t.slug)}
              aria-pressed={topic === t.slug}
              className={cn(
                "rounded-full border px-3 py-1 text-sm",
                topic === t.slug
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border hover:bg-accent",
              )}
            >
              {t.name}
            </button>
          ))}
        </nav>
        {results.isPending ? (
          <p className="text-muted-foreground" role="status">
            Loading…
          </p>
        ) : servers.length === 0 ? (
          <p className="text-muted-foreground">No public servers match. Try another search.</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Public servers">
            {servers.map((server) => (
              <ServerCard key={server.id} server={server} />
            ))}
          </ul>
        )}
        {results.hasNextPage ? (
          <Button
            variant="outline"
            onClick={() => void results.fetchNextPage()}
            disabled={results.isFetchingNextPage}
          >
            Load more
          </Button>
        ) : null}
      </div>
    </main>
  );
}
