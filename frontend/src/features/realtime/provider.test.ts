import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { messageKeys, type Pages } from "@/features/chat/api";
import { dmKeys } from "@/features/dms/api";
import { notificationKeys } from "@/features/notifications/api";
import { keys } from "@/features/servers/api";

import { presenceStore } from "./presence";
import { applyEvent, resync } from "./provider";
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
  dm_id: null,
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
      dm_id: null,
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
    const base = { channel_id: "c", dm_id: null, server_id: "s", mention_count: 0 };
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
      dm_id: null,
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
    apply({
      type: "message.deleted",
      data: { id: "01b", channel_id: "c1", dm_id: null, server_id: "s1" },
    });
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
      data: {
        channel_id: "c1",
        dm_id: null,
        server_id: "s1",
        last_read_message_id: "01a",
        mention_count: 0,
      },
    });
    expect(state().last_read_message_id).toBe("01a");
  });

  it("tracks typing for others and clears it when their message arrives", () => {
    const { apply } = setup();
    const typing = (user_id: string) =>
      apply({
        type: "typing.started",
        data: {
          channel_id: "c1",
          dm_id: null,
          user_id,
          username: "x",
          display_name: "X",
          expires_in: 8,
        },
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

describe("Phase 5 events", () => {
  it("applies reaction counts and tracks your own", () => {
    const { apply, queryClient } = setup();
    const scope = { channel_id: "c1", dm_id: null, server_id: "s1" };
    apply({
      type: "reaction.added",
      data: { message_id: "01a", emoji: "👍", user_id: "u2", count: 1, ...scope },
    });
    apply({
      type: "reaction.added",
      data: { message_id: "01a", emoji: "👍", user_id: "me", count: 2, ...scope },
    });
    const reactions = () =>
      queryClient.getQueryData<Pages>(messageKeys.channel("c1"))!.pages[0].results[1].reactions;
    expect(reactions()).toEqual([{ emoji: "👍", count: 2, me: true }]);
    apply({
      type: "reaction.removed",
      data: { message_id: "01a", emoji: "👍", user_id: "u2", count: 1, ...scope },
    });
    expect(reactions()).toEqual([{ emoji: "👍", count: 1, me: true }]);
  });

  it("routes DM messages to the DM cache and bumps the conversation", () => {
    const { apply, queryClient } = setup();
    const dmKey = messageKeys.of({ kind: "dm", id: "d1" });
    queryClient.setQueryData<Pages>(dmKey, {
      pages: [{ results: [], has_more: false }],
      pageParams: [null],
    });
    queryClient.setQueryData(dmKeys.list, [
      { id: "d0", last_message_id: "00" },
      { id: "d1", last_message_id: "00" },
    ]);
    apply({
      type: "message.created",
      data: message("02", { channel_id: null, dm_id: "d1", server_id: null }),
    });
    expect(queryClient.getQueryData<Pages>(dmKey)!.pages[0].results.map((m) => m.id)).toEqual([
      "02",
    ]);
    expect(
      queryClient.getQueryData<{ id: string; last_message_id: string }[]>(dmKeys.list),
    ).toEqual([
      { id: "d1", last_message_id: "02" },
      { id: "d0", last_message_id: "00" },
    ]);
  });

  it("keeps the inbox and unread count current", () => {
    const { apply, queryClient } = setup();
    const onNotification = vi.fn();
    queryClient.setQueryData(notificationKeys.inbox, {
      pages: [{ results: [], unread_count: 0, next_cursor: null }],
      pageParams: [null],
    });
    const n = {
      id: "n1",
      type: "dm" as const,
      actor: author,
      message_id: "m1",
      data: { dm_id: "d1", count: 1 },
      read_at: null,
      created_at: "2026-10-12T00:00:00Z",
    };
    applyEvent(
      queryClient,
      { type: "notification.created", data: n },
      {
        myId: "me",
        leaveServer: vi.fn(),
        onNotification,
      },
    );
    apply({ type: "notification.updated", data: { ...n, data: { dm_id: "d1", count: 2 } } });
    const inbox = () =>
      queryClient.getQueryData<{ pages: { results: { id: string }[]; unread_count: number }[] }>(
        notificationKeys.inbox,
      )!.pages[0];
    expect(inbox().results).toHaveLength(1);
    expect(inbox().unread_count).toBe(1);
    expect(onNotification).toHaveBeenCalledOnce();
    // A duplicate delivery (refetch raced the event) doesn't count twice.
    apply({ type: "notification.created", data: { ...n, data: { dm_id: "d1", count: 2 } } });
    expect(inbox().unread_count).toBe(1);
    apply({ type: "notification.read", data: { ids: ["n1"] } });
    expect(inbox().unread_count).toBe(0);
  });

  it("leaves a DM you were removed from", () => {
    const { queryClient } = setup();
    const leaveDM = vi.fn();
    applyEvent(
      queryClient,
      { type: "dm.removed", data: { dm_id: "d1" } },
      {
        myId: "me",
        leaveServer: vi.fn(),
        leaveDM,
      },
    );
    expect(leaveDM).toHaveBeenCalledWith("d1");
  });
});

describe("summarize with DMs and mutes", () => {
  it("counts DM unread and hides muted channels' markers", () => {
    const rows = [
      {
        channel_id: null,
        dm_id: "d1",
        server_id: null,
        last_message_id: "02",
        last_read_message_id: "01",
        mention_count: 3,
      },
      {
        channel_id: "c1",
        dm_id: null,
        server_id: "s1",
        last_message_id: "02",
        last_read_message_id: "01",
        mention_count: 1,
      },
    ];
    const plain = summarize(rows);
    expect([...plain.dms]).toEqual(["d1"]);
    expect(plain.dmTotal).toBe(3);
    expect([...plain.channels]).toEqual(["c1"]);
    const muted = summarize(rows, (s) => s.channel_id === "c1");
    expect(muted.channels.size).toBe(0);
    expect(muted.mentions.get("c1")).toBe(1); // mentions still count
  });
});

describe("resync", () => {
  it("refreshes everything except messages, which are backfilled", async () => {
    const queryClient = new QueryClient();
    for (const key of [["read-states"], ["servers", "s1", "channels"], ["me"]])
      queryClient.setQueryData(key, []);
    queryClient.setQueryData(messageKeys.channel("c1"), {
      pages: [{ results: [], has_more: false }],
      pageParams: [null],
    });
    await resync(queryClient);
    const stale = queryClient
      .getQueryCache()
      .findAll({ predicate: (q) => q.state.isInvalidated })
      .map((q) => q.queryKey.join("/"))
      .sort();
    // Messages are never invalidated (a stale refetch could drop messages sent meanwhile).
    expect(stale).toEqual(["me", "read-states", "servers/s1/channels"]);
  });
});
