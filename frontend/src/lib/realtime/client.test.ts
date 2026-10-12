import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { backoffDelay, RealtimeClient, type ConnectionStatus } from "./client";

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  onmessage: ((m: { data: string }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  closedWith: number | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code?: number) {
    this.readyState = 3;
    this.closedWith = code ?? null;
  }
  // test helpers
  ready(interval = 30_000) {
    this.readyState = 1;
    this.emit({ op: "event", type: "ready", data: { heartbeat_interval: interval }, seq: 1 });
  }
  emit(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  drop(code = 1006, reason = "") {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

const latest = () => FakeSocket.instances.at(-1)!;

function setup(refreshResult = true) {
  const events: unknown[] = [];
  const statuses: ConnectionStatus[] = [];
  const refresh = vi.fn(async () => refreshResult);
  const onAuthFailed = vi.fn();
  const client = new RealtimeClient({
    url: () => "ws://test/ws/",
    onEvent: (e) => events.push(e),
    onStatus: (s) => statuses.push(s),
    refresh,
    onAuthFailed,
    WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    random: () => 0.5,
  });
  client.start();
  return { client, events, statuses, refresh, onAuthFailed };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
});
afterEach(() => vi.useRealTimers());

describe("backoffDelay", () => {
  it("grows exponentially with jitter and caps at 30 s", () => {
    expect(backoffDelay(0, () => 0)).toBe(500);
    expect(backoffDelay(0, () => 1)).toBe(1000);
    expect(backoffDelay(3, () => 1)).toBe(8000);
    expect(backoffDelay(10, () => 1)).toBe(30_000);
    expect(backoffDelay(10, () => 0)).toBe(15_000);
  });
});

describe("RealtimeClient", () => {
  it("forwards events and heartbeats after ready", () => {
    const { client, events, statuses } = setup();
    latest().ready(1000);
    latest().emit({ op: "event", type: "message.created", data: { id: "m1" } });
    latest().emit({ op: "response", type: "presence.heartbeat", data: {} }); // not an event
    expect(events.map((e) => (e as { type: string }).type)).toEqual(["ready", "message.created"]);
    expect(statuses).toEqual(["connecting", "open"]);
    vi.advanceTimersByTime(2100);
    expect(latest().sent).toMatchObject([
      { op: "request", type: "presence.heartbeat" },
      { op: "request", type: "presence.heartbeat" },
    ]);
    expect(client.request("typing.start", { channel_id: "c" })).toBe(true);
    client.stop();
    expect(client.request("typing.start")).toBe(false);
  });

  it("reconnects with growing delays after network loss, resetting once ready", () => {
    const { statuses } = setup();
    latest().ready();
    latest().drop();
    expect(statuses.at(-1)).toBe("reconnecting");
    vi.advanceTimersByTime(749);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(2);
    latest().drop(); // second failure waits longer (attempt 1: 1500 ms with random 0.5)
    vi.advanceTimersByTime(1499);
    expect(FakeSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(3);
    latest().ready();
    expect(statuses.at(-1)).toBe("open");
    latest().drop();
    vi.advanceTimersByTime(750); // back to the first delay
    expect(FakeSocket.instances).toHaveLength(4);
  });

  it("on 4401 retries with current cookies first, then refreshes", async () => {
    const { refresh, onAuthFailed } = setup();
    latest().ready();
    latest().drop(4401); // a working connection: cookies may have just been replaced
    await vi.runAllTimersAsync();
    expect(refresh).not.toHaveBeenCalled();
    expect(FakeSocket.instances).toHaveLength(2);
    latest().drop(4401); // refused before ready: the access token really is stale
    await vi.runAllTimersAsync();
    expect(refresh).toHaveBeenCalledOnce();
    expect(FakeSocket.instances).toHaveLength(3);
    latest().ready();
    expect(onAuthFailed).not.toHaveBeenCalled();
  });

  it("gives up when the refresh fails or the origin is rejected", async () => {
    const first = setup(false);
    latest().drop(4401);
    await vi.runAllTimersAsync();
    expect(first.onAuthFailed).toHaveBeenCalledOnce();
    expect(first.client.status).toBe("closed");

    FakeSocket.instances = [];
    const second = setup();
    latest().drop(4403);
    await vi.runAllTimersAsync();
    expect(second.onAuthFailed).toHaveBeenCalledOnce();
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("waits the server's cooldown on 4429", () => {
    setup();
    latest().ready();
    latest().drop(4429, "10");
    vi.advanceTimersByTime(9999);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("lets a connecting socket open before closing it on stop", () => {
    const { client, events } = setup();
    const socket = latest();
    client.stop();
    expect(socket.closedWith).toBeNull(); // not aborted mid-handshake
    socket.readyState = 1;
    socket.onopen?.();
    expect(socket.closedWith).toBe(1000);
    socket.emit({ op: "event", type: "ready", data: {} }); // detached: ignored
    expect(events).toEqual([]);
  });

  it("reconnects immediately when asked and never after stop", () => {
    const { client } = setup();
    latest().drop();
    client.reconnectNow();
    expect(FakeSocket.instances).toHaveLength(2);
    client.stop();
    latest().drop();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(2);
  });
});
