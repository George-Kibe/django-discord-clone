import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import { scrubBreadcrumb, scrubEvent, scrubUrl } from "./sentry-options";

describe("scrubUrl", () => {
  it.each([
    ["http://x/verify-email?token=abc", "http://x/verify-email"],
    ["/reset-password?uid=1&token=t#frag", "/reset-password"],
    ["/channels/me", "/channels/me"],
    ["/a#b", "/a"],
  ])("%s -> %s", (input, expected) => expect(scrubUrl(input)).toBe(expected));
});

describe("scrubEvent", () => {
  it("removes tokens from the request URL, query string and breadcrumbs", () => {
    const event = scrubEvent({
      type: undefined,
      request: { url: "http://x/verify-email?token=SECRET", query_string: "token=SECRET" },
      breadcrumbs: [
        { category: "navigation", data: { from: "/a?token=SECRET", to: "/b?x=SECRET" } },
      ],
    } as ErrorEvent);
    expect(JSON.stringify(event)).not.toContain("SECRET");
    expect(event.request?.url).toBe("http://x/verify-email");
  });
});

describe("scrubBreadcrumb", () => {
  it("scrubs fetch/xhr breadcrumb URLs", () => {
    const crumb = scrubBreadcrumb({
      category: "fetch",
      data: { url: "/api/v1/x?token=SECRET", method: "GET" },
    });
    expect(crumb.data).toEqual({ url: "/api/v1/x", method: "GET" });
  });
});
