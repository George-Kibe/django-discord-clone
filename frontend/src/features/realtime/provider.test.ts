import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { messageKeys, type Pages } from "@/features/chat/api";
import { keys } from "@/features/servers/api";

import { presenceStore } from "./presence";
import { applyEvent } from "./provider";
import { isUnread, readStatesKey, summarize, type ReadState } from "./read-states";
import { typingStore } from "./typing";

const author = { id: "u2", username: "bo", display_name: "Bo", avatar_url: null };
const message = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  channel_id: "c1",
  server_id: "s1",
  author,
  type: "default" as const,
  content: `msg ${id}`,
  nonce: null,
  created_at: "2026-10-12T00:00:00Z",
  edited_at: null,
  ...extra,
});

function setup() {
  const queryClient = new QueryClient();
  const pages: Pages = {
    pages: [{ results: [message("01b"), message("01a")], has_more: false }],
    pageParams: [null],
  };
  queryClient.setQueryData(messageKeys.channel("c1"), pages);
  queryClient.setQueryData<ReadState[]>(readStatesKey, [
    {
      channel_id: "c1",
      server_id: "s1",
      last_message_id: "01b",
      last_read_message_id: "01b",
      mention_count: 0,
    },
  ]);
  const leaveServer = vi.fn();
  const apply = (event: Parameters<typeof applyEvent>[1]) =>
    applyEvent(queryClient, event, { myId: "me", serverId: "s1", leaveServer });
  const ids = () =>
    queryClient.getQueryData<Pages>(messageKeys.channel("c1"))!.pages[0].results.map((m) => m.id);
  const state = () => queryClient.getQueryData<ReadState[]>(readStatesKey)![0];
  return { queryClient, apply, ids, state, leaveServer };
}

describe("isUnread", () => {
  it("compares UUIDv7 ids", () => {
    const base = { channel_id: "c", server_id: "s", mention_count: 0 };
    expect(isUnread({ ...base, last_message_id: null, last_read_message_id: null })).toBe(false);
    expect(isUnread({ ...base, last_message_id: "01b", last_read_message_id: null })).toBe(true);
    expect(isUnread({ ...base, last_message_id: "01b", last_read_message_id: "01a" })).toBe(true);
    expect(isUnread({ ...base, last_message_id: "01b", last_read_message_id: "01b" })).toBe(false);
  });
});

describe("summarize", () => {
  it("collects unread channels/servers and sums mentions per server", () => {
    const row = (channel_id: string, server_id: string, unread: boolean, mention_count = 0) => ({
      channel_id,
      server_id,
      last_message_id: "02",
      last_read_message_id: unread ? "01" : "02",
      mention_count,
    });
    const result = summarize([
      row("c1", "s1", true, 2),
      row("c2", "s1", true, 1),
      row("c3", "s2", false),
    ]);
    expect([...result.channels]).toEqual(["c1", "c2"]);
    expect([...result.servers]).toEqual(["s1"]);
    expect(result.mentions.get("c1")).toBe(2);
    expect(result.mentions.get("s1")).toBe(3);
    expect(result.mentions.has("s2")).toBe(false);
  });
});

describe("applyEvent", () => {
  it("patches messages in, deduplicates, edits and deletes", () => {
    const { apply, ids, queryClient } = setup();
    apply({ type: "message.created", data: message("01c") });
    apply({ type: "message.created", data: message("01c") }); // duplicate delivery
    expect(ids()).toEqual(["01c", "01b", "01a"]);
    apply({ type: "message.updated", data: message("01a", { content: "edited" }) });
    const pages = queryClient.getQueryData<Pages>(messageKeys.channel("c1"))!;
    expect(pages.pages[0].results[2].content).toBe("edited");
    apply({ type: "message.deleted", data: { id: "01b", channel_id: "c1", server_id: "s1" } });
    expect(ids()).toEqual(["01c", "01a"]);
  });

  it("marks channels unread for others' messages and read for my own", () => {
    const { apply, state } = setup();
    apply({ type: "message.created", data: message("01c") });
    expect(isUnread(state())).toBe(true);
    apply({
      type: "message.created",
      data: message("01d", { author: { ...author, id: "me" } }),
    });
    expect(isUnread(state())).toBe(false);
    apply({
      type: "read_state.updated",
      data: { channel_id: "c1", server_id: "s1", last_read_message_id: "01a", mention_count: 0 },
    });
    expect(state().last_read_message_id).toBe("01a");
  });

  it("tracks typing for others and clears it when their message arrives", () => {
    const { apply } = setup();
    const typing = (user_id: string) =>
      apply({
        type: "typing.started",
        data: { channel_id: "c1", user_id, username: "x", display_name: "X", expires_in: 8 },
      });
    typing("me");
    expect(typingStore.get("c1")).toEqual([]);
    typing("u2");
    expect(typingStore.get("c1").map((t) => t.userId)).toEqual(["u2"]);
    apply({ type: "message.created", data: message("01c") });
    expect(typingStore.get("c1")).toEqual([]);
  });

  it("keeps the newest presence per user, ignoring out-of-order events", () => {
    const { apply } = setup();
    const presence = (status: "online" | "offline" | "dnd", version: number) =>
      apply({
        type: "presence.updated",
        data: { user_id: "u2", status, version, server_id: "s1" },
      });
    presence("online", 3);
    presence("offline", 2); // the old tab's late "offline"
    expect(presenceStore.getSnapshot().get("u2")).toEqual({ status: "online", version: 3 });
    presence("dnd", 4);
    expect(presenceStore.getSnapshot().get("u2")?.status).toBe("dnd");
    presenceStore.clear();
    expect(presenceStore.getSnapshot().size).toBe(0);
  });

  it("refetches on structural changes and leaves removed servers", () => {
    const { apply, queryClient, leaveServer } = setup();
    queryClient.setQueryData(keys.channels("s1"), []);
    queryClient.setQueryData(keys.server("s1"), { id: "s1" });
    apply({ type: "channel.created", data: { server_id: "s1", id: "c2" } });
    expect(queryClient.getQueryState(keys.channels("s1"))!.isInvalidated).toBe(true);
    apply({ type: "server.removed", data: { server_id: "s1" } });
    expect(queryClient.getQueryData(keys.server("s1"))).toBeUndefined();
    expect(leaveServer).toHaveBeenCalledWith("s1", expect.any(String));
  });
});
