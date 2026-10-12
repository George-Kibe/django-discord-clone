import { describe, expect, it } from "vitest";

import type { ChatMessage } from "../api";
import { isGrouped } from "./message-list";

const at = (author: string | null, iso: string): ChatMessage => ({
  id: iso,
  channel_id: "c",
  author: author ? { id: author, username: author, display_name: "", avatar_url: null } : null,
  type: "default",
  content: "x",
  nonce: null,
  created_at: iso,
  edited_at: null,
  dm_id: null,
  pinned_at: null,
  reply_to: null,
  attachments: [],
  reactions: [],
  mentions: [],
  mention_roles: [],
  mention_everyone: false,
  poll: null,
});

describe("isGrouped", () => {
  it("groups consecutive messages by the same author within five minutes", () => {
    expect(isGrouped(at("a", "2026-01-01T10:00:00Z"), at("a", "2026-01-01T10:04:59Z"))).toBe(true);
    expect(isGrouped(at("a", "2026-01-01T10:00:00Z"), at("a", "2026-01-01T10:05:01Z"))).toBe(false);
    expect(isGrouped(at("a", "2026-01-01T10:00:00Z"), at("b", "2026-01-01T10:00:10Z"))).toBe(false);
    expect(isGrouped(undefined, at("a", "2026-01-01T10:00:00Z"))).toBe(false);
    expect(isGrouped(at(null, "2026-01-01T10:00:00Z"), at(null, "2026-01-01T10:00:01Z"))).toBe(
      false,
    );
  });
});
