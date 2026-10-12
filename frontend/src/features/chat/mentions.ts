/**
 * Mentions (FR-MSG-08). The API stores Discord-style tokens (`<@user_id>`, `<@&role_id>`,
 * `@everyone`) so renames never break them. People type `@username` / `@Role name`; the composer
 * converts known names to tokens on send and back for editing.
 */

import type { ChatMessage } from "./api";

export type MentionUser = {
  id: string;
  username: string;
  display_name?: string;
  avatar_url?: string | null;
};
export type MentionRole = { id: string; name: string; color?: number };
export type Mentionables = { users: MentionUser[]; roles: MentionRole[]; everyone: boolean };

const USER_TOKEN = /<@([0-9a-f-]{36})>/gi;
const ROLE_TOKEN = /<@&([0-9a-f-]{36})>/gi;

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `@username` and `@Role name` → tokens. Unknown names stay as typed. */
export function encodeMentions(text: string, candidates: Mentionables): string {
  const byUsername = new Map(candidates.users.map((u) => [u.username.toLowerCase(), u.id]));
  let out = text.replace(/(^|[^\w`<])@([\w.]+)/g, (match, before: string, name: string) => {
    if (name.toLowerCase() === "everyone") return match;
    const id = byUsername.get(name.toLowerCase());
    return id ? `${before}<@${id}>` : match;
  });
  const roles = [...candidates.roles].sort((a, b) => b.name.length - a.name.length);
  for (const role of roles) {
    const pattern = new RegExp(`(^|[^\\w\`<])@${escapeRegex(role.name)}(?![\\w])`, "gi");
    out = out.replace(pattern, (_m, before: string) => `${before}<@&${role.id}>`);
  }
  return out;
}

/** Tokens → `@username` / `@Role` for the edit box. */
export function decodeMentions(
  content: string,
  message: Pick<ChatMessage, "mentions" | "mention_roles">,
): string {
  const users = new Map(message.mentions.map((u) => [u.id, u.username]));
  const roles = new Map(message.mention_roles.map((r) => [r.id, r.name]));
  return content
    .replace(ROLE_TOKEN, (match, id: string) => (roles.has(id) ? `@${roles.get(id)}` : match))
    .replace(USER_TOKEN, (match, id: string) => (users.has(id) ? `@${users.get(id)}` : match));
}

function linkText(text: string): string {
  return text.replace(/([\\[\]])/g, "\\$1");
}

export const MENTION_SCHEME = "mention://";

/**
 * Tokens → Markdown links with a `mention://` URL, which the renderer draws as pills. Unknown
 * users render as "@unknown-user" (left the server, or a token typed by hand).
 */
export function mentionsToMarkdown(
  message: Pick<ChatMessage, "content" | "mentions" | "mention_roles">,
): string {
  const users = new Map(message.mentions.map((u) => [u.id, u.display_name || u.username]));
  const roles = new Map(message.mention_roles.map((r) => [r.id, r.name]));
  return message.content
    .replace(ROLE_TOKEN, (_m, id: string) =>
      roles.has(id)
        ? `[@${linkText(roles.get(id)!)}](${MENTION_SCHEME}role/${id})`
        : "@deleted-role",
    )
    .replace(USER_TOKEN, (_m, id: string) =>
      users.has(id)
        ? `[@${linkText(users.get(id)!)}](${MENTION_SCHEME}user/${id})`
        : "@unknown-user",
    )
    .replace(/(^|[^\w`[])@everyone\b/g, `$1[@everyone](${MENTION_SCHEME}everyone)`);
}

/** Should this message be highlighted for me? */
export function mentionsMe(
  message: Pick<ChatMessage, "mentions" | "mention_roles" | "mention_everyone" | "reply_to">,
  myId: string,
  myRoleIds: ReadonlySet<string> = new Set(),
): boolean {
  return (
    message.mention_everyone ||
    message.mentions.some((u) => u.id === myId) ||
    message.mention_roles.some((r) => myRoleIds.has(r.id)) ||
    message.reply_to?.author?.id === myId
  );
}

/** The `@query` being typed right before the caret, if any. */
export function mentionQuery(textBeforeCaret: string): { query: string; start: number } | null {
  const match = /(^|\s)@([\w.]*)$/.exec(textBeforeCaret);
  if (!match) return null;
  return { query: match[2], start: textBeforeCaret.length - match[2].length - 1 };
}
