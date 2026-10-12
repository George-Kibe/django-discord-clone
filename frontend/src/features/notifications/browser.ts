import type { AppNotification } from "./api";

/** FR-PRES-03: desktop notifications while the tab is in the background (opt-in). */

const SETTING = "notifications.browser";

export function browserNotificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function browserNotificationsEnabled(): boolean {
  if (!browserNotificationsSupported() || Notification.permission !== "granted") return false;
  try {
    return localStorage.getItem(SETTING) === "on";
  } catch {
    return false;
  }
}

export function setBrowserNotificationsEnabled(on: boolean): void {
  try {
    localStorage.setItem(SETTING, on ? "on" : "off");
  } catch {
    // storage unavailable (private mode): the toggle just won't persist
  }
}

/** Where a notification leads: the DM or the channel it came from. */
export function notificationHref(n: Pick<AppNotification, "data">): string {
  const data = n.data as Record<string, string | undefined>;
  if (data.export_id)
    return data.dm_id
      ? `/channels/me/${data.dm_id}`
      : `/channels/${data.server_id}/${data.channel_id}`;
  if (data.dm_id) return `/channels/me/${data.dm_id}`;
  if (data.server_id && data.channel_id) return `/channels/${data.server_id}/${data.channel_id}`;
  return "/channels/me";
}

/** Mention tokens read as "@…" outside the app (names aren't in the payload). */
export function plainText(content: string): string {
  return content
    .replace(/<@&[0-9a-f-]{36}>/gi, "@role")
    .replace(/<@[0-9a-f-]{36}>/gi, "@user")
    .slice(0, 180);
}

export function describe(n: AppNotification): { title: string; body: string } {
  const data = n.data as Record<string, string | number | undefined>;
  const actor = n.actor ? n.actor.display_name || n.actor.username : "Someone";
  const where = data.channel_name ? ` in #${data.channel_name}` : "";
  const body = plainText(String(data.content ?? ""));
  if (n.type === "mention") return { title: `${actor} mentioned you${where}`, body };
  if (n.type === "reply") return { title: `${actor} replied to you${where}`, body };
  if (n.type === "export_ready")
    return {
      title: `Your transcript of ${data.channel_name ? `#${data.channel_name}` : data.label} is ready`,
      body: `${data.message_count ?? 0} messages · the download link is valid for 24 hours`,
    };
  const count = Number(data.count ?? 1);
  const group = data.dm_name ? ` in ${data.dm_name}` : "";
  return {
    title: count > 1 ? `${count} new messages from ${actor}${group}` : `${actor}${group}`,
    body,
  };
}

export function showBrowserNotification(n: AppNotification, open: (href: string) => void): void {
  if (!browserNotificationsEnabled()) return;
  if (!document.hidden && document.hasFocus()) return; // the in-app inbox is enough
  const { title, body } = describe(n);
  const notification = new Notification(title, {
    body,
    tag: n.id, // a coalesced DM entry replaces its previous popup
    icon: n.actor?.avatar_url ?? undefined,
  });
  notification.onclick = () => {
    window.focus();
    open(notificationHref(n));
    notification.close();
  };
}
