import { describe, expect, it } from "vitest";

import { wsUrl } from "./ws-url";

describe("wsUrl", () => {
  it("uses ws:// for http origins", () => {
    expect(wsUrl("/ws/ping/", { protocol: "http:", host: "localhost" })).toBe(
      "ws://localhost/ws/ping/",
    );
  });

  it("uses wss:// for https origins and keeps the port", () => {
    expect(wsUrl("ws/", { protocol: "https:", host: "chat.example.com:8443" })).toBe(
      "wss://chat.example.com:8443/ws/",
    );
  });
});
