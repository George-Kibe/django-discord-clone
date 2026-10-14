import { describe, expect, it } from "vitest";

import {
  conversationOf,
  flattenMessages,
  mergeNewest,
  messageKeys,
  replaceMessage,
  setReaction,
  type ChatMessage,
} from "./api";

const msg = (id: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  channel_id: "c",
  dm_id: null,
  author: null,
  type: "default",
  content: id,
  nonce: null,
  created_at: "2026-01-01T00:00:00Z",
  edited_at: null,
  pinned_at: null,
  reply_to: null,
  attachments: [],
  reactions: [],
  mentions: [],
  mention_roles: [],
  mention_everyone: false,
  poll: null,
  ...extra,
});

const pages = (...groups: ChatMessage[][]) => ({
  pages: groups.map((results) => ({ results, has_more: false })),
  pageParams: groups.map(() => null),
});

describe("flattenMessages", () => {
  it("returns oldest-first across pages and drops duplicates", () => {
    const data = pages([msg("5"), msg("4")], [msg("4"), msg("3")]);
    expect(flattenMessages(data).map((m) => m.id)).toEqual(["3", "4", "5"]);
  });
});

describe("mergeNewest", () => {
  it("prepends unseen messages newest-first", () => {
    const merged = mergeNewest(pages([msg("2"), msg("1")]), [msg("3"), msg("4")]);
    expect(merged!.pages[0].results.map((m) => m.id)).toEqual(["4", "3", "2", "1"]);
  });

  it("replaces the optimistic copy with the server message (by nonce)", () => {
    const data = pages([msg("pending-n1", { pending: true, nonce: "n1" }), msg("1")]);
    const merged = mergeNewest(data, [msg("2", { nonce: "n1" })]);
    expect(merged!.pages[0].results.map((m) => m.id)).toEqual(["2", "1"]);
  });

  it("ignores messages already present", () => {
    const merged = mergeNewest(pages([msg("2"), msg("1")]), [msg("2")]);
    expect(merged!.pages[0].results.map((m) => m.id)).toEqual(["2", "1"]);
  });
});

describe("replaceMessage", () => {
  it("keeps cached reactions (broadcasts can't know if you reacted)", () => {
    const mine = [{ emoji: "👍", count: 2, me: true }];
    const data = pages([msg("1", { reactions: mine })]);
    const updated = replaceMessage(data, msg("1", { content: "edited", reactions: [] }));
    expect(updated!.pages[0].results[0]).toMatchObject({ content: "edited", reactions: mine });
  });
});

describe("setReaction", () => {
  const base = [{ emoji: "👍", count: 1, me: false }];
  it("adds, updates and removes emoji counts", () => {
    expect(setReaction(base, "🎉", 1, true)).toEqual([
      ...base,
      { emoji: "🎉", count: 1, me: true },
    ]);
    expect(setReaction(base, "👍", 2, undefined)).toEqual([{ emoji: "👍", count: 2, me: false }]);
    expect(setReaction(base, "👍", 2, true)).toEqual([{ emoji: "👍", count: 2, me: true }]);
    expect(setReaction(base, "👍", 0, false)).toEqual([]);
  });
});

describe("conversations", () => {
  it("maps messages to their cache keys", () => {
    expect(messageKeys.of(conversationOf({ channel_id: "c1", dm_id: null }))).toEqual([
      "channels",
      "c1",
      "messages",
    ]);
    expect(messageKeys.of(conversationOf({ channel_id: null, dm_id: "d1" }))).toEqual([
      "dms",
      "d1",
      "messages",
    ]);
  });
});

describe("refreshRecent", () => {
  it("updates edited messages, drops deleted ones, keeps older and pending ones", async () => {
    const { refreshRecent } = await import("./api");
    const data = pages(
      [
        msg("pending-x", { pending: true }),
        msg("06"), // arrived live while the refresh was in flight
        msg("05"),
        msg("04", { content: "old" }),
        msg("03"),
      ],
      [msg("01")],
    );
    // The server's newest page: 04 was edited, 03 deleted; 02 is outside the cached range.
    const next = refreshRecent(data, [msg("05"), msg("04", { content: "edited" }), msg("02")]);
    expect(next!.pages[0].results.map((m) => [m.id, m.content])).toEqual([
      ["pending-x", "pending-x"],
      ["06", "06"],
      ["05", "05"],
      ["04", "edited"],
    ]);
    expect(next!.pages[1].results.map((m) => m.id)).toEqual(["01"]);
  });
});

describe("backfill", () => {
  it("merges into an empty conversation instead of replacing it", async () => {
    const { QueryClient } = await import("@tanstack/react-query");
    const { vi } = await import("vitest");
    const client = await import("@/lib/api/client");
    const { backfill } = await import("./api");
    const queryClient = new QueryClient();
    const key = messageKeys.of({ kind: "channel", id: "c" });
    // A message sent while the backfill request was in flight.
    queryClient.setQueryData(key, pages([msg("pending-n", { pending: true, nonce: "n" })]));
    vi.spyOn(client.api, "GET").mockResolvedValue({
      data: { results: [msg("1")], has_more: false },
    } as never);
    await backfill(queryClient, { kind: "channel", id: "c" });
    const ids = queryClient
      .getQueryData<ReturnType<typeof pages>>(key)!
      .pages[0].results.map((m) => m.id);
    expect(ids).toEqual(["pending-n", "1"]); // newest first: the message being sent stays on top
  });
});

describe("useSendMessage before history loads", () => {
  it("refetches the conversation instead of dropping the message", async () => {
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { renderHook, waitFor } = await import("@testing-library/react");
    const { createElement } = await import("react");
    const { vi } = await import("vitest");
    const client = await import("@/lib/api/client");
    const { useSendMessage } = await import("./api");
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    vi.spyOn(client.api, "POST").mockResolvedValue({ data: msg("1", { nonce: "n" }) } as never);
    const { result } = renderHook(() => useSendMessage({ kind: "dm", id: "d" }, null), {
      wrapper: ({ children }) =>
        createElement(QueryClientProvider, { client: queryClient }, children),
    });
    result.current.mutate({ content: "hi", nonce: "n" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["dms", "d", "messages"], exact: true });
  });
});
