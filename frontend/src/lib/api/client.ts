import createClient from "openapi-fetch";

import type { paths } from "@/types/api";

/**
 * Typed API client generated from the backend OpenAPI schema (ADR-017).
 *
 * In the browser, requests are same-origin (Caddy routes /api to Django, ADR-005).
 * On the server, requests go straight to the api container over the Docker network.
 */
export function getApiBaseUrl(): string {
  if (typeof window === "undefined") {
    return process.env.INTERNAL_API_URL ?? "http://api:8000";
  }
  return "";
}

export function createApiClient(baseUrl: string = getApiBaseUrl()) {
  return createClient<paths>({ baseUrl });
}
