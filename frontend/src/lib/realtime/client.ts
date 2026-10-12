import type { GatewayEvent } from "./events";

/**
 * The real-time gateway connection (ADR-007, ADR-024): reconnects with jittered exponential
 * backoff, heartbeats, and handles the gateway's close codes.
 *
 * - 4401: the access token expired or the session was revoked. If that connection was working,
 *   first reconnect with the current cookies (a password change in this tab has just replaced
 *   them, and refreshing with the old ones would fail). If a connection is refused before
 *   `ready`, refresh over REST and reconnect; if the refresh fails the session is gone.
 * - 4403: origin rejected; reconnecting can't help (`onAuthFailed`).
 * - 4429: too many frames; wait the number of seconds in the close reason.
 * - anything else (network loss, server restart): back off 1 s → 30 s.
 */

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "closed";

type Frame = { op?: string; type?: string; data?: unknown; id?: string };

export type RealtimeOptions = {
  url: () => string;
  onEvent: (event: GatewayEvent) => void;
  onStatus?: (status: ConnectionStatus) => void;
  refresh: () => Promise<boolean>;
  onAuthFailed: () => void;
  WebSocketImpl?: typeof WebSocket;
  random?: () => number;
};

export const MIN_DELAY_MS = 1000;
export const MAX_DELAY_MS = 30_000;

/** Full-jitter-ish backoff: half fixed, half random, so a restart doesn't stampede the server. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(MAX_DELAY_MS, MIN_DELAY_MS * 2 ** attempt);
  return Math.round(ceiling / 2 + (random() * ceiling) / 2);
}

/**
 * Detach and close. A socket still connecting is closed once open instead: aborting mid-handshake
 * can leave the upstream connection dangling behind some proxies (seen with the Next.js dev
 * server), which keeps the user "online" until the presence TTL expires.
 */
function closeQuietly(socket: WebSocket): void {
  socket.onmessage = null;
  socket.onclose = null;
  if (socket.readyState === 0 /* CONNECTING */) socket.onopen = () => socket.close(1000);
  else socket.close(1000);
}

export class RealtimeClient {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private stopped = true;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private requestId = 0;
  private readyOnThisSocket = false;
  status: ConnectionStatus = "closed";

  constructor(private readonly options: RealtimeOptions) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    if (socket) closeQuietly(socket);
    this.setStatus("closed");
  }

  /** Reconnect now (e.g. the browser came back online) instead of waiting out the backoff. */
  reconnectNow(): void {
    if (this.stopped || this.status === "open" || this.status === "connecting") return;
    this.clearTimers();
    this.connect();
  }

  /** Sends a request frame. Returns false while disconnected (the caller can just drop it). */
  request(type: string, data: Record<string, unknown> = {}): boolean {
    if (this.socket?.readyState !== 1 /* OPEN */) return false;
    this.requestId += 1;
    this.socket.send(JSON.stringify({ op: "request", type, id: String(this.requestId), data }));
    return true;
  }

  private connect(): void {
    const Impl = this.options.WebSocketImpl ?? WebSocket;
    this.setStatus(this.attempt === 0 && this.status === "closed" ? "connecting" : "reconnecting");
    const socket = new Impl(this.options.url());
    this.socket = socket;
    this.readyOnThisSocket = false;
    socket.onmessage = (message) => this.onFrame(message.data);
    socket.onclose = (event) => {
      if (this.socket !== socket) return; // superseded or stopped
      this.socket = null;
      this.clearTimers();
      void this.onClose(event.code, event.reason);
    };
  }

  private onFrame(raw: unknown): void {
    let frame: Frame;
    try {
      frame = JSON.parse(String(raw)) as Frame;
    } catch {
      return;
    }
    if (frame.op !== "event" || !frame.type) return;
    if (frame.type === "ready") {
      this.attempt = 0;
      this.readyOnThisSocket = true;
      this.setStatus("open");
      const interval =
        (frame.data as { heartbeat_interval?: number })?.heartbeat_interval ?? 30_000;
      this.heartbeatTimer = setInterval(() => this.request("presence.heartbeat"), interval);
    }
    this.options.onEvent({ type: frame.type, data: frame.data } as GatewayEvent);
  }

  private async onClose(code: number, reason: string): Promise<void> {
    if (this.stopped) return;
    if (code === 4403) return this.fail();
    if (code === 4401) {
      this.setStatus("reconnecting");
      if (this.readyOnThisSocket) return this.schedule(0);
      if (!(await this.options.refresh())) return this.fail();
      if (this.stopped) return;
      return this.schedule(0);
    }
    if (code === 4429) {
      const seconds = Number.parseInt(reason, 10);
      return this.schedule((Number.isFinite(seconds) ? seconds : 10) * 1000);
    }
    this.setStatus("reconnecting");
    this.schedule(backoffDelay(this.attempt, this.options.random));
    this.attempt += 1;
  }

  private fail(): void {
    this.stop();
    this.options.onAuthFailed();
  }

  private schedule(delay: number): void {
    this.setStatus("reconnecting");
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.stopped) this.connect();
    }, delay);
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.retryTimer = null;
    this.heartbeatTimer = null;
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.options.onStatus?.(status);
  }
}
