"use client";

import { Loader2, Search, X } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserAvatar } from "@/components/user-avatar";

import { mentionsToMarkdown } from "../mentions";
import { useSearch, type SearchFilters, type SearchScope } from "../search";
import { Markdown } from "./markdown";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/** Right-hand search panel with filters: from, in channel, has, before/after. */
export function SearchPanel({
  scope,
  people,
  channels = [],
  hrefFor,
  onClose,
}: {
  scope: SearchScope;
  people: { id: string; name: string }[];
  channels?: { id: string; name: string }[];
  hrefFor: (message: { channel_id: string | null; dm_id: string | null }) => string;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<SearchFilters>({ q: "" });
  const [filters, setFilters] = useState<SearchFilters | null>(null);
  const search = useSearch(scope, filters);
  const results = search.data?.pages.flatMap((p) => p.results) ?? [];
  const total = search.data?.pages[0]?.total ?? 0;
  const channelName = new Map(channels.map((c) => [c.id, c.name]));

  function submit(event: FormEvent) {
    event.preventDefault();
    setFilters({ ...draft });
  }
  const set = (patch: Partial<SearchFilters>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <aside
      aria-label="Search"
      className="flex w-full shrink-0 flex-col border-l border-border bg-card/40 lg:w-96"
      data-testid="search-panel"
    >
      <div className="flex h-12 items-center justify-between border-b border-border px-3">
        <h2 className="font-semibold">Search</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close search"
          className="rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <form onSubmit={submit} className="grid gap-2 border-b border-border p-3">
        <div className="flex gap-2">
          <Input
            value={draft.q}
            onChange={(e) => set({ q: e.target.value })}
            placeholder='Words, "a phrase", -exclude'
            aria-label="Search messages"
            data-testid="search-input"
            autoFocus
          />
          <Button type="submit" size="icon" aria-label="Search">
            <Search />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1">
            <Label htmlFor="search-from">From</Label>
            <select
              id="search-from"
              className={selectClass}
              value={draft.author ?? ""}
              onChange={(e) => set({ author: e.target.value || undefined })}
            >
              <option value="">Anyone</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          {scope.kind === "server" ? (
            <div className="grid gap-1">
              <Label htmlFor="search-in">In</Label>
              <select
                id="search-in"
                className={selectClass}
                value={draft.channel ?? ""}
                onChange={(e) => set({ channel: e.target.value || undefined })}
              >
                <option value="">Any channel</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="grid gap-1">
            <Label htmlFor="search-has">Has</Label>
            <select
              id="search-has"
              className={selectClass}
              value={draft.has ?? ""}
              onChange={(e) => set({ has: (e.target.value || undefined) as SearchFilters["has"] })}
            >
              <option value="">Anything</option>
              <option value="attachment">Attachment</option>
              <option value="image">Image</option>
              <option value="file">File</option>
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="search-after">After</Label>
            <Input
              id="search-after"
              type="date"
              value={draft.after ?? ""}
              onChange={(e) => set({ after: e.target.value || undefined })}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="search-before">Before</Label>
            <Input
              id="search-before"
              type="date"
              value={draft.before ?? ""}
              onChange={(e) => set({ before: e.target.value || undefined })}
            />
          </div>
        </div>
      </form>
      <div className="min-h-0 flex-1 overflow-y-auto p-3" aria-live="polite">
        {!filters ? (
          <p className="text-sm text-muted-foreground">Search messages you can see.</p>
        ) : search.isPending ? (
          <Loader2 className="mx-auto size-5 animate-spin" aria-label="Searching" />
        ) : search.isError ? (
          <p className="text-sm text-destructive" role="alert">
            Search failed. Check the filters and try again.
          </p>
        ) : (
          <>
            <p className="mb-2 text-sm font-semibold" data-testid="search-total">
              {total} result{total === 1 ? "" : "s"}
            </p>
            <ul className="grid gap-2" data-testid="search-results">
              {results.map((message) => (
                <li key={message.id}>
                  <Link
                    href={hrefFor(message)}
                    className="block rounded-md border border-border bg-background p-2 hover:bg-accent"
                  >
                    <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                      {message.author ? (
                        <UserAvatar user={message.author} className="size-5 text-[0.6rem]" />
                      ) : null}
                      <span className="font-semibold text-foreground">
                        {message.author?.display_name || message.author?.username || "Deleted User"}
                      </span>
                      {message.channel_id && channelName.has(message.channel_id) ? (
                        <span>#{channelName.get(message.channel_id)}</span>
                      ) : null}
                      <time className="ml-auto" dateTime={message.created_at}>
                        {new Date(message.created_at).toLocaleDateString()}
                      </time>
                    </div>
                    <div className="text-sm">
                      <Markdown>{mentionsToMarkdown(message)}</Markdown>
                    </div>
                    {message.attachments.length ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        📎 {message.attachments.map((a) => a.filename).join(", ")}
                      </p>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
            {search.hasNextPage ? (
              <Button
                variant="outline"
                className="mt-2 w-full"
                onClick={() => void search.fetchNextPage()}
                disabled={search.isFetchingNextPage}
              >
                Load more
              </Button>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}
