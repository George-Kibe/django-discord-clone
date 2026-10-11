/** Browser-only helpers for the two JS-readable cookies: `csrftoken` and the `session` hint. */

export const SESSION_HINT_COOKIE = "session";
export const CSRF_COOKIE = "csrftoken";

export function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.split("; ").find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export function hasSessionHint(): boolean {
  return readCookie(SESSION_HINT_COOKIE) === "1";
}

export function clearSessionHint(): void {
  document.cookie = `${SESSION_HINT_COOKIE}=; Max-Age=0; path=/; SameSite=Lax`;
}
