import createClient, { type Middleware } from "openapi-fetch";

import { clearSessionHint, CSRF_COOKIE, hasSessionHint, readCookie } from "@/lib/cookies";
import type { paths } from "@/types/api";

import { toApiError } from "./errors";

/**
 * Typed API clients generated from the backend OpenAPI schema (ADR-017).
 *
 * Browser: same-origin requests (Caddy routes /api to Django, ADR-005). Auth lives in httpOnly
 * cookies (ADR-006); this module adds the CSRF header and refreshes the access token once on 401.
 * Server: requests go straight to the api container over the Docker network.
 */

const REFRESH_PATH = "/api/v1/auth/refresh";
const CSRF_PATH = "/api/v1/auth/csrf";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
// Anonymous auth endpoints: a 401 there never means "refresh and retry".
const NO_REFRESH_PATHS = new Set(
  ["csrf", "login", "register", "refresh", "logout", "verify-email", "resend-verification"]
    .map((name) => `/api/v1/auth/${name}`)
    .concat(["/api/v1/auth/password/reset", "/api/v1/auth/password/reset/confirm"]),
);

export function getApiBaseUrl(): string {
  if (typeof window === "undefined") {
    return process.env.INTERNAL_API_URL ?? "http://api:8000";
  }
  return "";
}

/** Server-side client (public pages). */
export function createApiClient(baseUrl: string = getApiBaseUrl()) {
  return createClient<paths>({ baseUrl });
}

// ---------------------------------------------------------------------------- browser

let csrfPromise: Promise<string> | null = null;

async function ensureCsrfToken(): Promise<string> {
  const existing = readCookie(CSRF_COOKIE);
  if (existing) return existing;
  csrfPromise ??= fetch(CSRF_PATH, { credentials: "same-origin" })
    .then(() => readCookie(CSRF_COOKIE) ?? "")
    .finally(() => {
      csrfPromise = null;
    });
  return csrfPromise;
}

let refreshPromise: Promise<boolean> | null = null;

/** Single-flight token refresh: concurrent 401s share one refresh request. */
export function refreshSession(): Promise<boolean> {
  refreshPromise ??= fetch(REFRESH_PATH, { method: "POST", credentials: "same-origin" })
    .then((response) => {
      if (!response.ok) clearSessionHint();
      return response.ok;
    })
    .catch(() => false)
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

async function withCsrf(request: Request): Promise<Request> {
  if (SAFE_METHODS.has(request.method)) return request;
  const headers = new Headers(request.headers);
  headers.set("X-CSRFToken", await ensureCsrfToken());
  return new Request(request, { headers });
}

/** fetch() for the browser client: CSRF header + one silent refresh on 401. */
export async function authFetch(input: Request): Promise<Response> {
  const retryable = input.clone();
  const response = await fetch(await withCsrf(input));
  const path = new URL(input.url, window.location.origin).pathname;
  const canRefresh = !NO_REFRESH_PATHS.has(path);
  if (response.status !== 401 || !canRefresh || !hasSessionHint()) return response;

  const refreshed = await refreshSession();
  if (!refreshed) return response;
  return fetch(await withCsrf(retryable));
}

const throwOnError: Middleware = {
  async onResponse({ response }) {
    if (response.ok) return undefined;
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    throw toApiError(response.status, body);
  },
};

/** Browser client. Errors throw ApiError, so TanStack Query/mutations can catch them. */
export const api = createClient<paths>({
  baseUrl: "",
  credentials: "same-origin",
  fetch: (request) => authFetch(request),
});
api.use(throwOnError);
