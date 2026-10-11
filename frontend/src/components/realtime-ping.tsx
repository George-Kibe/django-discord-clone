"use client";

import { useEffect, useState } from "react";

import { wsUrl } from "@/lib/realtime/ws-url";

import { StatusPill } from "./status-pill";

type State = { state: "ok" | "error" | "pending"; detail: string };

/** Phase 0 WebSocket round-trip check against /ws/ping/ (replaced by RealtimeClient in Phase 4). */
export function RealtimePing() {
  const [status, setStatus] = useState<State>({ state: "pending", detail: "connecting" });

  useEffect(() => {
    const socket = new WebSocket(wsUrl("/ws/ping/", window.location));
    const startedAt = performance.now();

    socket.onopen = () => socket.send(JSON.stringify({ op: "request", type: "ping", id: "1" }));
    socket.onmessage = (event: MessageEvent<string>) => {
      const frame = JSON.parse(event.data) as { type?: string };
      if (frame.type === "pong") {
        setStatus({ state: "ok", detail: `${Math.round(performance.now() - startedAt)} ms` });
        socket.close(1000);
      }
    };
    socket.onerror = () => setStatus({ state: "error", detail: "unreachable" });

    return () => socket.close(1000);
  }, []);

  return <StatusPill label="WebSocket" state={status.state} detail={status.detail} />;
}
