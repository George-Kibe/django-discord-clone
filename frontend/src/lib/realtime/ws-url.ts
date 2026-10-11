/** Builds a same-origin WebSocket URL (ws:// on http, wss:// on https). */
export function wsUrl(path: string, location: Pick<Location, "protocol" | "host">): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${scheme}//${location.host}${normalized}`;
}
