import { describe, expect, it } from "vitest";

import { safeNextPath } from "./session";

describe("safeNextPath", () => {
  it.each([
    ["/settings/profile", "/settings/profile"],
    ["/channels/me?tab=1", "/channels/me?tab=1"],
    [null, "/channels/me"],
    ["", "/channels/me"],
    ["https://evil.example.com", "/channels/me"],
    ["//evil.example.com", "/channels/me"],
    ["javascript:alert(1)", "/channels/me"],
  ])("%s -> %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});
