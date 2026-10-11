import { describe, expect, it } from "vitest";

import { flattenMessages, mergeNewest, type ChatMessage } from "./api";

const msg = (id: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  channel_id: "c",
  author: null,
  type: "default",
  content: id,
  nonce: null,
  created_at: "2026-01-01T00:00:00Z",
  edited_at: null,
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
