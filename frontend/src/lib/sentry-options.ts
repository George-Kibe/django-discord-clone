import type { Breadcrumb, BrowserOptions, ErrorEvent } from "@sentry/nextjs";

/**
 * Sentry v11 collects cookies, headers, bodies, query params and user info by default.
 * Here those would include JWT cookies, passwords and the tokens in verify/reset links,
 * so everything is off (NFR-PRIV-01). Errors still carry stack traces and the route.
 */
export const sentryDataCollection: NonNullable<BrowserOptions["dataCollection"]> = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
};

/** Drops the query string and fragment (verify/reset links carry tokens there). */
export function scrubUrl(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

const URL_KEYS = ["url", "from", "to"] as const;

function scrubData(data: Record<string, unknown> | undefined): void {
  if (!data) return;
  for (const key of URL_KEYS) {
    if (typeof data[key] === "string") data[key] = scrubUrl(data[key]);
  }
}

/** `dataCollection` doesn't cover `request.url` or navigation breadcrumbs, so scrub those too. */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    if (event.request.url) event.request.url = scrubUrl(event.request.url);
    delete event.request.query_string;
  }
  for (const crumb of event.breadcrumbs ?? []) scrubData(crumb.data);
  return event;
}

export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb {
  scrubData(crumb.data);
  return crumb;
}

export const sentryPrivacyOptions = {
  dataCollection: sentryDataCollection,
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
};
